/**
 * Envíos pendientes del sistema de Industher: lo que la bodega ya tiene
 * apartado para salir. Cuando el ID del envío empieza con 7 u 8 (número),
 * es un envío a Mercado Envíos Full — así los captura el almacén.
 *
 * Estos envíos alimentan la sección de Envíos a Full: se muestran arriba
 * como "en camino considerado", el usuario puede TACHAR el que no deba
 * contar, y cuando la bodega lo marca recibido (deja de venir en el API)
 * desaparece solo.
 *
 * La forma exacta del API aún no está confirmada: se prueban varias rutas
 * y un normalizador tolerante reporta qué encontró — si nada contesta, la
 * pantalla lo dice tal cual para poder ajustar la ruta real.
 */
import type { DB } from "../datos/repos";
import { configuracionIndusther } from "./industher";

export interface EnvioPendiente {
  id: string;
  /** true cuando el ID empieza con 7 u 8: envío a MELI Full */
  esMeli: boolean;
  fecha: string | null;
  destino: string | null;
  cajas: number;
  pares: number;
  /** renglones con SKU cuando el API los trae; vacío si no */
  filas: { sku: string; cantidad: number }[];
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
  datos: { filas: Record<string, unknown>[]; ruta: string } | null;
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

/**
 * Descarga los envíos pendientes probando las rutas candidatas. Devuelve
 * null si ninguna contesta con una lista reconocible.
 */
export async function descargarEnviosPendientes(): Promise<
  { filas: Record<string, unknown>[]; ruta: string } | null
> {
  const config = configuracionIndusther();
  if (!config) return null;

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
      if (lista) return { filas: lista, ruta };
    } catch {
      continue;
    }
  }
  return null;
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

  let descarga;
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
        "El API de Industher no contestó en ninguna de las rutas de envíos pendientes (envios-pendientes, envios, salidas).",
    };
  }

  // Agrupar renglones por el ID del envío.
  const porId = new Map<string, EnvioPendiente>();
  for (const f of descarga.filas) {
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
    if (sku && pares > 0) e.filas.push({ sku, cantidad: pares });
    porId.set(id, e);
  }

  const envios = [...porId.values()].sort((a, b) => b.pares - a.pares);

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

/**
 * Pares "en camino a Full" según los envíos pendientes de MELI (id 7/8) NO
 * tachados, por SKU. Es lo que el plan descuenta como ya-viajando. Solo
 * sirve cuando el API trae renglones con SKU; si no, regresa vacío.
 */
export function enCaminoDesdePendientes(p: PendientesIndusther): Map<string, number> {
  const porSku = new Map<string, number>();
  for (const e of p.envios) {
    if (!e.esMeli || e.omitido) continue;
    for (const f of e.filas) {
      porSku.set(f.sku, (porSku.get(f.sku) ?? 0) + f.cantidad);
    }
  }
  return porSku;
}
