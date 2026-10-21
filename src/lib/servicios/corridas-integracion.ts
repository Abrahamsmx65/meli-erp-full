/**
 * Las corridas de la sección Corridas, en la forma en que Industher las lee
 * (`GET /api/integracion/corridas`; dueño, 21-oct-2026: «que Industher jale
 * nuestra información, solo lo de las corridas»). El ERP NO le escribe a
 * Industher: su sistema pide y el ERP contesta, igual que el ERP le pide su
 * inventario.
 *
 * Una corrida es la receta de UNA caja: pedido + modelo + color → pares por
 * talla. La caja de una sola talla se guarda con la talla pegada al color
 * (`IN10121 · GT114 · TABACO BROWN-25 · { "25": 24 }`); aquí se separa para
 * que Industher no tenga que adivinar. El barcode es el de la etiqueta de
 * caja que se mandó a China (`codigoDeCaja`).
 */
import { codigoDeCaja } from "./bodega-contenedor";

export interface FilaCorrida {
  pedido: string;
  modelo: string;
  color: string;
  tallas: Record<string, unknown> | null;
  total: number | null;
  origen: string | null;
  actualizado_en: string | null;
}

export interface CorridaIndusther {
  pedido: string;
  modelo: string;
  /** el color sin la talla pegada (en una caja de corrida, el color tal cual) */
  color: string;
  /** true = caja de UNA sola talla */
  unitalla: boolean;
  /** la talla de la caja unitalla; null en una caja de corrida */
  talla: string | null;
  /** pares por talla dentro de UNA caja: { "23": 5, "24": 10 } */
  tallas: Record<string, number>;
  /** pares por caja (suma de tallas) */
  paresPorCaja: number;
  /** PEDIDO-MODELO-COLOR(-TALLA), sin espacios: la etiqueta de la caja */
  barcode: string;
  /** como la escribe el ERP: "IN10121|GT114|TABACO BROWN-25" (la llave) */
  clave: string;
  origen: string;
  actualizadoEn: string | null;
}

function tallasLimpias(tallas: Record<string, unknown> | null): Record<string, number> {
  const fuera: Record<string, number> = {};
  for (const [t, v] of Object.entries(tallas ?? {})) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) fuera[String(t).trim()] = n;
  }
  return fuera;
}

export function corridaParaIndusther(f: FilaCorrida): CorridaIndusther {
  const tallas = tallasLimpias(f.tallas);
  const llaves = Object.keys(tallas);
  const pedido = String(f.pedido ?? "").trim();
  const modelo = String(f.modelo ?? "").trim();
  const colorGuardado = String(f.color ?? "").trim();

  // Unitalla = una sola talla Y el color termina con esa talla («BLK-24»).
  // Una corrida de una talla sin el sufijo (vieja, capturada a mano) se
  // enseña como unitalla pero con el color como está.
  let color = colorGuardado;
  let talla: string | null = null;
  if (llaves.length === 1) {
    talla = llaves[0];
    const sufijo = `-${talla}`;
    if (colorGuardado.toUpperCase().endsWith(sufijo.toUpperCase()) && colorGuardado.length > sufijo.length) {
      color = colorGuardado.slice(0, -sufijo.length).trim();
    }
  }
  const paresPorCaja = Object.values(tallas).reduce((s, n) => s + n, 0);

  return {
    pedido,
    modelo,
    color,
    unitalla: talla !== null,
    talla,
    tallas,
    paresPorCaja: paresPorCaja || Number(f.total ?? 0) || 0,
    barcode: codigoDeCaja(pedido, modelo, color, talla),
    clave: `${pedido}|${modelo}|${colorGuardado}`,
    origen: f.origen ?? "excel",
    actualizadoEn: f.actualizado_en ?? null,
  };
}

/** Tope por página, igual que el API de inventario de Industher. */
export const LIMITE_CORRIDAS = 1000;

export function leerPaginacion(params: URLSearchParams): { limit: number; offset: number; desde: string | null } | { error: string } {
  const limit = params.has("limit") ? Number(params.get("limit")) : LIMITE_CORRIDAS;
  const offset = params.has("offset") ? Number(params.get("offset")) : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMITE_CORRIDAS) return { error: `limit va de 1 a ${LIMITE_CORRIDAS}.` };
  if (!Number.isInteger(offset) || offset < 0) return { error: "offset debe ser un entero ≥ 0." };
  const crudo = params.get("desde");
  let desde: string | null = null;
  if (crudo) {
    const ms = Date.parse(crudo);
    if (!Number.isFinite(ms)) return { error: "desde debe ser una fecha ISO (2026-10-21T00:00:00Z)." };
    desde = new Date(ms).toISOString();
  }
  return { limit, offset, desde };
}
