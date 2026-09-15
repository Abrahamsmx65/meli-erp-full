/**
 * El bloque de Amazon para el corte general, desde el monitor de Amazon:
 * neto liquidado del reporte de pagos (o el del SKU Economics si no hay
 * liquidaciones en el rango), costo por modelo, publicidad por modelo del
 * SKU Economics, y los cargos de cuenta (FBA, almacenaje, suscripción) como
 * gasto general de la plataforma.
 */
import type { BloqueCanal } from "./consolidado";
import type { MonitorAmazon } from "./amazon-monitor";
import type { FinanzasAmazon } from "./finanzas-amazon";
import type { ConfigProducto } from "./productos";

export function bloqueAmazon(m: MonitorAmazon, config: Map<string, ConfigProducto>, rango?: { desde: string; hasta: string }): BloqueCanal {
  // Con eventos de la Finances API en el rango, el bloque es EXACTO: cada
  // peso viene de un evento con nombre. Lo demás queda como respaldo para
  // los periodos anteriores a la ingesta.
  const bloque =
    m.real && (m.real.ventas.eventos > 0 || m.real.reembolsos.eventos > 0)
      ? bloqueAmazonReal(m.real, m, config)
      : bloqueAmazonAgregado(m, config, rango);
  // Una fuente de respaldo que no se pudo leer se DECLARA; antes su error
  // tumbaba el canal entero y Amazon desaparecía del corte general.
  if (m.avisosFuentes?.length) bloque.avisos = [...m.avisosFuentes, ...bloque.avisos];
  return bloque;
}

/**
 * El bloque desde el dinero real por fecha de asiento. Regla del dueño:
 * la publicidad se descuenta al modelo que la gastó (la atribución por SKU
 * es de Amazon, SKU Economics) y lo que la factura real de Product Ads
 * (con IVA) cobró de más entra como gasto general del canal; los demás
 * cargos (servicio, ajustes, retención del periodo…) también. Las
 * devoluciones NO recuperan costo: Amazon no dice si el par regresó
 * vendible (se declara).
 */
function bloqueAmazonReal(real: FinanzasAmazon, m: MonitorAmazon, config: Map<string, ConfigProducto>): BloqueCanal {
  // Nunca −0: un cero negado se vería como "-$0" en pantalla.
  const redondea = (x: number) => Math.round(x * 100) / 100 || 0;
  const avisos = [...real.avisos];

  const adsPorModelo = new Map<string, number>();
  let adsAmarrados = 0;
  for (const [modelo, gasto] of m.publicidadPorModelo) {
    const v = Math.abs(gasto);
    if (v > 0) {
      adsPorModelo.set(modelo, v);
      adsAmarrados += v;
    }
  }
  const adsReales = Math.abs(real.publicidad.monto);
  const adsGenerales = adsAmarrados > 0 ? Math.max(0, adsReales - adsAmarrados) : adsReales;
  if (adsAmarrados > adsReales + 0.005) {
    avisos.push(`Amazon: la publicidad atribuida por modelo (SKU Economics, por fecha de venta: ${redondea(adsAmarrados).toLocaleString("es-MX", { style: "currency", currency: "MXN" })}) pasa de lo facturado en el periodo (${redondea(adsReales).toLocaleString("es-MX", { style: "currency", currency: "MXN" })}, con IVA): Amazon aún no factura todo el gasto.`);
  }
  if (real.publicidad.impuesto) avisos.push(`Amazon: la publicidad del periodo incluye ${redondea(Math.abs(real.publicidad.impuesto)).toLocaleString("es-MX", { style: "currency", currency: "MXN" })} de IVA facturado por Amazon.`);

  const gastos: { concepto: string; monto: number }[] = [];
  for (const o of real.otros) {
    if (!o.monto) continue;
    gastos.push({ concepto: `Amazon · ${NOMBRE_LISTA[o.lista] ?? o.lista}`, monto: redondea(-o.monto) });
  }
  if (adsGenerales) gastos.push({ concepto: adsAmarrados > 0 ? "Publicidad de Amazon no amarrada a modelo (incluye IVA)" : "Publicidad de Amazon (factura real, con IVA)", monto: redondea(adsGenerales) });
  if (real.reembolsos.neto) avisos.push("Amazon: las devoluciones se restan completas; el costo de los pares devueltos NO se suma de vuelta porque Amazon no dice si regresaron vendibles.");

  const porModelo = real.porModelo
    .filter((f) => f.unidades > 0 || f.neto !== 0 || f.reembolsos !== 0)
    .map((f) => ({
      modelo: f.modelo,
      categoria: f.categoria ?? config.get(f.modelo)?.categoria ?? null,
      unidades: f.unidades,
      importe: f.bruto,
      comision: redondea(-f.comision),
      envio: redondea(-f.fba),
      isr: 0,
      iva: redondea(-f.retenido),
      otros: redondea(-(f.otrasTarifas + f.promociones)),
      neto: redondea(f.neto + f.reembolsos),
      costo: f.costo,
      ads: adsPorModelo.get(f.modelo) ?? 0,
    }));

  const v = real.ventas;
  const descuentos: { concepto: string; monto: number }[] = [];
  if (v.comision) descuentos.push({ concepto: "Comisión de Amazon (referral)", monto: redondea(-v.comision) });
  if (v.fba) descuentos.push({ concepto: "Tarifa de FBA", monto: redondea(-v.fba) });
  if (v.retenido) descuentos.push({ concepto: "IVA retenido por Amazon", monto: redondea(-v.retenido) });
  if (v.promociones) descuentos.push({ concepto: "Promociones absorbidas", monto: redondea(-v.promociones) });
  if (v.otrasTarifas) descuentos.push({ concepto: "Otras tarifas por renglón", monto: redondea(-v.otrasTarifas) });

  const cob = real.cobertura;
  return {
    canal: "amazon",
    unidades: v.unidades,
    ordenes: v.eventos,
    ventaBruta: v.bruto,
    neto: real.netoProductos,
    fuenteNeto: cob.completa ? "Finances API · fecha de asiento · liquidaciones cerradas y cuadradas" : "Finances API · fecha de asiento · liquidación en curso",
    coberturaNeto: cob.completa ? 1 : null,
    descuentos,
    desglosePlataforma: { comision: redondea(-v.comision), envio: redondea(-v.fba), isr: 0, iva: redondea(-v.retenido), otros: redondea(-(v.promociones + v.otrasTarifas)) },
    desgloseDisponible: true,
    devoluciones: redondea(-real.reembolsos.neto),
    devolucionesIncluidasEnNeto: redondea(-real.reembolsos.neto),
    costoRecuperado: 0,
    costoProducto: real.costoProducto,
    unidadesConCosto: real.unidadesConCosto,
    adsPorModelo: redondea(adsAmarrados),
    adsGenerales: redondea(adsGenerales),
    gastos,
    porModelo,
    avisos,
    exacto: real.exacto,
  };
}

const NOMBRE_LISTA: Record<string, string> = {
  ServiceFeeEventList: "cargos de servicio (almacenaje, suscripción…)",
  AdjustmentEventList: "ajustes de Amazon",
  TaxWithholdingEventList: "retención de impuestos del periodo",
  DebtRecoveryEventList: "recuperación de saldo",
  SAFETReimbursementEventList: "reembolsos SAFE-T",
  RemovalShipmentEventList: "retiros de inventario",
  RemovalShipmentAdjustmentEventList: "ajustes de retiros",
  FBALiquidationEventList: "liquidación de inventario",
  CouponPaymentEventList: "cupones",
  SellerDealPaymentEventList: "ofertas",
  ChargeRefundEventList: "reembolsos de cargos",
  RetrochargeEventList: "retrocargos",
  ImagingServicesFeeEventList: "servicios de imagen",
  TrialShipmentEventList: "envíos de prueba",
  NetworkComminglingTransactionEventList: "inventario mezclado",
  AffordabilityExpenseEventList: "meses sin intereses",
  AffordabilityExpenseReversalEventList: "reverso de meses sin intereses",
  AdhocDisbursementEventList: "desembolsos",
  ValueAddedServiceChargeEventList: "servicios de valor agregado",
  CapacityReservationBillingEventList: "reserva de capacidad",
};

function bloqueAmazonAgregado(m: MonitorAmazon, config: Map<string, ConfigProducto>, rango?: { desde: string; hasta: string }): BloqueCanal {
  const avisos: string[] = [];
  const hayPagos = m.netoReal != null;
  const eco = m.economia;
  const hayEconomia = eco != null && (eco.ventas > 0 || eco.unidades > 0);
  const coberturaEconomia = hayEconomia
    ? Math.min(eco!.cobertura.importe, eco!.cobertura.unidades, eco!.cobertura.dias)
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
    if (!eco!.cobertura.completa && eco!.hasta && rango && eco!.hasta < rango.hasta) {
      avisos.push(`La economía por producto de Amazon llega hasta el ${eco!.hasta}: los últimos días del periodo aún no están (Amazon tarda ~2 días en asentarlos).`);
    }
    if (!eco!.cobertura.completa) {
      avisos.push(
        `SKU Economics está parcial: cubre ${Math.round(eco!.cobertura.importe * 100)}% del importe, ${Math.round(eco!.cobertura.unidades * 100)}% de las unidades y ${eco!.cobertura.diasCubiertos} de ${eco!.cobertura.diasVenta} días con venta. El neto, la publicidad y la utilidad no deben compararse contra el total vendido.`,
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
        ? !eco!.cobertura.completa
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
              !eco!.cobertura.completa
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
      eco!.cobertura.completa &&
      m.coberturaCosto >= 0.999,
  };
}
