/**
 * Revisión en vivo de los modelos nuevos en MELI y Amazon.
 *
 * Lo que el API sí puede decir de cada modelo:
 *
 *   MELI   · por publicación (cada color es su propio MLM): cuántas fotos
 *            trae (`pictures`), si tiene el video viejo (`video_id`) y su
 *            estado. El CLIP no se ve por API (verificado, ver CLAUDE.md):
 *            ese se palomea a mano.
 *   Amazon · por color (un ASIN representativo, las fotos y el A+ son de la
 *            publicación, no de la talla): cuántas fotos trae el catálogo
 *            (MAIN + PT01…) y si tiene A+ publicado (A+ Content API). El
 *            video de Amazon tampoco sale por API: a mano.
 *
 * El resultado se guarda tal cual en `modelos_nuevos.revision` con su fecha,
 * y la pantalla lo resume (`resumirRevision`). Se revisa con presupuesto de
 * tiempo: lo que no alcance se queda para el siguiente clic.
 */
import type { DB } from "../datos/repos";
import { traerTodo } from "../datos/repos";
import { enLotes, trozos, type MeliClient } from "../meli/client";
import { Cliente, cuentasAmazon } from "../amazon/spapi";
import { imagenesDeAsins, type ImagenCatalogo } from "../amazon/catalogo";
import { aplusDeAsins } from "../amazon/aplus";
import { clienteDeCuenta } from "./webhooks";
import { claveGrupoFba, desglosarAmazon } from "./fba";
import { urlAmazon } from "./contenido-amazon";
import type { ColorAmazonRevisado, PublicacionMeliRevisada, RevisionModelo } from "./modelos-nuevos";

interface ItemMeliCrudo {
  id: string;
  title?: string;
  status?: string;
  permalink?: string;
  pictures?: { id?: string; url?: string }[];
  video_id?: string | null;
}

/** Fotos y video de las publicaciones de MELI, por item_id. */
export async function leerPublicacionesMeli(
  cliente: MeliClient,
  itemIds: string[],
  hayPlazo: () => boolean,
): Promise<{ items: Map<string, ItemMeliCrudo>; error: string | null }> {
  const items = new Map<string, ItemMeliCrudo>();
  let fallidos = 0;
  if (!itemIds.length) return { items, error: null };

  const respuestas = await enLotes(trozos(itemIds, 20), 4, async (grupo) => {
    if (!hayPlazo()) {
      fallidos++;
      return [] as { code: number; body: ItemMeliCrudo }[];
    }
    try {
      // Con proyección a propósito: aquí no hacen falta las variantes y sin
      // ella cada publicación pesa decenas de KB.
      return await cliente.get<{ code: number; body: ItemMeliCrudo }[]>("/items", {
        ids: grupo.join(","),
        attributes: "id,title,status,permalink,pictures,video_id",
      });
    } catch {
      fallidos++;
      return [] as { code: number; body: ItemMeliCrudo }[];
    }
  });
  for (const lote of respuestas) {
    for (const env of lote ?? []) {
      if (env?.code === 200 && env.body?.id) items.set(env.body.id, env.body);
    }
  }
  return { items, error: fallidos ? `MELI no contestó ${fallidos} lote(s); la foto puede estar incompleta.` : null };
}

/** Un ASIN por color: el activo de la talla más chica. */
export function coloresAmazonDeModelos(
  filas: { seller_sku: string; asin: string | null; estado: string | null }[],
  modelos: Set<string>,
): Map<string, ColorAmazonRevisado[]> {
  interface Cand {
    asin: string | null;
    estado: string | null;
    talla: number;
    sku: string;
  }
  const porModeloColor = new Map<string, Map<string, { color: string; cands: Cand[] }>>();
  for (const f of filas) {
    const sku = String(f.seller_sku ?? "").trim();
    if (!sku) continue;
    const d = desglosarAmazon(sku);
    const modelo = (d.modelo ?? sku).trim().toUpperCase();
    if (!modelos.has(modelo)) continue;
    const color = (d.color ?? "").trim().toUpperCase() || "ÚNICO";
    const clave = claveGrupoFba(modelo, color);
    const m = porModeloColor.get(modelo) ?? new Map();
    const c = m.get(clave) ?? { color, cands: [] as Cand[] };
    const talla = Number(d.talla);
    c.cands.push({
      asin: f.asin ?? null,
      estado: f.estado ?? null,
      talla: Number.isFinite(talla) ? talla : 999,
      sku,
    });
    m.set(clave, c);
    porModeloColor.set(modelo, m);
  }

  const salida = new Map<string, ColorAmazonRevisado[]>();
  for (const [modelo, colores] of porModeloColor) {
    const lista: ColorAmazonRevisado[] = [];
    for (const { color, cands } of colores.values()) {
      const orden = [...cands].sort(
        (a, b) =>
          Number(b.estado === "Active") - Number(a.estado === "Active") ||
          a.talla - b.talla ||
          a.sku.localeCompare(b.sku),
      );
      const mejor = orden.find((c) => c.asin) ?? orden[0];
      lista.push({
        modelo,
        color,
        asin: mejor?.asin ?? null,
        estado: cands.some((c) => c.estado === "Active") ? "Active" : (mejor?.estado ?? null),
        fotos: null,
        aplus: null,
        url: null,
      });
    }
    lista.sort((a, b) => a.color.localeCompare(b.color, "es"));
    salida.set(modelo, lista);
  }
  return salida;
}

export interface OpcionesRevision {
  /** Con RLS: lee el catálogo y escribe la revisión. */
  db: DB;
  /** service_role: tokens de MELI y credenciales de Amazon. */
  admin: DB;
  meliAccountId: string;
  amazon: { id: string; pais: string | null } | null;
  modelos: string[];
  /** Momento (ms) en que hay que rendirse. */
  limite: number;
}

export interface ResultadoRevision {
  revisados: string[];
  /** Los que no alcanzaron plazo. */
  pendientes: string[];
  avisos: string[];
}

export async function revisarModelos(o: OpcionesRevision): Promise<ResultadoRevision> {
  const modelos = [...new Set(o.modelos.map((m) => m.trim().toUpperCase()).filter(Boolean))];
  const avisos: string[] = [];
  const hayPlazo = () => Date.now() < o.limite - 5_000;
  if (!modelos.length) return { revisados: [], pendientes: [], avisos };

  // ---------------- MELI ----------------
  const conjunto = new Set(modelos);
  // Solo códigos que caben en un filtro de PostgREST sin escapar nada.
  const seguros = modelos.filter((m) => /^[A-Z0-9._-]+$/.test(m));
  if (!seguros.length) return { revisados: [], pendientes: modelos, avisos: ["Ningún modelo válido."] };
  const skus = await traerTodo<{ modelo: string | null; item_id: string | null; color: string | null }>(
    o.db,
    "skus",
    "modelo, item_id, color",
    // ilike por modelo: el código viene del SKU tal cual lo escribió quien
    // publicó, y "gt104" y "GT104" son el mismo agrupador.
    (q) =>
      q
        .eq("account_id", o.meliAccountId)
        .or(seguros.map((m) => `modelo.ilike.${m}`).join(","))
        .not("item_id", "is", null),
  );
  const itemsPorModelo = new Map<string, Map<string, string | null>>();
  for (const s of skus) {
    const modelo = (s.modelo ?? "").toUpperCase();
    if (!s.item_id || !conjunto.has(modelo)) continue;
    const m = itemsPorModelo.get(modelo) ?? new Map<string, string | null>();
    if (!m.has(s.item_id) || (!m.get(s.item_id) && s.color)) m.set(s.item_id, s.color ?? null);
    itemsPorModelo.set(modelo, m);
  }

  let itemsMeli = new Map<string, ItemMeliCrudo>();
  let errorMeli: string | null = null;
  const todosLosItems = [...itemsPorModelo.values()].flatMap((m) => [...m.keys()]);
  if (todosLosItems.length) {
    const cliente = await clienteDeCuenta(o.admin, o.meliAccountId);
    if (!cliente) {
      errorMeli = "La cuenta no tiene tokens de MELI guardados.";
    } else {
      const r = await leerPublicacionesMeli(cliente, todosLosItems, hayPlazo);
      itemsMeli = r.items;
      errorMeli = r.error;
    }
  }
  if (errorMeli) avisos.push(errorMeli);

  // ---------------- Amazon ----------------
  let coloresAmazon = new Map<string, ColorAmazonRevisado[]>();
  let errorAmazon: string | null = null;
  let aplusAviso: string | null = null;
  let amazonConsultado = false;
  if (o.amazon) {
    const listados = await traerTodo<{ seller_sku: string; asin: string | null; estado: string | null }>(
      o.db,
      "amazon_listings",
      "seller_sku, asin, estado",
      (q) => q.eq("account_id", o.amazon!.id),
    ).catch(() => []);
    coloresAmazon = coloresAmazonDeModelos(listados, conjunto);
    const asins = [...coloresAmazon.values()].flatMap((l) => l.map((c) => c.asin)).filter((a): a is string => !!a);

    if (asins.length) {
      const credenciales = (await cuentasAmazon(o.admin)).find((c) => c.accountId === o.amazon!.id);
      if (!credenciales) {
        errorAmazon = "La cuenta de Amazon no tiene credenciales guardadas.";
      } else {
        amazonConsultado = true;
        const cliente = new Cliente(credenciales, o.limite);
        let fotos = new Map<string, ImagenCatalogo[]>();
        try {
          fotos = await imagenesDeAsins(cliente, asins);
        } catch (err) {
          errorAmazon = `Amazon no entregó el catálogo de imágenes (${(err as Error).message}).`;
        }
        let aplus: Awaited<ReturnType<typeof aplusDeAsins>> | null = null;
        try {
          aplus = await aplusDeAsins(cliente, asins);
          if (aplus.sinPermiso) {
            aplusAviso = "La app de Amazon no tiene permiso para el A+ Content API: el A+ se palomea a mano.";
          } else if (aplus.incompleto) {
            aplusAviso = "Se acabó el plazo antes de preguntar el A+ de todos los colores.";
          }
        } catch (err) {
          aplusAviso = `No se pudo consultar el A+ (${(err as Error).message}).`;
        }
        for (const lista of coloresAmazon.values()) {
          for (const c of lista) {
            if (!c.asin) continue;
            const suyas = fotos.get(c.asin);
            c.fotos = suyas ? suyas.length : errorAmazon ? null : 0;
            c.aplus = aplus?.porAsin.get(c.asin) ?? null;
            c.url = urlAmazon(c.asin, o.amazon.pais);
          }
        }
      }
    }
    if (errorAmazon) avisos.push(errorAmazon);
    if (aplusAviso) avisos.push(aplusAviso);
  }

  // ---------------- Guardar ----------------
  const ahora = new Date().toISOString();
  const revisados: string[] = [];
  const pendientes: string[] = [];
  for (const modelo of modelos) {
    const items = itemsPorModelo.get(modelo);
    const publicaciones: PublicacionMeliRevisada[] = [];
    let meliIncompleto = false;
    for (const [itemId, color] of items ?? []) {
      const it = itemsMeli.get(itemId);
      if (!it) {
        meliIncompleto = true;
        continue;
      }
      publicaciones.push({
        itemId,
        color,
        titulo: it.title ?? null,
        estado: it.status ?? null,
        fotos: (it.pictures ?? []).length,
        video: Boolean(it.video_id),
        permalink: it.permalink ?? null,
      });
    }
    // Sin plazo y sin nada leído de este modelo: se queda para la siguiente.
    if (items?.size && !publicaciones.length && !hayPlazo()) {
      pendientes.push(modelo);
      continue;
    }
    publicaciones.sort((a, b) => (a.color ?? "").localeCompare(b.color ?? "") || a.itemId.localeCompare(b.itemId));

    const colores = coloresAmazon.get(modelo) ?? [];
    const revision: RevisionModelo = {
      en: ahora,
      meli: items?.size
        ? {
            publicaciones,
            error: errorMeli ?? (meliIncompleto ? "MELI no devolvió todas las publicaciones." : null),
          }
        : null,
      amazon: o.amazon && colores.length
        ? {
            colores,
            error: amazonConsultado ? errorAmazon : (errorAmazon ?? "No se consultó a Amazon."),
            aplusAviso,
          }
        : null,
    };

    const { error } = await o.db
      .from("modelos_nuevos")
      .update({ revision, revisado_en: ahora, actualizado_en: ahora })
      .eq("account_id", o.meliAccountId)
      .eq("modelo", modelo);
    if (error) {
      avisos.push(`${modelo}: no se pudo guardar la revisión (${error.message}).`);
      pendientes.push(modelo);
    } else {
      revisados.push(modelo);
    }
  }

  return { revisados, pendientes, avisos: [...new Set(avisos)] };
}
