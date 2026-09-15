/**
 * El lado de la base de la conciliación de Amazon: lee por RPC lo que el
 * ERP tiene en el rango del reporte y llama al cruce puro de `conciliar.ts`.
 */
import { traerRpcTodo, type DB } from "../datos/repos";
import { conciliar, leerReporteTransacciones, type GrupoErp, type InformeConciliacion, type OrdenErp, type RenglonReporte, type SueltoErp } from "./conciliar";

/** Desde el texto del CSV (pruebas, scripts). */
export async function conciliarReporte(db: DB, amazonAccountId: string, texto: string): Promise<InformeConciliacion> {
  return conciliarRenglones(db, amazonAccountId, leerReporteTransacciones(texto));
}

/** Lee el lado del ERP para el rango del reporte (ya leído) y cruza. */
export async function conciliarRenglones(db: DB, amazonAccountId: string, reporte: RenglonReporte[]): Promise<InformeConciliacion> {
  if (!reporte.length) throw new Error("El reporte no trae renglones.");
  const fechas = reporte.map((r) => r.fechaIso).filter((f): f is string => Boolean(f)).sort();
  if (!fechas.length) throw new Error("No pude leer las fechas del reporte (columna fecha/hora).");
  const desde = fechas[0];
  const hasta = fechas[fechas.length - 1];
  const params = { p_account: amazonAccountId, p_desde: desde, p_hasta: hasta };
  const [ordenes, sueltos, grupos] = await Promise.all([
    traerRpcTodo<OrdenErp>(db, "amazon_finanzas_por_orden", params),
    traerRpcTodo<SueltoErp>(db, "amazon_finanzas_sueltos", params),
    traerRpcTodo<GrupoErp>(db, "amazon_finanzas_cobertura", { p_account: amazonAccountId, p_desde: desde.slice(0, 10), p_hasta: hasta.slice(0, 10) }),
  ]);
  for (const r of [ordenes, sueltos, grupos]) if (r.error) throw new Error(r.error);
  return conciliar(
    reporte,
    ordenes.filas.map((o) => ({ ...o, eventos: Number(o.eventos), monto: Number(o.monto) })),
    sueltos.filas.map((s) => ({ ...s, monto: s.monto == null ? null : Number(s.monto) })),
    grupos.filas.map((g) => ({ ...g, total_original: g.total_original == null ? null : Number(g.total_original), suma_eventos: g.suma_eventos == null ? null : Number(g.suma_eventos) })),
  );
}
