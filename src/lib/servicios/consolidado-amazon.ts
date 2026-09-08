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

export function bloqueAmazon(m: MonitorAmazon, config: Map<string, ConfigProducto>, rango?: { desde: string; hasta: string }): BloqueCanal {
  const avisos: string[] = [];
  const hayPagos = m.netoReal != null;
  const eco = m.economia;
  const hayEconomia = eco != null && (eco.ventas > 0 || eco.unidades > 0);
  const coberturaEconomia =
    hayEconomia && m.periodo.importe > 0
      ? Math.min(1, Math.max(0, eco!.ventas / m.periodo.importe))
      : hayEconomia
        ? 1
        : null;

  // LO QUE AMAZON VA A PAGAR por lo vendido en el mes: ventas − tarifas del
  // SKU Economics, por fecha de venta. El `neto` de Amazon ya trae restada
  // la publicidad; se le regresa para descontarla aparte, por modelo. Las
  // liquidaciones (por fecha de depósito) quedan como referencia: un mes
  // recién cerrado todavía no está liquidado completo.
  const redondea = (x: number) => Math.round(x * 100) / 100;
  let neto: number;
  let fuente: "economia" | "pagos" | "venta";
  if (hayEconomia) {
    neto = redondea(eco!.neto + eco!.publicidad);
    fuente = "economia";
  } else if (hayPagos) {
    neto = m.netoReal as number;
    fuente = "pagos";
    avisos.push("Sin economía por producto (SKU Economics) en el rango: el neto es lo LIQUIDADO por Amazon en el periodo, no lo vendido.");
  } else {
    neto = m.periodo.importe;
    fuente = "venta";
    avisos.push("Amazon sin economía por producto ni liquidaciones en el rango: el neto se tomó igual a la venta (comisiones y FBA sin descontar).");
  }
  if (fuente === "economia") {
    if (eco!.hasta && rango && eco!.hasta < rango.hasta) {
      avisos.push(`La economía por producto de Amazon llega hasta el ${eco!.hasta}: los últimos días del periodo aún no están (Amazon tarda ~2 días en asentarlos).`);
    }
    if (coberturaEconomia != null && coberturaEconomia < 0.98) {
      avisos.push(
        `SKU Economics solo cubre el ${Math.round(coberturaEconomia * 100)}% de la venta bruta del periodo. El neto, la publicidad y la utilidad de Amazon son parciales y no deben compararse contra el total vendido.`,
      );
    }
    if (hayPagos) avisos.push(`Referencia: Amazon lleva liquidados ${redondea(m.netoReal as number).toLocaleString("es-MX", { style: "currency", currency: "MXN" })} de este periodo por fecha de depósito${m.pagosHasta ? ` (liquidaciones hasta ${m.pagosHasta})` : ""}.`);
  }
  if (m.coberturaCosto < 0.999 && m.periodo.unidades > 0) {
    avisos.push(`${Math.round((1 - m.coberturaCosto) * 100)}% de las unidades de Amazon son de modelos sin costo capturado.`);
  }

  // Publicidad por modelo del SKU Economics; lo que el reporte de pagos
  // cobró de más entra como gasto general.
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
  const adsGenerales = fuente === "economia" ? 0 : adsAmarrados > 0 ? Math.max(0, adsPagos - adsAmarrados) : adsPagos;

  // Cada cargo de cuenta con su descripción de Amazon (negativo = cargo, así
  // un reembolso de Amazon por inventario perdido reduce el gasto). Si los
  // pagos vienen del formato viejo sin descripción, entra el total junto.
  const gastos: { concepto: string; monto: number }[] = [];
  if (m.otrosCargosDetalle?.length) {
    for (const d of m.otrosCargosDetalle) gastos.push({ concepto: `Amazon · ${d.concepto}`, monto: redondea(-d.monto) });
  } else {
    const otros = Math.abs(m.otrosCargos ?? 0);
    if (otros) gastos.push({ concepto: "Cargos de cuenta de Amazon (FBA, almacenaje, suscripción)", monto: redondea(otros) });
  }
  if (adsGenerales) gastos.push({ concepto: "Publicidad de Amazon no amarrada a modelo", monto: redondea(adsGenerales) });
  if (m.reservas) {
    avisos.push(
      `Amazon retuvo/soltó ${Math.abs(m.reservas).toLocaleString("es-MX", { style: "currency", currency: "MXN" })} en reservas durante el periodo: es dinero en tránsito, no gasto, y no se descuenta.`,
    );
  }

  // El neto por modelo: del SKU Economics (ventas − tarifas) si hay; si no,
  // el liquidado del modelo; si no, la venta del modelo por el ratio del canal.
  const ratio = m.periodo.importe > 0 ? neto / m.periodo.importe : 1;
  let costoProducto = 0;
  let unidadesConCosto = 0;
  const porModelo = m.porModelo
    .filter((f) => f.unidades > 0 || (f.netoReal ?? 0) !== 0 || (f.economia?.ventas ?? 0) > 0)
    .map((f) => {
      const cfg = config.get(f.modelo);
      const costo = cfg?.costo != null && f.unidades > 0 ? redondea(cfg.costo * f.unidades) : cfg?.costo != null ? 0 : null;
      if (costo != null) {
        costoProducto += costo;
        unidadesConCosto += f.unidades;
      }
      const netoModelo =
        fuente === "economia" && f.economia
          ? redondea(f.economia.neto + f.economia.publicidad)
          : fuente === "pagos" && f.netoReal != null
            ? f.netoReal
            : redondea(f.importe * ratio);
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
    neto,
    fuenteNeto:
      fuente === "economia"
        ? coberturaEconomia != null && coberturaEconomia < 0.98
          ? "SKU Economics parcial · fecha de venta"
          : "SKU Economics · fecha de venta"
        : fuente === "pagos"
          ? "Liquidaciones · fecha de depósito"
          : "Venta bruta sin descuentos",
    coberturaNeto:
      fuente === "economia"
        ? coberturaEconomia
        : fuente === "venta"
          ? 0
          : null,
    descuentos:
      fuente === "economia" && eco!.tarifas
        ? [{
            concepto:
              coberturaEconomia != null && coberturaEconomia < 0.98
                ? "Tarifas Amazon: comisión, FBA y otros (solo parte cubierta)"
                : "Tarifas Amazon: comisión, FBA y otros",
            monto: redondea(Math.abs(eco!.tarifas)),
          }]
        : [],
    devoluciones: 0,
    costoRecuperado: 0,
    costoProducto: redondea(costoProducto),
    unidadesConCosto,
    adsPorModelo: redondea(adsAmarrados),
    adsGenerales: redondea(adsGenerales),
    gastos,
    porModelo,
    avisos,
    exacto:
      fuente === "economia" &&
      coberturaEconomia != null &&
      coberturaEconomia >= 0.98 &&
      m.coberturaCosto >= 0.999 &&
      !(eco!.hasta && rango && eco!.hasta < rango.hasta),
  };
}
