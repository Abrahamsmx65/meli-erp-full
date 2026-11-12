/**
 * Publicar productos NUEVOS de calzado en Mercado Libre: lectura de la
 * ficha a copiar, subida de fotos, validación y creación de una publicación
 * por color + talla. El motor puro (y el porqué de cada cosa) vive en
 * `meli/publicar.ts`. Pedido del dueño, 12-nov-2026.
 */
import { MeliError, type MeliClient } from "@/lib/meli/client";
import {
  cuerpoDeVariante,
  erroresDeMeli,
  faltantesDePedido,
  fichaDeItem,
  normalizarColor,
  normalizarModelo,
  normalizarTalla,
  resumenDeVariantes,
  soloAdvertencias,
  variantesDePedido,
  type AtributoFicha,
  type AtributoMeli,
  type FichaPlantilla,
  type FilaGuia,
  type GuiaMeli,
  type ItemMeli,
  type PedidoPublicacion,
  type TipoCalzado,
  type VarianteGuardada,
} from "@/lib/meli/publicar";
import { conCandado, porTandas, traerTodo } from "@/lib/datos/repos";
import { conCacheApp, invalidarApp } from "@/lib/servicios/cache-app";
import { BOCETOS_PNG } from "@/lib/meli/bocetos-datos";
import { procesarItem } from "@/lib/servicios/webhooks";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;

const CLAVE_OPCIONES = "meli:publicar:opciones";
const HORAS_OPCIONES = 12;
/** Si tantas variantes seguidas fallan, las demás fallarían igual: se para y se enseña el motivo. */
const ERRORES_SEGUIDOS_PARA_PARAR = 3;

export interface CategoriaConModelos {
  id: string;
  nombre: string;
  /** Modelos de la cuenta en esa categoría, el más nuevo primero. */
  modelos: string[];
}

export interface PublicacionGuardada {
  id: string;
  modelo: string;
  titulo: string;
  categoriaId: string;
  precio: number;
  estado: string;
  error: string | null;
  variantes: VarianteGuardada[];
  creadoEn: string;
  actualizadoEn: string;
}

function numeroDeModelo(modelo: string): number {
  const m = modelo.match(/\d+/);
  return m ? Number(m[0]) : 0;
}

/** Categorías de MELI que la cuenta ya usa en calzado, con sus modelos (de dónde copiar la ficha). */
export async function opcionesDeFicha(admin: DB, accountId: string, cliente: MeliClient): Promise<CategoriaConModelos[]> {
  return conCacheApp<CategoriaConModelos[]>(admin, accountId, CLAVE_OPCIONES, HORAS_OPCIONES * 3_600_000, async () => {
    const filas = await traerTodo<{ modelo: string | null; categoria_id: string | null }>(
      admin,
      "skus",
      "modelo, categoria_id",
      (q) => q.eq("account_id", accountId).eq("activo", true).not("categoria_id", "is", null).not("item_id", "is", null),
    );
    // Categoría de cada modelo = la que más variantes suyas llevan.
    const cuenta = new Map<string, Map<string, number>>();
    for (const f of filas) {
      if (!f.modelo || !f.categoria_id || !/^[A-Z]{1,4}\d/.test(f.modelo)) continue;
      const m = cuenta.get(f.modelo) ?? new Map<string, number>();
      m.set(f.categoria_id, (m.get(f.categoria_id) ?? 0) + 1);
      cuenta.set(f.modelo, m);
    }
    const porCategoria = new Map<string, string[]>();
    for (const [modelo, cats] of cuenta) {
      const cat = [...cats.entries()].sort((a, b) => b[1] - a[1])[0][0];
      porCategoria.set(cat, [...(porCategoria.get(cat) ?? []), modelo]);
    }
    const salida: CategoriaConModelos[] = [];
    for (const [id, modelos] of porCategoria) {
      let nombre = id;
      try {
        const c = await cliente.get<{ name?: string }>(`/categories/${id}`, undefined, { reintentos: 1 });
        if (c?.name) nombre = c.name;
      } catch {
        // Sin nombre se enseña el id: no impide publicar.
      }
      salida.push({ id, nombre, modelos: modelos.sort((a, b) => numeroDeModelo(b) - numeroDeModelo(a) || a.localeCompare(b)) });
    }
    return salida.sort((a, b) => b.modelos.length - a.modelos.length);
  });
}

/**
 * La tienda oficial de la cuenta (`/users/{id}/brands`). Toda publicación
 * nueva va en ella aunque la copiada no la traiga (dueño, 12-nov-2026: «nos
 * faltó la tienda oficial»). Sin tienda o si MELI no contesta, null.
 */
async function tiendaOficial(cliente: MeliClient, vendedor: number | null): Promise<{ id: number; nombre: string } | null> {
  if (!vendedor) return null;
  try {
    const r = await cliente.get<{ brands?: { official_store_id?: number; fantasy_name?: string; name?: string }[] }>(
      `/users/${vendedor}/brands`,
      undefined,
      { reintentos: 1 },
    );
    const b = (r?.brands ?? []).find((x) => x.official_store_id);
    return b?.official_store_id ? { id: b.official_store_id, nombre: b.fantasy_name || b.name || String(b.official_store_id) } : null;
  } catch {
    return null;
  }
}

/**
 * El id en MELI del boceto de ese tipo de calzado. Se sube una vez y se
 * recuerda menos de un día: una foto subida que no se pega a ninguna
 * publicación MELI la puede tirar.
 */
async function bocetoEnMeli(admin: DB, accountId: string, cliente: MeliClient, tipo: TipoCalzado): Promise<string> {
  return conCacheApp<string>(admin, accountId, `meli:publicar:boceto:${tipo}`, 20 * 3_600_000, async () => {
    const bytes = Buffer.from(BOCETOS_PNG[tipo], "base64");
    const subida = await cliente.subirImagen(new Blob([new Uint8Array(bytes)], { type: "image/png" }), `boceto-${tipo}.png`);
    return subida.id;
  });
}

/** Lee EN VIVO una publicación del modelo y arma la ficha que se copia. */
export async function leerFicha(admin: DB, accountId: string, cliente: MeliClient, modelo: string): Promise<FichaPlantilla> {
  const m = normalizarModelo(modelo);
  const { data } = await admin
    .from("skus")
    .select("item_id, estado")
    .eq("account_id", accountId)
    .eq("activo", true)
    .eq("modelo", m)
    .not("item_id", "is", null)
    .order("estado", { ascending: true })
    .limit(1);
  const itemId = data?.[0]?.item_id as string | undefined;
  if (!itemId) throw new Error(`No hay publicación de ${m} en el catálogo para copiar su ficha.`);

  const item = await cliente.get<ItemMeli>(`/items/${itemId}`);
  const categoriaId = item.category_id ?? "";
  const gridId = (item.attributes ?? []).find((a) => a.id === "SIZE_GRID_ID")?.value_name ?? null;

  const [tienda, atributos, categoria, guia, descripcion] = await Promise.all([
    tiendaOficial(cliente, item.seller_id ?? null),
    cliente.get<AtributoMeli[]>(`/categories/${categoriaId}/attributes`),
    cliente.get<{ name?: string; settings?: { max_title_length?: number } }>(`/categories/${categoriaId}`),
    gridId ? cliente.get<GuiaMeli>(`/catalog/charts/${gridId}`, undefined, { reintentos: 1 }).catch(() => null) : Promise.resolve(null),
    cliente
      .get<{ plain_text?: string }>(`/items/${itemId}/description`, undefined, { reintentos: 0 })
      .then((d) => d?.plain_text ?? "")
      .catch(() => ""),
  ]);

  const ficha = fichaDeItem(m, item, Array.isArray(atributos) ? atributos : [], guia, {
    categoriaNombre: categoria?.name ?? categoriaId,
    descripcion,
    maxTitulo: categoria?.settings?.max_title_length ?? 60,
    tienda,
  });
  try {
    ficha.fotos = [{ id: await bocetoEnMeli(admin, accountId, cliente, ficha.boceto), url: `/bocetos/${ficha.boceto}.png` }];
  } catch {
    // Sin boceto la pantalla pide fotos propias: no se publica sin foto.
  }
  return ficha;
}

// ---------------------------------------------------------------------------
// El pedido que llega del navegador
// ---------------------------------------------------------------------------

const texto = (x: unknown, max = 500) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Lee el pedido del cuerpo de la petición sin confiar en su forma. */
export function leerPedido(b: Record<string, unknown>): PedidoPublicacion {
  const f = (b.ficha ?? {}) as Record<string, unknown>;
  const atributos: AtributoFicha[] = (Array.isArray(f.atributos) ? f.atributos : [])
    .map((a: Record<string, unknown>) => ({
      id: texto(a?.id, 80),
      nombre: texto(a?.nombre, 120),
      valorId: typeof a?.valorId === "string" && a.valorId ? a.valorId.slice(0, 40) : null,
      valor: texto(a?.valor, 255),
      opciones: [],
      requerido: a?.requerido === true,
    }))
    .filter((a: AtributoFicha) => /^[A-Z0-9_]+$/.test(a.id));
  const filas: FilaGuia[] = (Array.isArray(f.filas) ? f.filas : [])
    .map((x: Record<string, unknown>) => ({ rowId: texto(x?.rowId, 40), talla: normalizarTalla(texto(x?.talla, 10)), nombre: texto(x?.nombre, 20) }))
    .filter((x: FilaGuia) => x.rowId && x.talla);
  const saleTerms = (Array.isArray(f.saleTerms) ? f.saleTerms : [])
    .map((s: Record<string, unknown>) => ({ id: texto(s?.id, 60), value_name: texto(s?.value_name, 120) }))
    .filter((s: { id: string; value_name: string }) => s.id && s.value_name);
  const colores = (Array.isArray(b.colores) ? b.colores : []).map((c: Record<string, unknown>) => ({
    codigo: normalizarColor(texto(c?.codigo, 40)),
    nombre: texto(c?.nombre, 60),
    fotos: (Array.isArray(c?.fotos) ? c.fotos : []).filter((x: unknown): x is string => typeof x === "string" && /^[\w-]{5,80}$/.test(x)).slice(0, 10),
  }));
  const precio = Number(b.precio);
  const tienda = Number(f.officialStoreId);
  return {
    modelo: normalizarModelo(texto(b.modelo, 20)),
    titulo: texto(b.titulo, 120),
    precio: Number.isFinite(precio) ? Math.round(precio * 100) / 100 : 0,
    descripcion: typeof b.descripcion === "string" ? b.descripcion.trim().slice(0, 49_000) : "",
    pausar: b.pausar !== false,
    colores,
    tallas: [...new Set((Array.isArray(b.tallas) ? b.tallas : []).map((t: unknown) => normalizarTalla(String(t ?? ""))).filter(Boolean))] as string[],
    ficha: {
      categoriaId: /^ML[A-Z]\d+$/.test(texto(f.categoriaId, 20)) ? texto(f.categoriaId, 20) : "",
      listingTypeId: texto(f.listingTypeId, 30) || "gold_special",
      officialStoreId: Number.isFinite(tienda) && tienda > 0 ? tienda : null,
      gridId: /^\d+$/.test(texto(f.gridId, 20)) ? texto(f.gridId, 20) : null,
      filas,
      atributos,
      saleTerms,
      maxTitulo: Number(f.maxTitulo) > 0 ? Number(f.maxTitulo) : 60,
      fotos: (Array.isArray(f.fotos) ? f.fotos : [])
        .map((x: Record<string, unknown>) => ({ id: texto(x?.id, 80), url: "" }))
        .filter((x: { id: string }) => /^[\w-]{5,80}$/.test(x.id))
        .slice(0, 10),
    },
  };
}

function mensajeDeError(err: unknown): string {
  if (err instanceof MeliError) {
    const errores = erroresDeMeli(err.cuerpo);
    if (errores.length) return errores.join(" · ");
  }
  return (err as Error)?.message ?? "Error desconocido";
}

/** SKUs del pedido que YA existen activos en el catálogo (no se vuelven a crear). */
async function skusQueYaExisten(admin: DB, accountId: string, skus: string[]): Promise<Map<string, string | null>> {
  const filas = await porTandas(skus, 150, (tanda) =>
    traerTodo<{ sku: string; item_id: string | null }>(admin, "skus", "sku, item_id", (q) =>
      q.eq("account_id", accountId).eq("activo", true).in("sku", tanda),
    ),
  );
  return new Map(filas.map((f) => [f.sku, f.item_id]));
}

/**
 * Revisa el pedido SIN crear nada: lo que falta de este lado y, si no falta
 * nada, lo que dice el validador de MELI (`/items/validate`) de la primera
 * variante de cada color.
 */
export async function validarPedido(
  admin: DB,
  accountId: string,
  cliente: MeliClient,
  pedido: PedidoPublicacion,
): Promise<{ ok: boolean; faltantes: string[]; errores: string[]; variantes: number; yaExisten: string[] }> {
  const faltantes = faltantesDePedido(pedido);
  const variantes = variantesDePedido(pedido);
  const existentes = await skusQueYaExisten(admin, accountId, variantes.map((v) => v.sku));
  const yaExisten = variantes.filter((v) => existentes.has(v.sku)).map((v) => v.sku);
  if (faltantes.length) return { ok: false, faltantes, errores: [], variantes: variantes.length, yaExisten };

  const errores: string[] = [];
  const porColor = new Map<string, (typeof variantes)[number]>();
  for (const v of variantes) if (!existentes.has(v.sku) && !porColor.has(v.color)) porColor.set(v.color, v);
  for (const v of porColor.values()) {
    try {
      await cliente.post("/items/validate", cuerpoDeVariante(pedido, v));
    } catch (err) {
      if (err instanceof MeliError && soloAdvertencias(err.cuerpo)) continue;
      errores.push(`${v.sku}: ${mensajeDeError(err)}`);
    }
  }
  return { ok: errores.length === 0, faltantes, errores, variantes: variantes.length, yaExisten };
}

function aGuardada(f: Record<string, unknown>): PublicacionGuardada {
  return {
    id: String(f.id),
    modelo: String(f.modelo),
    titulo: String(f.titulo),
    categoriaId: String(f.categoria_id),
    precio: Number(f.precio),
    estado: String(f.estado),
    error: (f.error as string | null) ?? null,
    variantes: (Array.isArray(f.variantes) ? f.variantes : []) as VarianteGuardada[],
    creadoEn: String(f.creado_en),
    actualizadoEn: String(f.actualizado_en),
  };
}

const COLUMNAS = "id, modelo, titulo, categoria_id, precio, estado, error, variantes, creado_en, actualizado_en";

export async function listarPublicaciones(
  db: DB,
  accountId: string,
  limite = 15,
  canal: "meli" | "amazon" = "meli",
): Promise<PublicacionGuardada[]> {
  const { data, error } = await db
    .from("meli_publicaciones")
    .select(COLUMNAS)
    .eq("account_id", accountId)
    .eq("canal", canal)
    .order("creado_en", { ascending: false })
    .limit(limite);
  if (error) throw new Error(`meli_publicaciones: ${error.message}`);
  return (data ?? []).map(aGuardada);
}

/** Guarda el pedido con sus variantes por publicar; el trabajo lo hace `procesarPublicacion`. */
export async function encolarPublicacion(admin: DB, accountId: string, pedido: PedidoPublicacion): Promise<PublicacionGuardada> {
  const faltantes = faltantesDePedido(pedido);
  if (faltantes.length) throw new Error(faltantes.join(" "));
  const variantes = variantesDePedido(pedido);
  const existentes = await skusQueYaExisten(admin, accountId, variantes.map((v) => v.sku));
  const guardadas: VarianteGuardada[] = variantes.map((v) =>
    existentes.has(v.sku)
      ? { ...v, estado: "ya_existe", itemId: existentes.get(v.sku) ?? null, error: null, aviso: null }
      : { ...v, estado: "pendiente", itemId: null, error: null, aviso: null },
  );
  if (!guardadas.some((v) => v.estado === "pendiente")) {
    throw new Error("Todos esos SKU ya están publicados en MELI.");
  }
  const { data, error } = await admin
    .from("meli_publicaciones")
    .insert({
      account_id: accountId,
      modelo: pedido.modelo,
      titulo: pedido.titulo,
      categoria_id: pedido.ficha.categoriaId,
      precio: pedido.precio,
      estado: "pendiente",
      pedido,
      variantes: guardadas,
    })
    .select(COLUMNAS)
    .single();
  if (error) throw new Error(`meli_publicaciones: ${error.message}`);
  return aGuardada(data);
}

/**
 * Crea en MELI las variantes pendientes de un pedido, una publicación por
 * color + talla, guardando el avance tras cada una. Con `reintentar`, las
 * que fallaron vuelven a intentarse. Un solo trabajo a la vez por cuenta.
 */
export async function procesarPublicacion(
  admin: DB,
  accountId: string,
  cliente: MeliClient,
  id: string,
  opts: { reintentar?: boolean; presupuestoMs?: number } = {},
): Promise<PublicacionGuardada | null> {
  const limite = Date.now() + (opts.presupuestoMs ?? 700_000);
  return conCandado(
    admin,
    accountId,
    "meli-publicar",
    900,
    async () => {
      const { data: fila } = await admin
        .from("meli_publicaciones")
        .select(`${COLUMNAS}, pedido`)
        .eq("account_id", accountId)
        .eq("id", id)
        .maybeSingle();
      if (!fila) return null;
      const pedido = fila.pedido as PedidoPublicacion;
      const variantes = (fila.variantes ?? []) as VarianteGuardada[];
      if (opts.reintentar) {
        for (const v of variantes) if (v.estado === "error") Object.assign(v, { estado: "pendiente", error: null });
      }

      const guardar = async (estado: string, error: string | null) => {
        await admin
          .from("meli_publicaciones")
          .update({ variantes, estado, error, actualizado_en: new Date().toISOString() })
          .eq("id", id);
      };
      await guardar("publicando", null);

      let seguidos = 0;
      let motivo: string | null = null;
      for (const v of variantes) {
        if (v.estado !== "pendiente") continue;
        if (Date.now() > limite) {
          motivo = "Se acabó el tiempo: dale a «Continuar» para publicar las que faltan.";
          break;
        }
        if (seguidos >= ERRORES_SEGUIDOS_PARA_PARAR) {
          motivo = "MELI rechazó varias seguidas por lo mismo: corrige y vuelve a intentar.";
          break;
        }
        try {
          const creado = await cliente.post<{ id?: string; status?: string }>("/items", cuerpoDeVariante(pedido, v));
          if (!creado?.id) throw new Error("MELI no devolvió el id de la publicación.");
          v.itemId = creado.id;
          v.estado = "publicada";
          v.error = null;
          seguidos = 0;

          const avisos: string[] = [];
          if (pedido.pausar && creado.status !== "paused") {
            try {
              await cliente.put(`/items/${creado.id}`, { status: "paused" }, { reintentos: 2 });
            } catch (err) {
              avisos.push(`quedó ACTIVA, no se pudo pausar (${mensajeDeError(err)})`);
            }
          }
          if (pedido.descripcion) {
            try {
              await cliente.post(`/items/${creado.id}/description`, { plain_text: pedido.descripcion });
            } catch (err) {
              avisos.push(`sin descripción (${mensajeDeError(err)})`);
            }
          }
          v.aviso = avisos.length ? avisos.join(" · ") : null;

          // Al catálogo del ERP en el acto (el aviso de MELI llega igual después).
          try {
            await procesarItem(admin, accountId, cliente, `/items/${creado.id}`);
          } catch {
            // El webhook o el barrido diario lo registran.
          }
        } catch (err) {
          v.estado = "error";
          v.error = mensajeDeError(err).slice(0, 600);
          seguidos++;
        }
        await guardar("publicando", null);
      }

      const r = resumenDeVariantes(variantes);
      const estado = r.pendientes ? "pendiente" : r.errores ? (r.publicadas ? "parcial" : "error") : "publicado";
      await guardar(estado, motivo);
      if (r.publicadas) await invalidarApp(admin, accountId, "Se publicó un modelo nuevo en MELI.", { claves: [CLAVE_OPCIONES] }).catch(() => undefined);

      const { data: final } = await admin.from("meli_publicaciones").select(COLUMNAS).eq("id", id).maybeSingle();
      return final ? aGuardada(final) : null;
    },
    "Ya se está publicando otro producto: espera a que termine.",
  );
}
