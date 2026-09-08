/**
 * El bloque de Amazon para el corte general, desde el monitor de Amazon:
 * neto liquidado del reporte de pagos (o el del SKU Economics si no hay
 * liquidaciones en el rango), costo por modelo, publicidad por modelo del
 * SKU Economics, y los cargos de cuenta (FBA, almacenaje, suscripción) como
 * gasto general de la plataforma.
 */
import type { BloqueCanal } from "./consolidado";
import type { MonitorAmazon } from "./amazon-monitor";
import type { ConfigProducto } from "./productos";

export function bloqueAmazon(m: MonitorAmazon, config: Map<string, ConfigProducto>): BloqueCanal {
  const avisos: string[] = [];
  const hayPagos = m.netoReal != null;
  const hayEconomia = m.economia != null;
  const neto = hayPagos ? (m.netoReal as number) : hayEconomia ? m.economia!.neto : m.periodo.importe;
  if (!hayPagos && hayEconomia) avisos.push("Sin liquidaciones de Amazon en el rango: el neto es el del reporte de economía por producto (SKU Economics).");
  if (!hayPagos && !hayEconomia) avisos.push("Amazon sin liquidaciones ni economía por producto en el rango: el neto se tomó igual a la venta (comisiones y FBA sin descontar).");
  if (m.pagosHasta) avisos.push(`Liquidaciones de Amazon cargadas hasta ${m.pagosHasta}; Amazon liquida cada ~2 semanas.`);
  if (m.coberturaCosto < 0.999 && m.periodo.unidades > 0) {
    avisos.push(`${Math.round((1 - m.coberturaCosto) * 100)}% de las unidades de Amazon son de modelos sin costo capturado.`);
  }

  // Publicidad por modelo del SKU Economics; si no hay, la del reporte de
  // pagos entera como gasto general.
  const adsPorModelo = new Map<string, number>();
  let adsAmarrados = 0;
  for (const [modelo, gasto] of m.publicidadPorModelo) {
    const v = Math.abs(gasto);
    if (v > 0) {
      adsPorModelo.set(modelo, v);
      adsAmarrados += v;
    }
  }
  const adsPagos = Math.abs(m.publicidad ?? 0);
  const adsGenerales = adsAmarrados > 0 ? Math.max(0, adsPagos - adsAmarrados) : adsPagos;

  // Cada cargo de cuenta con su descripción de Amazon (negativo = cargo, así
  // un reembolso de Amazon por inventario perdido reduce el gasto). Si los
  // pagos vienen del formato viejo sin descripción, entra el total junto.
  const gastos: { concepto: string; monto: number }[] = [];
  if (m.otrosCargosDetalle?.length) {
    for (const d of m.otrosCargosDetalle) gastos.push({ concepto: `Amazon · ${d.concepto}`, monto: Math.round(-d.monto * 100) / 100 });
  } else {
    const otros = Math.abs(m.otrosCargos ?? 0);
    if (otros) gastos.push({ concepto: "Cargos de cuenta de Amazon (FBA, almacenaje, suscripción)", monto: Math.round(otros * 100) / 100 });
  }
  if (m.reservas) {
    avisos.push(
      `Amazon retuvo/soltó ${Math.abs(m.reservas).toLocaleString("es-MX", { style: "currency", currency: "MXN" })} en reservas durante el periodo: es dinero en tránsito, no gasto, y no se descuenta.`,
    );
  }
  if (adsGenerales) gastos.push({ concepto: "Publicidad de Amazon no amarrada a modelo", monto: Math.round(adsGenerales * 100) / 100 });

  // El neto por modelo: el liquidado del modelo si hay pagos; si no, la
  // venta del modelo por el ratio neto ÷ venta del canal.
  const ratio = m.periodo.importe > 0 ? neto / m.periodo.importe : 1;
  let costoProducto = 0;
  let unidadesConCosto = 0;
  const porModelo = m.porModelo
    .filter((f) => f.unidades > 0 || (f.netoReal ?? 0) !== 0)
    .map((f) => {
      const cfg = config.get(f.modelo);
      const costo = cfg?.costo != null && f.unidades > 0 ? Math.round(cfg.costo * f.unidades * 100) / 100 : cfg?.costo != null ? 0 : null;
      if (costo != null) {
        costoProducto += costo;
        unidadesConCosto += f.unidades;
      }
      const netoModelo = hayPagos && f.netoReal != null ? f.netoReal : Math.round(f.importe * ratio * 100) / 100;
      return {
        modelo: f.modelo,
        categoria: cfg?.categoria ?? null,
        unidades: f.unidades,
        importe: f.importe,
        neto: netoModelo,
        costo,
        ads: adsPorModelo.get(f.modelo) ?? 0,
      };
    });

  return {
    canal: "amazon",
    unidades: m.periodo.unidades,
    ordenes: m.periodo.ordenes,
    ventaBruta: m.periodo.importe,
    neto: Math.round(neto * 100) / 100,
    devoluciones: 0,
    costoRecuperado: 0,
    costoProducto: Math.round(costoProducto * 100) / 100,
    unidadesConCosto,
    adsPorModelo: Math.round(adsAmarrados * 100) / 100,
    adsGenerales: Math.round(adsGenerales * 100) / 100,
    gastos,
    porModelo,
    avisos,
    exacto: hayPagos && m.coberturaCosto >= 0.999,
  };
}
