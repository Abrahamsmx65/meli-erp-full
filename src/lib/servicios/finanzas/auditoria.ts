/**
 * Auditoría por orden: la cascada de UNA venta tal como quedó guardada,
 * para abrirla en Mercado Pago (o en el reporte "Ventas MX") y cotejar al
 * centavo. Es la prueba que el dueño hace en su celular.
 *
 * La muestra (20 mayores + 20 leídas más recientemente) viaja dentro del
 * renglón masticado de finanzas: la pantalla no consulta nada al pintar.
 * El Excel con TODAS las órdenes del rango se genera al pedirlo, acotado
 * por los dos lados del rango y paginado.
 */
import ExcelJS from "exceljs";
import { traerTodo, type DB } from "../../datos/repos";
import { aCentavos } from "./motor";
import type { AuditoriaFinanzas, OrdenAuditada } from "./tipos";

export const COLUMNAS_AUDITORIA =
  "order_id, fecha, tipo_venta, total, total_comprador, comision_mp, envio_mp, isr_mp, iva_mp, retencion_mp, otros_mp, cargos_sin_desglosar, neto, neto_actual, neto_calculado, reembolsado, estado, estado_pago, cargos_fuente, cargos_completos, libera_en, actualizado_en";

/** De la fila de `ordenes_neto` a la orden auditada (centavos). Pura. */
export function ordenAuditadaDeFila(f: Record<string, unknown>): OrdenAuditada {
  const n = (x: unknown) => aCentavos(Number(x) || 0);
  return {
    orderId: String(f.order_id),
    fecha: String(f.fecha),
    tipoVenta: f.tipo_venta === "reventa" ? "reventa" : f.tipo_venta === "directa" ? "directa" : null,
    total: n(f.total),
    totalComprador: f.total_comprador == null ? null : n(f.total_comprador),
    comision: n(f.comision_mp),
    envio: n(f.envio_mp),
    isr: n(f.isr_mp),
    iva: n(f.iva_mp),
    retencionSinSeparar: n(f.retencion_mp),
    otros: n(f.otros_mp),
    sinDesglosar: n(f.cargos_sin_desglosar),
    neto: n(f.neto_actual ?? f.neto),
    netoCalculado: f.neto_calculado == null ? null : n(f.neto_calculado),
    reembolsado: n(f.reembolsado),
    estado: typeof f.estado === "string" ? f.estado : null,
    estadoPago: typeof f.estado_pago === "string" ? f.estado_pago : null,
    fuente: typeof f.cargos_fuente === "string" ? f.cargos_fuente : null,
    completa: f.cargos_completos == null ? null : Boolean(f.cargos_completos),
    liberaEn: typeof f.libera_en === "string" ? f.libera_en : null,
  };
}

/** La muestra que se guarda con el renglón: dos consultas chicas y acotadas. */
export async function leerAuditoria(
  db: DB,
  accountId: string,
  rango: { desde: string; hasta: string },
): Promise<AuditoriaFinanzas> {
  const base = () =>
    db
      .from("ordenes_neto")
      .select(COLUMNAS_AUDITORIA)
      .eq("account_id", accountId)
      .gte("fecha", rango.desde)
      .lte("fecha", rango.hasta)
      .or("estado.is.null,estado.neq.cancelled");
  const [mayores, recientes] = await Promise.all([
    base().order("total", { ascending: false }).order("order_id", { ascending: true }).limit(20),
    base().order("actualizado_en", { ascending: false }).order("order_id", { ascending: true }).limit(20),
  ]);
  if (mayores.error) throw new Error(`auditoría (mayores): ${mayores.error.message}`);
  if (recientes.error) throw new Error(`auditoría (recientes): ${recientes.error.message}`);
  return {
    mayores: (mayores.data ?? []).map((f) => ordenAuditadaDeFila(f as Record<string, unknown>)),
    recientes: (recientes.data ?? []).map((f) => ordenAuditadaDeFila(f as Record<string, unknown>)),
  };
}

/** TODAS las órdenes del rango (para el Excel), paginadas con orden estable. */
export async function ordenesDelRangoParaAuditar(
  db: DB,
  accountId: string,
  rango: { desde: string; hasta: string },
): Promise<OrdenAuditada[]> {
  const filas = await traerTodo<Record<string, unknown>>(db, "ordenes_neto", COLUMNAS_AUDITORIA, (q) =>
    q.eq("account_id", accountId).gte("fecha", rango.desde).lte("fecha", rango.hasta),
  );
  return filas
    .map(ordenAuditadaDeFila)
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.orderId.localeCompare(b.orderId)));
}

const MONEDA = '"$"#,##0.00';
const pesos = (c: number | null) => (c == null ? null : Math.round(c) / 100);

/** Excel de auditoría: una fila por orden con su cascada, números como números. */
export async function excelDeAuditoria(
  ordenes: OrdenAuditada[],
  rango: { desde: string; hasta: string },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERP";
  const hoja = wb.addWorksheet("Órdenes");
  const columnas: { header: string; key: string; width?: number; moneda?: boolean }[] = [
    { header: "Orden", key: "orderId", width: 20 },
    { header: "Fecha", key: "fecha", width: 12 },
    { header: "Tipo", key: "tipoVenta", width: 10 },
    { header: "Estado", key: "estado", width: 12 },
    { header: "Pago", key: "estadoPago", width: 12 },
    { header: "Total", key: "total", moneda: true },
    { header: "Precio público (reventa)", key: "totalComprador", width: 22, moneda: true },
    { header: "Comisión", key: "comision", moneda: true },
    { header: "Envío", key: "envio", moneda: true },
    { header: "ISR", key: "isr", moneda: true },
    { header: "IVA", key: "iva", moneda: true },
    { header: "Retención sin separar", key: "retencionSinSeparar", width: 20, moneda: true },
    { header: "Otros", key: "otros", moneda: true },
    { header: "Sin desglosar", key: "sinDesglosar", moneda: true },
    { header: "Neto depositado", key: "neto", moneda: true },
    { header: "Neto por cargos", key: "netoCalculado", moneda: true },
    { header: "Reembolsado", key: "reembolsado", moneda: true },
    { header: "Fuente del desglose", key: "fuente", width: 18 },
    { header: "Comisión completa", key: "completa", width: 16 },
    { header: "Libera", key: "liberaEn", width: 22 },
  ];
  hoja.columns = columnas.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 14 }));
  hoja.getRow(1).font = { bold: true };
  hoja.views = [{ state: "frozen", ySplit: 1 }];
  for (const c of columnas) if (c.moneda) hoja.getColumn(c.key).numFmt = MONEDA;
  for (const o of ordenes) {
    hoja.addRow({
      orderId: o.orderId,
      fecha: o.fecha,
      tipoVenta: o.tipoVenta ?? "",
      estado: o.estado ?? "",
      estadoPago: o.estadoPago ?? "",
      total: pesos(o.total),
      totalComprador: pesos(o.totalComprador),
      comision: pesos(o.comision),
      envio: pesos(o.envio),
      isr: pesos(o.isr),
      iva: pesos(o.iva),
      retencionSinSeparar: pesos(o.retencionSinSeparar),
      otros: pesos(o.otros),
      sinDesglosar: pesos(o.sinDesglosar),
      neto: pesos(o.neto),
      netoCalculado: pesos(o.netoCalculado),
      reembolsado: pesos(o.reembolsado),
      fuente: o.fuente ?? "sin leer",
      completa: o.completa == null ? "" : o.completa ? "sí" : "no",
      liberaEn: o.liberaEn ? o.liberaEn.slice(0, 16).replace("T", " ") : "",
    });
  }
  const notas = wb.addWorksheet("Léeme");
  notas.addRow([`Órdenes de Mercado Libre del ${rango.desde} al ${rango.hasta}: ${ordenes.length}.`]);
  notas.addRow(["Cada renglón es lo guardado en el ERP para esa orden; cotéjalo contra Mercado Pago o el reporte Ventas MX."]);
  notas.addRow(["Fuente «v1/payments» = desglose del pago real (retenciones y envío exactos). «collections» = forma vieja del pago. «sin leer» = todavía no se ha leído."]);
  notas.addRow(["Reventa: el precio público se reconstruye con la tarifa de la categoría y el envío del paquete; comisión y envío se contemplan aunque MELI los absorbe. El neto es siempre lo depositado."]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
