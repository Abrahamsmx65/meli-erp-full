/**
 * Lectura defensiva de un pago de Mercado Pago.
 *
 * `net_received_amount` sigue siendo la cifra de control. El desglose sirve
 * para explicar cómo se llegó a ella, nunca para volver a descontar cargos.
 */
export type TipoVentaMeli = "directa" | "reventa";

export interface CargosPagoMeli {
  comision: number;
  envio: number;
  isr: number;
  iva: number;
  otros: number;
}

export interface PagoMercadoPago {
  estado: string | null;
  neto: number | null;
  reembolsado: number;
  bruto: number | null;
  cargos: CargosPagoMeli;
  detalleCargos: Record<string, unknown>[];
}

export interface ResumenPagosMeli extends CargosPagoMeli {
  estadoPago: string | null;
  neto: number | null;
  reembolsado: number;
  /** reembolso que ya explicaba la diferencia contra el primer neto guardado */
  reembolsoIncluidoNetoBase: number;
  /** false cuando cargos desconocidos impiden probar cuánto del reembolso estaba en ese primer neto */
  reembolsoBaseConfiable: boolean;
  cargosSinDesglosar: number;
  tipoVenta: TipoVentaMeli;
  detalleCargos: Record<string, unknown>[];
}

/** Campos que deben guardarse juntos cada vez que una liquidación está completa. */
export function camposLiquidacionMeli(resumen: ResumenPagosMeli): Record<string, unknown> {
  return {
    estado_pago: resumen.estadoPago,
    reembolsado: resumen.reembolsado,
    reembolso_incluido_neto_base: resumen.reembolsoIncluidoNetoBase,
    reembolso_base_confiable: resumen.reembolsoBaseConfiable,
    comision_mp: resumen.comision,
    envio_mp: resumen.envio,
    isr_mp: resumen.isr,
    iva_mp: resumen.iva,
    otros_mp: resumen.otros,
    cargos_sin_desglosar: resumen.cargosSinDesglosar,
    detalle_cargos: resumen.detalleCargos,
    tipo_venta: resumen.tipoVenta,
  };
}

const redondea = (x: number): number => Math.round(x * 100) / 100;

const numero = (x: unknown): number | null => {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x))) return Number(x);
  return null;
};

/** Saldo que alimenta ventas: la corrección más reciente, o el original. */
export function netoVigente(netoOriginal: unknown, netoActual: unknown): number {
  return numero(netoActual) ?? numero(netoOriginal) ?? 0;
}

const objeto = (x: unknown): Record<string, unknown> | null =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;

const textoCargo = (x: Record<string, unknown>): string =>
  [
    x.type,
    x.name,
    x.detail,
    x.description,
    x.reason,
    x.concept,
    x.label,
    x.tax_type,
    x.tax_id,
  ]
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .toLowerCase();

const montoCargo = (x: Record<string, unknown>): number | null => {
  const amounts = objeto(x.amounts);
  const candidates = [
    x.amount,
    x.value,
    x.total,
    x.original_amount,
    amounts?.original,
    amounts?.total,
    amounts?.amount,
  ];
  for (const candidate of candidates) {
    const n = numero(candidate);
    if (n != null) return Math.abs(n);
  }
  return null;
};

function claseCargo(texto: string): keyof CargosPagoMeli {
  if (/(^|[\s_-])(isr|income[\s_-]*tax|impuesto[\s_-]*sobre[\s_-]*la[\s_-]*renta)($|[\s_-])/i.test(texto)) return "isr";
  if (/(^|[\s_-])(iva|vat|value[\s_-]*added)($|[\s_-])/i.test(texto)) return "iva";
  if (/(^|[\s_-])(shipping|shipment|env[ií]o|flete|full[\s_-]*shipping)($|[\s_-])/i.test(texto)) return "envio";
  if (/(^|[\s_-])(fee|commission|comisi[oó]n|mercadopago|marketplace|sale[\s_-]*fee)($|[\s_-])/i.test(texto)) return "comision";
  return "otros";
}

/**
 * Los campos son aliases del mismo bloque, pero una respuesta puede traer un
 * alias vacío o uno más rico que otro. La unión usa el máximo de ocurrencias
 * de cada cargo entre listas: conserva cargos únicos sin sumar dos veces una
 * representación repetida.
 */
function unirListasAlternativas(
  fuentes: Record<string, unknown>[],
  campos: string[],
): Record<string, unknown>[] {
  const resultado: Record<string, unknown>[] = [];
  const maximasOcurrencias = new Map<string, number>();
  for (const fuente of fuentes) {
    for (const campo of campos) {
      if (!Array.isArray(fuente[campo])) continue;
      const lista = (fuente[campo] as unknown[])
        .map(objeto)
        .filter((entry): entry is Record<string, unknown> => entry != null);
      const ocurrencias = new Map<string, number>();
      for (const entry of lista) {
        const texto = textoCargo(entry);
        const firma = `${claseCargo(texto)}|${montoCargo(entry) ?? "sin-monto"}`;
        const cantidad = (ocurrencias.get(firma) ?? 0) + 1;
        ocurrencias.set(firma, cantidad);
        if (cantidad > (maximasOcurrencias.get(firma) ?? 0)) resultado.push(entry);
      }
      for (const [firma, cantidad] of ocurrencias) {
        maximasOcurrencias.set(firma, Math.max(maximasOcurrencias.get(firma) ?? 0, cantidad));
      }
    }
  }
  return resultado;
}

function entradasDe(crudo: Record<string, unknown>): Record<string, unknown>[] {
  const transaction = objeto(crudo.transaction_details);
  const financial = objeto(crudo.financial_details);
  const fuentes = [crudo, transaction ?? {}, financial ?? {}];
  // Un impuesto puede aparecer tanto en charges_details como en tax_details;
  // todos los aliases se reconcilian juntos para no contarlo dos veces.
  return unirListasAlternativas(fuentes, [
    "fee_details",
    "charges_details",
    "charges",
    "tax_details",
    "taxes",
    "withholdings",
  ]);
}

function agregarPrimerEscalar(
  cargos: CargosPagoMeli,
  detalle: Record<string, unknown>[],
  fuentes: Record<string, unknown>[],
  campos: string[],
  clase: keyof CargosPagoMeli,
): void {
  for (const fuente of fuentes) {
    for (const campo of campos) {
      const monto = numero(fuente[campo]);
      if (monto == null || monto === 0) continue;
      cargos[clase] += Math.abs(monto);
      detalle.push({ fuente: campo, clase, monto: redondea(Math.abs(monto)) });
      return;
    }
  }
}

export function leerPagoMercadoPago(crudo: unknown): PagoMercadoPago {
  const envoltura = objeto(crudo) ?? {};
  const p = objeto(envoltura.collection) ?? envoltura;
  const transaction = objeto(p.transaction_details) ?? {};
  const cargos: CargosPagoMeli = { comision: 0, envio: 0, isr: 0, iva: 0, otros: 0 };
  const detalleCargos: Record<string, unknown>[] = [];

  for (const entry of entradasDe(p)) {
    const monto = montoCargo(entry);
    if (monto == null || monto === 0) continue;
    const texto = textoCargo(entry);
    const clase = claseCargo(texto);
    cargos[clase] += monto;
    detalleCargos.push({
      fuente: "detalle",
      clase,
      monto: redondea(monto),
      tipo: texto || null,
      crudo: entry,
    });
  }

  // Algunos formatos no traen arreglos, sino totales directos. Solo se leen
  // cuando esa clase no apareció ya detallada para no contarla dos veces.
  if (cargos.comision === 0) {
    agregarPrimerEscalar(cargos, detalleCargos, [p, transaction], ["marketplace_fee", "mercadopago_fee", "commission_amount", "fee_amount"], "comision");
  }
  if (cargos.envio === 0) {
    agregarPrimerEscalar(cargos, detalleCargos, [p, transaction], ["shipping_amount", "shipping_cost", "shipping_fee"], "envio");
  }
  if (cargos.isr === 0) {
    agregarPrimerEscalar(cargos, detalleCargos, [p, transaction], ["isr", "isr_amount", "income_tax_amount"], "isr");
  }
  if (cargos.iva === 0) {
    agregarPrimerEscalar(cargos, detalleCargos, [p, transaction], ["iva", "iva_amount", "vat_amount"], "iva");
  }

  const neto = numero(p.net_received_amount) ?? numero(transaction.net_received_amount);
  const reembolsado =
    numero(p.transaction_amount_refunded) ??
    numero(p.amount_refunded) ??
    numero(transaction.transaction_amount_refunded) ??
    0;
  const bruto =
    numero(p.transaction_amount) ??
    numero(transaction.transaction_amount) ??
    numero(transaction.total_paid_amount);
  const estado = typeof p.status === "string" ? p.status : null;
  for (const clase of Object.keys(cargos) as (keyof CargosPagoMeli)[]) cargos[clase] = redondea(cargos[clase]);

  return {
    estado,
    neto,
    reembolsado: redondea(Math.max(0, reembolsado)),
    bruto,
    cargos,
    detalleCargos,
  };
}

/** El estado del pago que manda cuando la orden tiene varios: el peor. */
export function peorEstadoPago(estados: (string | null)[]): string | null {
  const orden = ["charged_back", "refunded", "in_mediation", "cancelled", "rejected", "pending", "in_process", "approved"];
  let peor: string | null = null;
  let mejorRango = Infinity;
  for (const estado of estados) {
    if (!estado) continue;
    const posicion = orden.indexOf(estado);
    const rango = posicion === -1 ? orden.length : posicion;
    if (rango < mejorRango) {
      mejorRango = rango;
      peor = estado;
    }
  }
  return peor;
}

/**
 * Junta todos los pagos de una orden. La comisión del renglón de la orden es
 * el respaldo cuando MP no la desglosa. El residual queda visible como cargo
 * sin desglose; nunca modifica el neto.
 */
export function resumirPagosMeli(
  pagos: PagoMercadoPago[],
  totalOrden: number,
  comisionOrden = 0,
  netoControl?: number | null,
  reembolsoIncluidoNetoBase?: number | null,
  reembolsoBaseConfiable?: boolean | null,
): ResumenPagosMeli {
  const cobrados = pagos.filter((p) => p.estado !== "rejected" && p.estado !== "cancelled");
  const neto =
    cobrados.length > 0 && pagosCobrablesCompletos(pagos)
      ? redondea(cobrados.reduce((a, p) => a + (p.neto ?? 0), 0))
      : null;
  const netoParaCargos = netoControl != null ? redondea(netoControl) : neto;
  const suma = (clase: keyof CargosPagoMeli) => redondea(cobrados.reduce((a, p) => a + p.cargos[clase], 0));
  let comision = suma("comision");
  const envio = suma("envio");
  const isr = suma("isr");
  const iva = suma("iva");
  const otros = suma("otros");
  const tipoVenta: TipoVentaMeli =
    totalOrden > 0 &&
    netoParaCargos != null &&
    netoParaCargos >= totalOrden * 0.99 &&
    comision + envio + isr + iva + otros < 0.01
      ? "reventa"
      : "directa";
  if (tipoVenta === "directa" && comision <= 0 && comisionOrden > 0) comision = redondea(comisionOrden);
  const reembolsado = redondea(cobrados.reduce((a, p) => a + p.reembolsado, 0));
  const conocidos = comision + envio + isr + iva + otros;
  const diferenciaBase =
    netoParaCargos != null && totalOrden > 0 ? redondea(totalOrden - netoParaCargos - conocidos) : 0;
  const baseInferida = redondea(Math.min(reembolsado, Math.max(0, diferenciaBase)));
  // Sin un neto de control confirmado, ésta ES la primera liquidación. Cualquier
  // procedencia guardada en una fila heredada aún no leída no puede imponerse
  // sobre la evidencia de Mercado Pago que acaba de llegar.
  const hayNetoBaseConfirmado = netoControl != null;
  const base = redondea(Math.min(
    reembolsado,
    Math.max(
      0,
      hayNetoBaseConfirmado && reembolsoIncluidoNetoBase != null
        ? reembolsoIncluidoNetoBase
        : baseInferida,
    ),
  ));
  const baseConfiable =
    (hayNetoBaseConfirmado ? reembolsoBaseConfiable : null) ??
    (reembolsado === 0 || Math.abs(diferenciaBase) <= 0.01 || Math.abs(diferenciaBase - reembolsado) <= 0.01);
  // La parte del reembolso ya presente en el primer neto no es un cargo.
  const cargosSinDesglosar = redondea(diferenciaBase - base);

  return {
    estadoPago: peorEstadoPago((cobrados.length ? cobrados : pagos).map((p) => p.estado)),
    neto,
    reembolsado,
    reembolsoIncluidoNetoBase: base,
    reembolsoBaseConfiable: baseConfiable,
    comision,
    envio,
    isr,
    iva,
    otros,
    cargosSinDesglosar,
    tipoVenta,
    detalleCargos: pagos.flatMap((p, indice) =>
      p.detalleCargos.map((detalle) => ({ pago: indice, ...detalle })),
    ),
  };
}

/** Una respuesta HTTP exitosa no basta: todo pago cobrable debe traer saldo. */
export function pagosCobrablesCompletos(pagos: PagoMercadoPago[]): boolean {
  return pagos.every((p) => p.estado === "rejected" || p.estado === "cancelled" || p.neto != null);
}