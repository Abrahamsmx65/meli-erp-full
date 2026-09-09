import type { EstadoResultados } from "./corte-meli";

/** Conceptos que explican el paso de la venta bruta al saldo actual de MP. */
export function puenteVentaANeto(e: EstadoResultados) {
  const tieneDesgloseNuevo =
    e.envio != null
    || e.isr != null
    || e.iva != null
    || e.otrosCargos != null
    || e.cargosSinDesglosar != null;
  return {
    ventaBruta: e.ventaBruta,
    comision: e.comision,
    envio: e.envio ?? 0,
    isr: e.isr ?? 0,
    iva: e.iva ?? 0,
    /** retención que Mercado Pago entregó sumada, sin separar ISR de IVA */
    retencionSinSeparar: e.retencionSinSeparar ?? 0,
    otros: (e.otrosCargos ?? 0)
      + (e.cargosSinDesglosar ?? 0)
      + (tieneDesgloseNuevo ? 0 : e.enviosYOtros ?? 0),
    ajusteLiquidacion: e.ajusteLiquidacion,
    devolucionesIncluidasEnNeto: e.devoluciones.incluidoEnNeto ?? 0,
    netoDepositado: e.netoDepositado,
  };
}