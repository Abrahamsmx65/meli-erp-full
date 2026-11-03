/**
 * Los ESTADOS DE CUENTA de TikTok Shop (pedido del dueño, 9-oct-2026: «de
 * TikTok checa si no hay más cargos»).
 *
 * El ERP lee el dinero de TikTok pedido por pedido (`liquidacion.ts`): lo
 * que cada pedido liquidó o va a liquidar, con comisión, afiliados, envío y
 * retenciones adentro. Lo que TikTok cobra o abona SIN pedido —ajustes,
 * compensaciones, penalizaciones, cargos de logística— no vive en ningún
 * pedido: vive en el estado de cuenta (`GET /finance/202309/statements`,
 * uno por liquidación, con `settlement_amount`, `revenue_amount`,
 * `fee_amount`, `shipping_cost_amount` y `adjustment_amount`; la forma sale
 * del SDK público de TikTok en npm). Su `adjustment_amount` es justo eso y
 * hasta hoy no entraba al corte.
 *
 * Motor puro: interpreta la respuesta y suma los ajustes de un periodo por
 * la FECHA DEL ESTADO en hora de México (como Amazon, por fecha de
 * asiento). El signo es el de TikTok: negativo = cargo, positivo = abono.
 */

export interface EstadoCuentaTikTok {
  id: string;
  /** segundos epoch */
  fecha: number;
  /** YYYY-MM-DD en México */
  dia: string;
  liquidado: number;
  ingreso: number;
  cargos: number;
  envio: number;
  ajustes: number;
  estadoPago: string | null;
}

const num = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};

/** YYYY-MM-DD en México (UTC−6 fijo) de un instante en segundos. */
export function diaMxDeSegundos(seg: number): string {
  return new Date(seg * 1000 - 6 * 3_600_000).toISOString().slice(0, 10);
}

/** Los estados de una página de `/finance/202309/statements` (tolera la lista en la raíz o bajo `data`). */
export function interpretarEstados(crudo: any): EstadoCuentaTikTok[] {
  const lista: any[] = Array.isArray(crudo?.statements) ? crudo.statements : Array.isArray(crudo?.data?.statements) ? crudo.data.statements : [];
  const salida: EstadoCuentaTikTok[] = [];
  for (const e of lista) {
    const id = e?.id != null ? String(e.id) : null;
    const fecha = Number(e?.statement_time);
    if (!id || !Number.isFinite(fecha) || fecha <= 0) continue;
    salida.push({
      id,
      fecha,
      dia: diaMxDeSegundos(fecha),
      liquidado: num(e.settlement_amount),
      ingreso: num(e.revenue_amount),
      cargos: num(e.fee_amount),
      envio: num(e.shipping_cost_amount),
      ajustes: num(e.adjustment_amount),
      estadoPago: e.payment_status ?? null,
    });
  }
  return salida;
}

/** Junta páginas nuevas con lo ya guardado: el mismo estado se reemplaza por su versión más nueva. Orden por fecha. */
export function unirEstados(guardados: EstadoCuentaTikTok[], nuevos: EstadoCuentaTikTok[]): EstadoCuentaTikTok[] {
  const porId = new Map(guardados.map((e) => [e.id, e]));
  for (const e of nuevos) porId.set(e.id, e);
  return [...porId.values()].sort((a, b) => a.fecha - b.fecha || a.id.localeCompare(b.id));
}

export interface AjustesDelPeriodo {
  /** estados de cuenta con fecha dentro del periodo */
  estados: number;
  /** lo que TikTok liquidó en esos estados (todo: pedidos + ajustes) */
  liquidado: number;
  /** suma de `adjustment_amount`: negativo = TikTok cobró, positivo = abonó */
  ajustes: number;
  /** los estados con ajuste, para enseñarlos */
  conAjuste: { dia: string; id: string; ajustes: number }[];
}

const c = (x: number) => Math.round(x * 100);
const p = (cent: number) => Math.round(cent) / 100 || 0;

export function ajustesDelPeriodo(estados: EstadoCuentaTikTok[], desde: string, hasta: string): AjustesDelPeriodo {
  let liquidado = 0;
  let ajustes = 0;
  let n = 0;
  const conAjuste: AjustesDelPeriodo["conAjuste"] = [];
  for (const e of estados) {
    if (e.dia < desde || e.dia > hasta) continue;
    n += 1;
    liquidado += c(e.liquidado);
    ajustes += c(e.ajustes);
    if (Math.abs(e.ajustes) >= 0.01) conAjuste.push({ dia: e.dia, id: e.id, ajustes: e.ajustes });
  }
  return { estados: n, liquidado: p(liquidado), ajustes: p(ajustes), conAjuste };
}
