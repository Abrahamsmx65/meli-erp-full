/**
 * Los tipos del dinero, compartidos por TODAS las pantallas.
 *
 * Existe porque hasta ahora cada pantalla armaba su propia versión del neto:
 * /ventas lo estimaba como importe − comisión, /ventas/cortes lo sacaba del
 * RPC de órdenes y el Corte general lo rearmaba encima. Cuatro caminos para
 * el mismo peso, y por eso ninguna cifra cuadraba contra otra. De aquí en
 * adelante hay un solo camino y estos son sus tipos.
 */

/** Un renglón de la cascada: cuánto y de dónde salió. */
export interface PasoCascada {
  clave:
    | "bruto"
    | "comision"
    | "envio"
    | "retenciones"
    | "otros"
    | "sinIdentificar"
    | "neto";
  titulo: string;
  /** Centavos. Positivo entra, negativo sale. El neto es el resultado. */
  monto: number;
  nota: string;
  /** true = es un resultado (el neto), no un cargo más. */
  esResultado?: boolean;
}

/** Qué tan completo está el dato. Se declara SIEMPRE, nunca se disimula. */
export interface CoberturaFinanzas {
  ordenes: number;
  /** Órdenes cuyo pago ya se leyó con su desglose de cargos. */
  conCargos: number;
  /** Órdenes con el depósito real de Mercado Pago ya conocido. */
  conNeto: number;
  /** 0-1 */
  parteCargos: number;
  parteNeto: number;
}

/**
 * Las ventas en REVENTA (MELI compra y revende). Su importe ya viene neto de
 * comisión y envío, así que mezclarlas con las directas deforma el precio
 * promedio: se cuentan aparte.
 */
export interface ReventaPeriodo {
  ordenes: number;
  /** Lo que MELI paga por ellas (centavos): el importe que el ERP registra. */
  importe: number;
}

/**
 * Todo en CENTAVOS ENTEROS. El dinero no se suma en flotantes: repartir un
 * centavo entre tres en punto flotante da cero, y en un mes de 30 mil
 * órdenes esos residuos se vuelven pesos que nadie sabe de dónde salieron.
 * La pantalla divide entre 100 al pintar y nada más.
 */
export interface TotalesFinanzas {
  bruto: number;
  comision: number;
  envio: number;
  retenciones: number;
  otros: number;
  /**
   * Lo que no se pudo explicar: bruto − cargos conocidos − neto. Aquí caen
   * los cargos que Mercado Pago no desglosó Y las órdenes cuyo pago todavía
   * no se ha leído. Se declara, nunca se reparte.
   */
  sinIdentificar: number;
  neto: number;
}

export interface FinanzasPeriodo {
  rango: { desde: string; hasta: string };
  totales: TotalesFinanzas;
  cascada: PasoCascada[];
  reventa: ReventaPeriodo;
  cobertura: CoberturaFinanzas;
  /** Momento en que se masticó, para declarar la frescura en pantalla. */
  generadoEn: string;
}
