/**
 * El lado de la base de la conciliación de MELI: `ordenes_neto` sumada por
 * venta (RPC `ordenes_neto_por_venta`, migración 0074) para el rango del
 * reporte, y el cruce puro de `conciliar-ventas.ts`.
 */
import { traerRpcTodo, type DB } from "../datos/repos";
import { conciliarVentas, type InformeVentasMeli, type VentaErp, type VentaReporte } from "./conciliar-ventas";

export async function conciliarVentasMeli(db: DB, meliAccountId: string, reporte: VentaReporte[]): Promise<InformeVentasMeli> {
  if (!reporte.length) throw new Error("El reporte no trae ventas.");
  const fechas = reporte.map((v) => v.fecha).filter((f): f is string => Boolean(f)).sort();
  if (!fechas.length) throw new Error("No pude leer las fechas del reporte (columna «Fecha de venta»).");
  // Un paquete lleva la fecha de su primera orden y el reporte la del paquete: un día de holgura.
  const desde = new Date(Date.parse(fechas[0]) - 86_400_000).toISOString().slice(0, 10);
  const hasta = new Date(Date.parse(fechas[fechas.length - 1]) + 86_400_000).toISOString().slice(0, 10);
  const r = await traerRpcTodo<Record<string, unknown>>(db, "ordenes_neto_por_venta", { p_account: meliAccountId, p_desde: desde, p_hasta: hasta });
  if (r.error) throw new Error(r.error);
  const num = (x: unknown) => Number(x) || 0;
  const erp: VentaErp[] = r.filas.map((f) => ({
    venta: String(f.venta),
    ordenes: num(f.ordenes),
    fecha: String(f.fecha ?? ""),
    estados: String(f.estados ?? ""),
    tipo_venta: (f.tipo_venta as string | null) ?? null,
    total: num(f.total),
    comision: num(f.comision),
    envio: num(f.envio),
    isr: num(f.isr),
    iva: num(f.iva),
    otros: num(f.otros),
    sin_desglosar: num(f.sin_desglosar),
    neto: num(f.neto),
    sin_neto: num(f.sin_neto),
    reembolsado: num(f.reembolsado),
    con_pago_real: num(f.con_pago_real),
  }));
  return conciliarVentas(reporte, erp);
}
