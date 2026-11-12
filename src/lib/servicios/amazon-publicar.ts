/**
 * Crear productos NUEVOS de calzado en Amazon: lectura de la ficha a
 * copiar, validación (modo VALIDATION_PREVIEW, no crea nada) y creación del
 * padre y de un hijo por color + talla. El motor puro (y el porqué de cada
 * cosa) vive en `amazon/publicar.ts`. Pedido del dueño, 12-nov-2026.
 *
 * El avance se guarda en `meli_publicaciones` con `canal = 'amazon'` (la
 * misma tabla que las de MELI): el primer renglón de `variantes` es el
 * PADRE. El ASIN y el FNSKU los pone Amazon después; entran al ERP con la
 * sincronización de siempre.
 */
import { Cliente, cuentasAmazon, ErrorAmazon } from "@/lib/amazon/spapi";
import {
  cuerpoHijo,
  cuerpoPadre,
  erroresDeAmazon,
  faltantesDeAmazon,
  fichaDeAmazon,
  normalizarModelo,
  normalizarTalla,
  variantesDeAmazon,
  type AtributoSimple,
  type Atributos,
  type FichaAmazon,
  type PedidoAmazon,
  type RespuestaAmazon,
  type VarianteAmazon,
} from "@/lib/amazon/publicar";
import { resumenDeVariantes, type VarianteGuardada } from "@/lib/meli/publicar";
import { conCandado, porTandas, traerTodo } from "@/lib/datos/repos";
import { conCacheApp, invalidarApp } from "@/lib/servicios/cache-app";
import { listarPublicaciones, type PublicacionGuardada } from "@/lib/servicios/meli-publicar";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const CLAVE_OPCIONES = "amazon:publicar:opciones";
const ERRORES_SEGUIDOS_PARA_PARAR = 3;

export interface ModeloAmazon {
  modelo: string;
  titulo: string;
}

/** El cliente de la cuenta de Amazon (hay una), con `ms` de plazo. */
export async function clienteAmazonParaPublicar(admin: DB, ms: number): Promise<Cliente> {
  const cuenta = (await cuentasAmazon(admin))[0];
  if (!cuenta) throw new Error("No hay cuenta de Amazon conectada.");
  if (!cuenta.sellingPartnerId) throw new Error("La cuenta de Amazon no tiene el Seller ID guardado.");
  return new Cliente(cuenta, Date.now() + ms);
}

const ruta = (cliente: Cliente, sku: string) =>
  `/listings/2021-08-01/items/${encodeURIComponent(cliente.cuenta.sellingPartnerId ?? "")}/${encodeURIComponent(sku)}`;

function numeroDeModelo(modelo: string): number {
  const m = modelo.match(/\d+/);
  return m ? Number(m[0]) : 0;
}

/** Los modelos de calzado que Amazon ya tiene, el más nuevo primero (de dónde copiar la ficha). */
export async function opcionesAmazon(admin: DB, cliente: Cliente): Promise<ModeloAmazon[]> {
  const cuentaId = cliente.cuenta.accountId;
  return conCacheApp<ModeloAmazon[]>(admin, cuentaId, CLAVE_OPCIONES, 12 * 3_600_000, async () => {
    const filas = await traerTodo<{ seller_sku: string; titulo: string | null }>(admin, "amazon_listings", "seller_sku, titulo", (q) =>
      q.eq("account_id", cuentaId),
    );
    const porModelo = new Map<string, string>();
    for (const f of filas) {
      const m = String(f.seller_sku ?? "").toUpperCase().match(/^([A-Z]{1,4}\d{2,5})-/);
      if (m && !porModelo.has(m[1])) porModelo.set(m[1], f.titulo ?? "");
    }
    return [...porModelo.entries()]
      .map(([modelo, titulo]) => ({ modelo, titulo }))
      .sort((a, b) => numeroDeModelo(b.modelo) - numeroDeModelo(a.modelo) || a.modelo.localeCompare(b.modelo));
  });
}

/** Lo que la pantalla necesita al abrir: los modelos de Amazon y lo ya creado desde aquí. Sin cuenta de Amazon, el motivo. */
export async function datosDePantallaAmazon(
  admin: DB,
  cuentaMeliId: string,
): Promise<{ modelos: ModeloAmazon[]; publicaciones: PublicacionGuardada[]; error: string | null }> {
  const publicaciones = await listarPublicacionesAmazon(admin, cuentaMeliId).catch(() => []);
  try {
    const cliente = await clienteAmazonParaPublicar(admin, 30_000);
    return { modelos: await opcionesAmazon(admin, cliente), publicaciones, error: null };
  } catch (err) {
    return { modelos: [], publicaciones, error: (err as Error).message };
  }
}

async function leerItem(cliente: Cliente, sku: string): Promise<Json> {
  const r = await cliente.llamar<Json>("GET", ruta(cliente, sku), "getListingsItem", {
    params: { marketplaceIds: cliente.cuenta.marketplaceId, includedData: "summaries,attributes,relationships" },
  });
  if (!r) throw new Error("Amazon no contestó a tiempo.");
  return r;
}

/** Lee EN VIVO un hijo del modelo y su padre, y arma la ficha que se copia. */
export async function leerFichaAmazon(admin: DB, cliente: Cliente, modelo: string): Promise<FichaAmazon> {
  const m = normalizarModelo(modelo);
  const { data } = await admin
    .from("amazon_listings")
    .select("seller_sku")
    .eq("account_id", cliente.cuenta.accountId)
    .like("seller_sku", `${m}-%`)
    .order("seller_sku", { ascending: true })
    .limit(1);
  const sku = data?.[0]?.seller_sku as string | undefined;
  if (!sku) throw new Error(`Amazon no tiene publicaciones de ${m} para copiar su ficha.`);

  const hijo = await leerItem(cliente, sku);
  let skuDelPadre: string | null = null;
  for (const r of hijo?.relationships ?? []) {
    for (const x of r?.relationships ?? []) skuDelPadre = skuDelPadre ?? x?.parentSkus?.[0] ?? null;
  }
  let padre: { sku: string; attributes?: Atributos } | null = null;
  if (skuDelPadre) {
    try {
      padre = { sku: skuDelPadre, attributes: (await leerItem(cliente, skuDelPadre))?.attributes };
    } catch {
      // Sin padre legible, el padre nuevo se arma con lo del hijo.
    }
  }
  return fichaDeAmazon(m, sku, hijo, padre, cliente.cuenta.marketplaceId);
}

// ---------------------------------------------------------------------------
// El pedido que llega del navegador
// ---------------------------------------------------------------------------

const texto = (x: unknown, max = 500) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");

function atributos(x: unknown): Atributos {
  const salida: Atributos = {};
  if (!x || typeof x !== "object") return salida;
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (/^[a-z0-9_]{1,80}$/.test(k) && Array.isArray(v)) salida[k] = v;
  }
  return salida;
}

/** Lee el pedido del cuerpo de la petición sin confiar en su forma. */
export function leerPedidoAmazon(b: Record<string, unknown>, marketplaceId: string): PedidoAmazon {
  const f = (b.ficha ?? {}) as Record<string, unknown>;
  const t = (f.talla ?? {}) as Record<string, unknown>;
  const precio = Number(b.precio);
  const simples: AtributoSimple[] = (Array.isArray(b.simples) ? b.simples : [])
    .map((s: Record<string, unknown>) => ({
      clave: texto(s?.clave, 80),
      valores: (Array.isArray(s?.valores) ? s.valores : []).map((v: unknown) => texto(v, 500)).filter(Boolean),
    }))
    .filter((s: AtributoSimple) => /^[a-z0-9_]+$/.test(s.clave));
  return {
    modelo: normalizarModelo(texto(b.modelo, 20)),
    titulo: texto(b.titulo, 250),
    precio: Number.isFinite(precio) ? Math.round(precio * 100) / 100 : 0,
    colores: (Array.isArray(b.colores) ? b.colores : []).map((c: Record<string, unknown>) => ({
      codigo: texto(c?.codigo, 40).toUpperCase(),
      nombre: texto(c?.nombre, 60),
    })),
    tallas: [...new Set((Array.isArray(b.tallas) ? b.tallas : []).map((x: unknown) => normalizarTalla(String(x ?? ""))).filter(Boolean))] as string[],
    vinetas: (Array.isArray(b.vinetas) ? b.vinetas : []).map((v: unknown) => texto(v, 500)).filter(Boolean).slice(0, 5),
    descripcion: typeof b.descripcion === "string" ? b.descripcion.trim().slice(0, 2000) : "",
    palabras: texto(b.palabras, 500),
    simples,
    ficha: {
      productType: /^[A-Z_]{2,60}$/.test(texto(f.productType, 60)) ? texto(f.productType, 60) : "",
      // El marketplace es el de la cuenta, no el que diga el navegador.
      marketplaceId,
      talla: {
        gender: texto(t.gender, 20) || undefined,
        age_group: texto(t.age_group, 20) || undefined,
        size_class: texto(t.size_class, 30) || undefined,
        size_system: texto(t.size_system, 40) || undefined,
      },
      hijo: atributos(f.hijo),
      padre: atributos(f.padre),
    },
  };
}

function mensaje(err: unknown): string {
  if (err instanceof ErrorAmazon) return err.detalle.slice(0, 500);
  return (err as Error)?.message ?? "Error desconocido";
}

async function mandar(cliente: Cliente, sku: string, cuerpo: Record<string, unknown>, soloValidar: boolean): Promise<string[]> {
  try {
    const r = await cliente.llamar<RespuestaAmazon>("PUT", ruta(cliente, sku), "putListingsItem", {
      params: { marketplaceIds: cliente.cuenta.marketplaceId, issueLocale: "es_MX", mode: soloValidar ? "VALIDATION_PREVIEW" : undefined },
      cuerpo,
    });
    return erroresDeAmazon(r);
  } catch (err) {
    return [mensaje(err)];
  }
}

async function skusQueYaExisten(admin: DB, cuentaId: string, skus: string[]): Promise<Set<string>> {
  const filas = await porTandas(skus, 150, (tanda) =>
    traerTodo<{ seller_sku: string }>(admin, "amazon_listings", "seller_sku", (q) => q.eq("account_id", cuentaId).in("seller_sku", tanda)),
  );
  return new Set(filas.map((f) => f.seller_sku));
}

/**
 * Revisa el pedido SIN crear nada: lo que falta de este lado y lo que dice
 * Amazon (VALIDATION_PREVIEW) del padre y de una variante por color.
 */
export async function validarPedidoAmazon(
  admin: DB,
  cliente: Cliente,
  pedido: PedidoAmazon,
): Promise<{ ok: boolean; faltantes: string[]; errores: string[]; variantes: number; yaExisten: string[] }> {
  const faltantes = faltantesDeAmazon(pedido);
  const variantes = variantesDeAmazon(pedido);
  const hijos = variantes.filter((v) => !v.esPadre);
  const existentes = await skusQueYaExisten(admin, cliente.cuenta.accountId, hijos.map((v) => v.sku));
  const yaExisten = hijos.filter((v) => existentes.has(v.sku)).map((v) => v.sku);
  if (faltantes.length) return { ok: false, faltantes, errores: [], variantes: hijos.length, yaExisten };

  const errores: string[] = [];
  for (const e of await mandar(cliente, variantes[0].sku, cuerpoPadre(pedido), true)) errores.push(`Padre: ${e}`);
  const porColor = new Map<string, VarianteAmazon>();
  for (const v of hijos) if (!existentes.has(v.sku) && !porColor.has(v.color)) porColor.set(v.color, v);
  for (const v of [...porColor.values()].slice(0, 4)) {
    for (const e of await mandar(cliente, v.sku, cuerpoHijo(pedido, v), true)) errores.push(`${v.sku}: ${e}`);
  }
  return { ok: errores.length === 0, faltantes, errores, variantes: hijos.length, yaExisten };
}

const COLUMNAS = "id, modelo, titulo, categoria_id, precio, estado, error, variantes, creado_en, actualizado_en";

/** Guarda el pedido con el padre y sus variantes por crear; el trabajo lo hace `procesarAmazon`. */
export async function encolarAmazon(admin: DB, cuentaMeliId: string, cliente: Cliente, pedido: PedidoAmazon): Promise<string> {
  const faltantes = faltantesDeAmazon(pedido);
  if (faltantes.length) throw new Error(faltantes.join(" "));
  const variantes = variantesDeAmazon(pedido);
  const existentes = await skusQueYaExisten(admin, cliente.cuenta.accountId, variantes.map((v) => v.sku));
  const guardadas: VarianteGuardada[] = variantes.map((v) => ({
    sku: v.sku,
    color: v.esPadre ? "(padre)" : v.color,
    nombreColor: v.nombreColor,
    talla: v.talla,
    nombreTalla: v.talla,
    rowId: null,
    estado: !v.esPadre && existentes.has(v.sku) ? "ya_existe" : "pendiente",
    itemId: null,
    error: null,
    aviso: null,
  }));
  if (!guardadas.some((v) => v.estado === "pendiente" && v.color !== "(padre)")) throw new Error("Todos esos SKU ya están en Amazon.");
  const { data, error } = await admin
    .from("meli_publicaciones")
    .insert({
      account_id: cuentaMeliId,
      canal: "amazon",
      modelo: pedido.modelo,
      titulo: pedido.titulo,
      categoria_id: pedido.ficha.productType,
      precio: pedido.precio,
      estado: "pendiente",
      pedido,
      variantes: guardadas,
    })
    .select("id")
    .single();
  if (error) throw new Error(`meli_publicaciones: ${error.message}`);
  return String(data.id);
}

/**
 * Crea en Amazon lo pendiente de un pedido: primero el padre y luego cada
 * hijo, guardando el avance. Sin padre no se crean hijos. Con `reintentar`,
 * lo que falló vuelve a intentarse. Un solo trabajo a la vez por cuenta.
 */
export async function procesarAmazon(
  admin: DB,
  cuentaMeliId: string,
  cliente: Cliente,
  id: string,
  opts: { reintentar?: boolean; presupuestoMs?: number } = {},
): Promise<void> {
  const limite = Date.now() + (opts.presupuestoMs ?? 700_000);
  await conCandado(
    admin,
    cuentaMeliId,
    "amazon-publicar",
    900,
    async () => {
      const { data: fila } = await admin
        .from("meli_publicaciones")
        .select(`${COLUMNAS}, pedido`)
        .eq("account_id", cuentaMeliId)
        .eq("canal", "amazon")
        .eq("id", id)
        .maybeSingle();
      if (!fila) return;
      const pedido = fila.pedido as PedidoAmazon;
      const variantes = (fila.variantes ?? []) as VarianteGuardada[];
      const porSku = new Map(variantesDeAmazon(pedido).map((v) => [v.sku, v]));
      if (opts.reintentar) {
        for (const v of variantes) if (v.estado === "error") Object.assign(v, { estado: "pendiente", error: null });
      }
      const guardar = async (estado: string, error: string | null) => {
        await admin.from("meli_publicaciones").update({ variantes, estado, error, actualizado_en: new Date().toISOString() }).eq("id", id);
      };
      await guardar("publicando", null);

      let seguidos = 0;
      let motivo: string | null = null;
      for (const v of variantes) {
        if (v.estado !== "pendiente") continue;
        if (Date.now() > limite) {
          motivo = "Se acabó el tiempo: dale a «Continuar» para crear las que faltan.";
          break;
        }
        if (seguidos >= ERRORES_SEGUIDOS_PARA_PARAR) {
          motivo = "Amazon rechazó varias seguidas por lo mismo: corrige y vuelve a intentar.";
          break;
        }
        const variante = porSku.get(v.sku);
        if (!variante) {
          Object.assign(v, { estado: "error", error: "La variante ya no está en el pedido." });
          continue;
        }
        const errores = await mandar(cliente, v.sku, variante.esPadre ? cuerpoPadre(pedido) : cuerpoHijo(pedido, variante), false);
        if (errores.length) {
          Object.assign(v, { estado: "error", error: errores.join(" · ").slice(0, 600) });
          seguidos++;
          if (variante.esPadre) {
            motivo = "Amazon rechazó el padre: sin él no se crean las variantes.";
            await guardar("publicando", null);
            break;
          }
        } else {
          Object.assign(v, { estado: "publicada", error: null });
          seguidos = 0;
        }
        await guardar("publicando", null);
      }

      const r = resumenDeVariantes(variantes);
      const estado = r.pendientes ? "pendiente" : r.errores ? (r.publicadas ? "parcial" : "error") : "publicado";
      await guardar(estado, motivo);
      if (r.publicadas) {
        await invalidarApp(admin, cliente.cuenta.accountId, "Se creó un modelo nuevo en Amazon.", { claves: [CLAVE_OPCIONES] }).catch(() => undefined);
      }
    },
    "Ya se está creando otro producto en Amazon: espera a que termine.",
  );
}

export async function listarPublicacionesAmazon(admin: DB, cuentaMeliId: string): Promise<PublicacionGuardada[]> {
  return listarPublicaciones(admin, cuentaMeliId, 15, "amazon");
}
