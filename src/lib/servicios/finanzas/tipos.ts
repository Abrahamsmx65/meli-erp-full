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
  /** Órdenes cuyo desglose salió del pago REAL de Mercado Pago (/v1/payments), no de la forma vieja. */
  conPagoReal: number;
  /** Órdenes con la comisión ya completa (las recientes se releen hasta que MP la publica). */
  completas: number;
}

/**
 * Las ventas en REVENTA (MELI compra y revende). MELI paga un precio ya neto
 * de comisión y envío; para compararlas con las directas se reconstruye el
 * precio público con la tarifa de la categoría (decisión del dueño) y la
 * venta bruta se infla con esa diferencia. El neto no cambia.
 */
export interface ReventaPeriodo {
  ordenes: number;
  /** Lo que MELI paga por ellas (centavos): el importe que el ERP registra. */
  importe: number;
  /** El precio público reconstruido (centavos); igual a `importe` en las que no se pudo reconstruir. */
  totalComprador: number;
  /** Cuántas se reconstruyeron. */
  reconstruidas: number;
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

/**
 * UNA orden con su cascada, para abrirla en Mercado Pago y cotejar al
 * centavo. Todo en CENTAVOS ENTEROS, como el resto del motor.
 */
export interface OrdenAuditada {
  orderId: string;
  fecha: string;
  tipoVenta: "directa" | "reventa" | null;
  /** lo que MELI dice que vale la orden */
  total: number;
  /** reventa: precio público reconstruido; null = sin reconstruir */
  totalComprador: number | null;
  comision: number;
  envio: number;
  isr: number;
  iva: number;
  /** retención que llegó sumada sin separar */
  retencionSinSeparar: number;
  otros: number;
  sinDesglosar: number;
  /** el depósito de hoy (neto_actual si hubo relectura) */
  neto: number;
  /** base − cargos según el desglose; null si no se pudo armar */
  netoCalculado: number | null;
  reembolsado: number;
  estado: string | null;
  estadoPago: string | null;
  /** "v1/payments" = pago real; "collections" = forma vieja; null = no leído */
  fuente: string | null;
  /** false = comisión aún incompleta (orden reciente) */
  completa: boolean | null;
  liberaEn: string | null;
}

/** La muestra de auditoría que viaja con el renglón masticado. */
export interface AuditoriaFinanzas {
  /** las 20 órdenes más grandes del rango */
  mayores: OrdenAuditada[];
  /** las 20 leídas más recientemente (para ver el trabajo de fondo avanzar) */
  recientes: OrdenAuditada[];
}

export interface FinanzasPeriodo {
  rango: { desde: string; hasta: string };
  totales: TotalesFinanzas;
  cascada: PasoCascada[];
  reventa: ReventaPeriodo;
  cobertura: CoberturaFinanzas;
  /** ausente solo en renglones guardados antes de la auditoría */
  auditoria?: AuditoriaFinanzas;
  /** Momento en que se masticó, para declarar la frescura en pantalla. */
  generadoEn: string;
}
