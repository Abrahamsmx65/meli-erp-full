/**
 * Envíos pendientes del sistema de Industher: lo que la bodega ya tiene
 * apartado para salir. Cuando el ID del envío empieza con 7 u 8 (número),
 * es un envío a Mercado Envíos Full — así los captura el almacén.
 *
 * Desde que el almacén publicó el bloque `pendingShipments`, los envíos
 * vienen DENTRO del mismo endpoint de inventario, cada uno con su
 * referencia, destino, fecha y sus productos (SKU, modelo, color, talla,
 * cajas y pares). El `boxes.available` del inventario YA descuenta esas
 * cajas, así que aquí solo se suma el "en camino" a Full — sin doble
 * conteo. Las rutas candidatas viejas quedan de respaldo.
 *
 * Estos envíos alimentan la sección de Envíos a Full: se muestran arriba
 * como "en camino considerado", el usuario puede TACHAR el que no deba
 * contar, y cuando la bodega lo confirma o cancela (deja de venir en el
 * API) desaparece solo.
 */
import type { DB } from "../datos/repos";
import { buscarVariante, type IndiceCatalogo } from "../etiquetas/resolver";
import { canonizar } from "../importar/sku";
import { numeroDePedido } from "./compras";
import { configuracionIndusther } from "./industher";

export interface FilaPendiente {
  /** el SKU tal como lo escribe la bodega */
  sku: string;
  /** el pedido a China del que sale la caja (orderNumber: IN10099, RT04…) */
  pedido: string;
  modelo: string;
  color: string;
  /** la talla, o "Corrida" cuando la caja es mixta */
  talla: string;
  cajas: number;
  paresPorCaja: number;
  /** pares totales de la fila */
  cantidad: number;
}

/** true cuando la fila es una caja mixta: su reparto por talla sale de la corrida. */
export function esFilaCorrida(f: FilaPendiente): boolean {
  return /^corrida$/i.test(f.talla);
}

export interface EnvioPendiente {
  id: string;
  /** true cuando el ID empieza con 7 u 8: envío a MELI Full */
  esMeli: boolean;
  fecha: string | null;
  destino: string | null;
  cajas: number;
  pares: number;
  /** renglones con SKU cuando el API los trae; vacío si no */
  filas: FilaPendiente[];
  /** true = el usuario lo tachó y no cuenta para el plan */
  omitido: boolean;
}

export interface PendientesIndusther {
  envios: EnvioPendiente[];
  /** aviso cuando el API no contestó o la forma no se reconoció */
  error: string | null;
}

const RUTAS_CANDIDATAS = ["envios-pendientes", "envios", "salidas", "pendientes"];

// La descarga del API se guarda 3 minutos en memoria: la página de Envíos
// la lee en cada carga y no tiene caso pegarle a Industher cada vez. Las
// marcas de tachado NO se cachean — se leen frescas de la base siempre.
let cacheDescarga: {
  t: number;
  datos: EnvioPendiente[] | null;
} | null = null;
const TTL_DESCARGA_MS = 3 * 60_000;

function texto(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function numero(v: unknown): number {
  const n = Number(String(v ?? "").replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Busca la primera lista de objetos dentro de la respuesta. */
function extraerLista(cuerpo: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(cuerpo)) return cuerpo as Record<string, unknown>[];
  if (cuerpo && typeof cuerpo === "object") {
    for (const v of Object.values(cuerpo)) {
      if (Array.isArray(v) && (!v.length || typeof v[0] === "object")) {
        return v as Record<string, unknown>[];
      }
    }
  }
  return null;
}

function campo(f: Record<string, unknown>, nombres: string[]): unknown {
  const llaves = Object.keys(f);
  for (const n of nombres) {
    const k = llaves.find((x) => x.toLowerCase().replace(/[^a-z0-9]/g, "") === n);
    if (k !== undefined) return f[k];
  }
  return undefined;
}

/** Una cantidad que puede venir como número o como objeto anidado del API
 * ({ total, physical, available… }): se toma el primer campo con sentido. */
function cantidadDe(v: unknown): number {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return numero(o.total ?? o.physical ?? o.pairs ?? o.boxes ?? o.available);
  }
  return numero(v);
}

/**
 * Un envío del bloque `pendingShipments` del API, normalizado. La forma
 * real (verificada con el explorador el 2026-08-24): reference (a veces
 * vacía; id interno de respaldo), destination, occurredOn, boxes y pairs
 * planos, y los renglones en `lines` — `products` es solo un CONTEO.
 */
export function envioDeBloque(s: Record<string, unknown>): EnvioPendiente | null {
  const referencia = texto(
    campo(s, ["reference", "referencia", "shipmentnumber", "numeroenvio", "numero", "folio", "number"]),
  );
  const id = referencia || texto(campo(s, ["id"]));
  if (!id) return null;

  const destino = texto(campo(s, ["destination", "destino", "cliente", "almacendestino"])) || null;

  const lineasCrudas = campo(s, ["lines", "productos", "items", "renglones", "detalle"]);
  const lineas = Array.isArray(lineasCrudas) ? (lineasCrudas as Record<string, unknown>[]) : [];

  const filas: FilaPendiente[] = [];
  let cajasLineas = 0;
  let paresLineas = 0;
  for (const p of lineas) {
    const sku = texto(campo(p, ["sku", "skucaja", "codigo", "clave"]));
    const cajasP = cantidadDe(campo(p, ["boxes", "cajas", "cantidadcajas"]));
    const paresP = cantidadDe(campo(p, ["pairs", "pares", "piezas", "unidades"]));
    cajasLineas += cajasP;
    paresLineas += paresP;
    if (sku && paresP > 0) {
      filas.push({
        sku,
        pedido: texto(campo(p, ["ordernumber", "pedido", "orden"])),
        modelo: texto(campo(p, ["model", "modelo"])),
        color: texto(campo(p, ["color"])),
        talla: texto(campo(p, ["size", "talla"])),
        cajas: cajasP,
        paresPorCaja: cantidadDe(campo(p, ["pairsperbox", "paresporcaja"])),
        cantidad: paresP,
      });
    }
  }

  return {
    id,
    // La señal fuerte es el DESTINO que captura el almacén; la regla del
    // ID 7/8 queda de refuerzo para referencias de MELI sin destino.
    esMeli: /MERCADO\s*LIBRE|MELI|FULL/i.test(destino ?? "") || /^[78]/.test(referencia),
    fecha: texto(campo(s, ["occurredon", "date", "fecha", "createdat", "creado", "fechasalida"])) || null,
    destino,
    cajas: cantidadDe(campo(s, ["boxes", "totalboxes", "cajas"])) || cajasLineas,
    pares: cantidadDe(campo(s, ["pairs", "totalpairs", "pares"])) || paresLineas,
    filas,
    omitido: false,
  };
}

/**
 * Descarga los envíos pendientes. La fuente principal es el bloque
 * `pendingShipments` del PROPIO endpoint de inventario (así lo publicó el
 * almacén); las rutas candidatas viejas quedan de respaldo. Devuelve null
 * si nada contesta con una forma reconocible.
 */
export async function descargarEnviosPendientes(): Promise<EnvioPendiente[] | null> {
  const config = configuracionIndusther();
  if (!config) return null;

  // 1) El bloque pendingShipments del endpoint de inventario. Se pide con
  //    limit=1 porque el inventario en sí no interesa aquí, solo el bloque.
  try {
    const url = new URL(config.url);
    url.searchParams.set("limit", "1");
    url.searchParams.set("offset", "0");
    const r = await fetch(url, {
      headers: { "x-api-key": config.apiKey, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (r.ok) {
      const cuerpo = (await r.json().catch(() => null)) as Record<string, unknown> | null;
      const bloque = cuerpo?.pendingShipments as Record<string, unknown> | undefined;
      const lista = bloque?.shipments;
      if (Array.isArray(lista)) {
        return (lista as Record<string, unknown>[])
          .map(envioDeBloque)
          .filter((e): e is EnvioPendiente => e !== null);
      }
    }
  } catch {
    // se intenta el respaldo
  }

  // 2) Respaldo: las rutas candidatas de antes (renglones planos por envío).
  const base = config.url.replace(/\/[^/]*$/, "");
  for (const ruta of RUTAS_CANDIDATAS) {
    try {
      const r = await fetch(`${base}/${ruta}`, {
        headers: { "x-api-key": config.apiKey, accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) continue;
      const cuerpo = await r.json().catch(() => null);
      const lista = extraerLista(cuerpo);
      if (lista) return agruparFilasPlanas(lista);
    } catch {
      continue;
    }
  }
  return null;
}

/** El formato viejo de respaldo: renglones sueltos que se agrupan por ID. */
function agruparFilasPlanas(filas: Record<string, unknown>[]): EnvioPendiente[] {
  const porId = new Map<string, EnvioPendiente>();
  for (const f of filas) {
    const id = texto(
      campo(f, ["id", "envioid", "idenvio", "folio", "numeroenvio", "envio", "referencia"]),
    );
    if (!id) continue;
    const e =
      porId.get(id) ??
      ({
        id,
        esMeli: /^[78]/.test(id),
        fecha: texto(campo(f, ["fecha", "fechasalida", "creado", "createdat"])) || null,
        destino: texto(campo(f, ["destino", "cliente", "almacendestino"])) || null,
        cajas: 0,
        pares: 0,
        filas: [],
        omitido: false,
      } satisfies EnvioPendiente);

    e.cajas += numero(campo(f, ["cajas", "cajasfisicas", "cantidadcajas"])) || 0;
    const pares = numero(campo(f, ["pares", "piezas", "cantidad", "unidades"])) || 0;
    e.pares += pares;
    const sku = texto(campo(f, ["sku", "skucaja", "codigo", "clave"]));
    if (sku && pares > 0) {
      e.filas.push({
        sku,
        pedido: texto(campo(f, ["ordernumber", "pedido", "orden"])),
        modelo: texto(campo(f, ["model", "modelo"])),
        color: texto(campo(f, ["color"])),
        talla: texto(campo(f, ["size", "talla"])),
        cajas: numero(campo(f, ["cajas", "cajasfisicas", "cantidadcajas"])) || 0,
        paresPorCaja: numero(campo(f, ["pairsperbox", "paresporcaja"])) || 0,
        cantidad: pares,
      });
    }
    porId.set(id, e);
  }
  return [...porId.values()];
}

/**
 * Los envíos pendientes agrupados por ID, con la marca de omitido del
 * usuario ya puesta. Un fallo del API regresa la lista vacía CON el error,
 * nunca revienta la página.
 */
export async function enviosPendientesIndusther(
  db: DB,
  accountId: string,
): Promise<PendientesIndusther> {
  if (!configuracionIndusther()) {
    return { envios: [], error: null };
  }

  let descarga: EnvioPendiente[] | null;
  try {
    if (cacheDescarga && Date.now() - cacheDescarga.t < TTL_DESCARGA_MS) {
      descarga = cacheDescarga.datos;
    } else {
      descarga = await descargarEnviosPendientes();
      cacheDescarga = { t: Date.now(), datos: descarga };
    }
  } catch (err) {
    return { envios: [], error: (err as Error).message.slice(0, 200) };
  }
  if (!descarga) {
    return {
      envios: [],
      error:
        "El API de Industher no trajo el bloque pendingShipments ni contestó en las rutas de respaldo.",
    };
  }

  const envios = [...descarga].sort((a, b) => b.pares - a.pares);

  // Los tachados por el usuario. Si la tabla no existe todavía (migración
  // pendiente), simplemente nadie está tachado.
  try {
    const { data } = await db
      .from("envios_pendientes_omitidos")
      .select("envio_id")
      .eq("account_id", accountId);
    const omitidos = new Set((data ?? []).map((x: { envio_id: string }) => x.envio_id));
    for (const e of envios) e.omitido = omitidos.has(e.id);
  } catch {
    // sin tabla: se sigue sin marcas
  }

  return { envios, error: null };
}

/** Lo que la expansión necesita saber de una corrida ya cargada. */
export interface CorridaParaPendientes {
  pedido: string;
  modelo: string;
  color: string;
  /** talla -> pares POR CAJA */
  tallas: Record<string, number>;
}

/**
 * El SKU de MELI de un modelo+color+talla de la bodega, con el índice del
 * catálogo (mismos amarres que etiquetas). Sin índice, el SKU construido.
 */
function skuMeli(
  modelo: string,
  color: string,
  talla: string,
  indice?: IndiceCatalogo | null,
): string | null {
  if (!modelo || !talla) return null;
  if (indice) {
    const { construido, encontrado } = buscarVariante(indice, modelo, color, talla);
    return (encontrado?.sku as string | undefined) ?? construido;
  }
  return [modelo, color, talla].filter(Boolean).join("-");
}

/**
 * Una fila pendiente convertida a pares por SKU de MELI.
 *
 * Las filas de talla real van directo. Las de CORRIDA (cajas mixtas) se
 * reparten con la corrida REAL del pedido (talla -> pares por caja × cajas
 * de la fila): primero la corrida de su propio pedido, si no, la más
 * reciente del modelo+color. Sin corrida conocida no se reparte nada — no
 * se inventa un reparto.
 */
export function expandirFilaMeli(
  f: FilaPendiente,
  indice?: IndiceCatalogo | null,
  corridas?: CorridaParaPendientes[],
): { sku: string; cantidad: number }[] {
  if (!esFilaCorrida(f)) {
    const sku = skuMeli(f.modelo, f.color, f.talla, indice) ?? f.sku;
    return f.cantidad > 0 ? [{ sku, cantidad: f.cantidad }] : [];
  }

  if (!corridas?.length) return [];
  const clave = (m: string, c: string) => `${canonizar(m)}|${canonizar(c)}`;
  const mias = corridas.filter((c) => clave(c.modelo, c.color) === clave(f.modelo, f.color));
  const corrida =
    mias.find((c) => canonizar(c.pedido) === canonizar(f.pedido)) ??
    [...mias].sort((a, b) => numeroDePedido(b.pedido) - numeroDePedido(a.pedido))[0];
  if (!corrida) return [];

  const out: { sku: string; cantidad: number }[] = [];
  for (const [talla, porCaja] of Object.entries(corrida.tallas)) {
    const pares = (Number(porCaja) || 0) * f.cajas;
    if (pares <= 0) continue;
    const sku = skuMeli(f.modelo, f.color, talla, indice);
    if (sku) out.push({ sku, cantidad: pares });
  }
  return out;
}

/**
 * Pares "en camino a Full" según los envíos pendientes a MELI NO tachados,
 * por SKU de MELI y por talla exacta. Es lo que el plan cuenta como
 * ya-viajando. Solo sirve cuando el API trae renglones; si no, vacío.
 */
export function enCaminoDesdePendientes(
  p: PendientesIndusther,
  indice?: IndiceCatalogo | null,
  corridas?: CorridaParaPendientes[],
): Map<string, number> {
  const porSku = new Map<string, number>();
  for (const e of p.envios) {
    if (!e.esMeli || e.omitido) continue;
    for (const f of e.filas) {
      for (const { sku, cantidad } of expandirFilaMeli(f, indice, corridas)) {
        porSku.set(sku, (porSku.get(sku) ?? 0) + cantidad);
      }
    }
  }
  return porSku;
}
