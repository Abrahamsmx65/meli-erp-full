/**
 * Lectura de un pago de Mercado Pago y cascada de dinero por orden.
 *
 * Reglas (verificadas contra el reporte oficial "Ventas MX" por el sistema
 * de referencia del dueño):
 *
 *   - El pago se lee de `https://api.mercadopago.com/v1/payments/{id}`; ahí
 *     viene `charges_details[]` con `name`, `type`, `amounts.original`,
 *     `amounts.refunded` y `accounts.from/to`. Solo cuenta lo que se le cobra
 *     al VENDEDOR (`accounts.from == "collector"`); lo que MELI le regala al
 *     comprador (`ml → payer`, cupones) se ignora.
 *       name "tax_withholding-iva" → IVA · "tax_withholding-isr" → ISR ·
 *       "meli_fee" → comisión · type "shipping" → envío · cualquier otro
 *       cargo al vendedor (financiamiento, cupón cofinanciado) → comisión.
 *   - Comisión = máx(cargos de comisión del pago, Σ sale_fee × cantidad de la
 *     orden): MP publica el `meli_fee` minutos después y a veces en partes;
 *     con menos de 24 h y cargos por debajo del sale_fee la orden NO queda
 *     completa y se vuelve a leer.
 *   - El cargo `shipping` del pago mezcla la parte del vendedor con la del
 *     comprador: manda `/shipments/{id}/costs` y, si no, cargo − envío del
 *     comprador.
 *   - Reventa ("A cargo de Mercado Libre"): `static_tags` trae "meli_resale"
 *     (respaldo pasadas 24 h: todos los sale_fee en null). El pago llega SIN
 *     cargos y el unit_price ya es un precio B2B. Decisión del dueño: se
 *     reconstruye el precio público con la tarifa de la categoría para que
 *     comisión y envío se CONTEMPLEN y la venta se compare con las normales.
 *
 * `net_received_amount` sigue siendo la cifra de control (es lo que Mercado
 * Pago deposita); el desglose la explica y `cargosSinDesglosar` declara lo
 * que no cierra. Nunca se vuelve a descontar un cargo ya dentro del neto.
 */
import { esReventaPorEtiqueta, HORAS_ASENTAMIENTO, type ContextoOrden, type RenglonParaCascada } from "./orden";

export type TipoVentaMeli = "directa" | "reventa";

/** De dónde salió la lectura del pago. */
export type FuentePago = "v1/payments" | "collections" | "orden";

export interface CargosPagoMeli {
  comision: number;
  envio: number;
  isr: number;
  iva: number;
  otros: number;
}

/** Lo que MELI devolvió al vendedor de cada cargo en un reembolso (amounts.refunded). */
export interface CargosReembolsados {
  comision: number;
  envio: number;
  retenciones: number;
}

export interface PagoMercadoPago {
  estado: string | null;
  neto: number | null;
  reembolsado: number;
  bruto: number | null;
  cargos: CargosPagoMeli;
  /** retención que vino SUMADA (taxes_amount) sin separar ISR de IVA; 0 cuando sí vino desglosada */
  retencionSinSeparar: number;
  cargosReembolsados: CargosReembolsados;
  /** money_release_date: cuándo Mercado Pago libera el dinero */
  liberaEn: string | null;
  fuente: FuentePago;
  detalleCargos: Record<string, unknown>[];
  /** el pago recortado a lo que se usa, para guardarlo y recalcular después */
  crudo: Record<string, unknown>;
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
  /** retención sumada sin separar (solo cuando el pago no la desglosa) */
  retencionSinSeparar: number;
  /** false = la comisión aún no está toda publicada (orden de menos de 24 h): se relee */
  cargosCompletos: boolean;
  liberaEn: string | null;
  fuente: FuentePago | "mixta";
  envioComprador: number;
  /** lo que el vendedor paga de envío según /shipments/{id}/costs; null = no se leyó */
  envioVendedor: number | null;
  /** base facturada: lo que pagó el comprador por los productos (sin su envío) */
  facturado: number | null;
  /** base − cargos, calculado desde el desglose (el "Recibirás" de MELI) */
  netoCalculado: number | null;
  /** reventa: precio público reconstruido de la orden; null = sin reconstruir */
  totalComprador: number | null;
  comisionReembolsada: number;
  envioReembolsado: number;
  retencionReembolsada: number;
  /** los pagos recortados, en el orden en que se leyeron */
  pagosCrudos: Record<string, unknown>[];
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
    retencion_mp: resumen.retencionSinSeparar,
    cargos_sin_desglosar: resumen.cargosSinDesglosar,
    detalle_cargos: resumen.detalleCargos,
    tipo_venta: resumen.tipoVenta,
    cargos_completos: resumen.cargosCompletos,
    cargos_fuente: resumen.fuente,
    libera_en: resumen.liberaEn,
    envio_comprador: resumen.envioComprador,
    envio_vendedor: resumen.envioVendedor,
    facturado: resumen.facturado,
    neto_calculado: resumen.netoCalculado,
    total_comprador: resumen.totalComprador,
    comision_reembolsada: resumen.comisionReembolsada,
    envio_reembolsado: resumen.envioReembolsado,
    retencion_reembolsada: resumen.retencionReembolsada,
    pago_crudo: resumen.pagosCrudos,
  };
}

/** A dos decimales; nunca −0 (una resta exacta no debe verse como negativa). */
const redondea = (x: number): number => {
  const r = Math.round(x * 100) / 100;
  return r === 0 ? 0 : r;
};

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
    amounts?.original,
    x.amount,
    x.value,
    x.total,
    x.original_amount,
    amounts?.total,
    amounts?.amount,
  ];
  for (const candidate of candidates) {
    const n = numero(candidate);
    if (n != null) return Math.abs(n);
  }
  return null;
};

/** Lo devuelto al vendedor de ese cargo en un reembolso (amounts.refunded). */
const montoReembolsadoDeCargo = (x: Record<string, unknown>): number => {
  const amounts = objeto(x.amounts);
  const n = numero(amounts?.refunded) ?? numero(x.refunded_amount) ?? numero(x.amount_refunded);
  return n == null ? 0 : Math.abs(n);
};

/** Quién paga el cargo: "collector" (el vendedor), "payer" (el comprador) o desconocido. */
function ladoDelCargo(x: Record<string, unknown>): string | null {
  const accounts = objeto(x.accounts);
  const from = accounts?.from;
  if (typeof from === "string" && from) return from.toLowerCase();
  if (typeof x.fee_payer === "string" && x.fee_payer) return x.fee_payer.toLowerCase();
  return null;
}

function claseCargo(texto: string): keyof CargosPagoMeli {
  if (/(^|[\s_-])(isr|income[\s_-]*tax|impuesto[\s_-]*sobre[\s_-]*la[\s_-]*renta)($|[\s_-])/i.test(texto)) return "isr";
  if (/(^|[\s_-])(iva|vat|value[\s_-]*added)($|[\s_-])/i.test(texto)) return "iva";
  if (/(^|[\s_-])(shipping|shipment|env[ií]o|flete|full[\s_-]*shipping)($|[\s_-])/i.test(texto)) return "envio";
  if (/(^|[\s_-])(fee|commission|comisi[oó]n|mercadopago|marketplace|sale[\s_-]*fee)($|[\s_-])/i.test(texto)) return "comision";
  return "otros";
}

/**
 * Clase de una entrada de cargos. `null` = no es un cargo al vendedor (lo
 * paga MELI o el comprador) y no cuenta. Primero los nombres exactos de
 * `charges_details`; luego el texto, para las formas viejas (`fee_details`).
 */
export function claseDeEntrada(x: Record<string, unknown>): keyof CargosPagoMeli | null {
  const lado = ladoDelCargo(x);
  if (lado && lado !== "collector") return null;
  const name = typeof x.name === "string" ? x.name.toLowerCase() : "";
  const type = typeof x.type === "string" ? x.type.toLowerCase() : "";
  if (name === "tax_withholding-iva") return "iva";
  if (name === "tax_withholding-isr") return "isr";
  if (name === "meli_fee") return "comision";
  if (type === "shipping") return "envio";
  const porTexto = claseCargo(textoCargo(x));
  if (porTexto !== "otros") return porTexto;
  // Cualquier otro cargo que sí se le cobra al vendedor (financiamiento,
  // cupón cofinanciado) va a comisión: así lo lista el reporte oficial.
  return lado === "collector" ? "comision" : "otros";
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
        const firma = `${claseDeEntrada(entry) ?? "ajeno"}|${montoCargo(entry) ?? "sin-monto"}`;
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
    "charges_details",
    "fee_details",
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

/**
 * El pago recortado a lo que se guarda: dinero, cargos, reembolsos y fechas.
 * Sin comprador, tarjeta ni metadatos (datos personales que no hacen falta
 * para recalcular y que no deben vivir en la base).
 */
export function recortarPago(p: Record<string, unknown>): Record<string, unknown> {
  const transaction = objeto(p.transaction_details) ?? {};
  const refunds = Array.isArray(p.refunds)
    ? (p.refunds as unknown[]).map(objeto).filter((r): r is Record<string, unknown> => r != null).map((r) => ({
        id: r.id ?? null,
        amount: r.amount ?? null,
        status: r.status ?? null,
        date_created: r.date_created ?? null,
      }))
    : [];
  return {
    id: p.id ?? null,
    status: p.status ?? null,
    status_detail: p.status_detail ?? null,
    order: p.order ?? null,
    date_created: p.date_created ?? null,
    date_approved: p.date_approved ?? null,
    money_release_date: p.money_release_date ?? null,
    payment_type_id: p.payment_type_id ?? null,
    payment_method_id: p.payment_method_id ?? null,
    transaction_amount: p.transaction_amount ?? null,
    transaction_amount_refunded: p.transaction_amount_refunded ?? null,
    shipping_amount: p.shipping_amount ?? null,
    taxes_amount: p.taxes_amount ?? null,
    net_received_amount: transaction.net_received_amount ?? p.net_received_amount ?? null,
    total_paid_amount: transaction.total_paid_amount ?? p.total_paid_amount ?? null,
    marketplace_fee: p.marketplace_fee ?? null,
    fee_details: p.fee_details ?? null,
    charges_details: p.charges_details ?? null,
    refunds,
  };
}

export function leerPagoMercadoPago(crudo: unknown, fuente: FuentePago = "collections"): PagoMercadoPago {
  const envoltura = objeto(crudo) ?? {};
  const p = objeto(envoltura.collection) ?? envoltura;
  const transaction = objeto(p.transaction_details) ?? {};
  const cargos: CargosPagoMeli = { comision: 0, envio: 0, isr: 0, iva: 0, otros: 0 };
  const cargosReembolsados: CargosReembolsados = { comision: 0, envio: 0, retenciones: 0 };
  const detalleCargos: Record<string, unknown>[] = [];

  for (const entry of entradasDe(p)) {
    const clase = claseDeEntrada(entry);
    if (clase == null) continue;
    const monto = montoCargo(entry);
    if (monto == null || monto === 0) continue;
    cargos[clase] += monto;
    const devuelto = montoReembolsadoDeCargo(entry);
    if (devuelto > 0) {
      if (clase === "comision" || clase === "otros") cargosReembolsados.comision += devuelto;
      else if (clase === "envio") cargosReembolsados.envio += devuelto;
      else cargosReembolsados.retenciones += devuelto;
    }
    detalleCargos.push({
      fuente: "detalle",
      clase,
      monto: redondea(monto),
      reembolsado: devuelto > 0 ? redondea(devuelto) : undefined,
      tipo: textoCargo(entry) || null,
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
  // La forma vieja trae las retenciones SUMADAS en taxes_amount, sin separar
  // ISR de IVA. Se guardan aparte, como retención, nunca como "otros".
  let retencionSinSeparar = 0;
  if (cargos.isr === 0 && cargos.iva === 0) {
    const taxes = numero(p.taxes_amount) ?? numero(transaction.taxes_amount);
    if (taxes != null && taxes !== 0) {
      retencionSinSeparar = redondea(Math.abs(taxes));
      detalleCargos.push({ fuente: "taxes_amount", clase: "retencion", monto: retencionSinSeparar });
    }
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
  for (const clase of Object.keys(cargosReembolsados) as (keyof CargosReembolsados)[]) {
    cargosReembolsados[clase] = redondea(cargosReembolsados[clase]);
  }

  return {
    estado,
    neto,
    reembolsado: redondea(Math.max(0, reembolsado)),
    bruto,
    cargos,
    retencionSinSeparar,
    cargosReembolsados,
    liberaEn: typeof p.money_release_date === "string" ? p.money_release_date : null,
    fuente,
    detalleCargos,
    crudo: recortarPago(p),
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

export interface ReventaReconstruida {
  comision: number;
  envio: number;
  /** base + envío + comisión: el precio público reconstruido */
  facturado: number;
}

/**
 * Reventa: MELI paga un precio B2B (comisión y envío ya dentro). Para
 * compararla con una venta normal se reconstruye el precio público por
 * renglón con la tarifa de su categoría:
 *
 *   unitPublic = (unitBase + unitShip + fijo) / (1 − pct/100)
 *   comisión   = Σ cantidad × (unitPublic − unitBase − unitShip)
 *   facturado  = base + envío + comisión   (absorbe el redondeo)
 *
 * donde unitShip es el envío real del shipment prorrateado por valor. Con
 * eso neto = facturado − comisión − envío = exactamente lo depositado.
 * Un renglón sin tarifa deja la orden sin reconstruir (null): no se estima.
 */
export function reconstruirReventa(
  renglones: RenglonParaCascada[],
  envioVendedor: number,
): ReventaReconstruida | null {
  const base = renglones.reduce((a, r) => a + r.importe, 0);
  if (!renglones.length || base <= 0) return null;
  let comision = 0;
  for (const r of renglones) {
    if (!r.tarifa || r.unidades <= 0) return null;
    const unitBase = r.importe / r.unidades;
    const unitShip = (envioVendedor * (r.importe / base)) / r.unidades;
    const pct = r.tarifa.porcentaje / 100;
    if (pct >= 1) return null;
    const unitPublic = (unitBase + unitShip + r.tarifa.fijo) / (1 - pct);
    comision += r.unidades * (unitPublic - unitBase - unitShip);
  }
  comision = redondea(comision);
  const envio = redondea(envioVendedor);
  return { comision, envio, facturado: redondea(base + envio + comision) };
}

/**
 * Junta todos los pagos de una orden con la cascada del PROMPT del dueño.
 * `contexto` es lo que la orden aporta (etiquetas, envío del comprador,
 * envío del vendedor, tarifas); sin él se conservan las reglas de respaldo
 * (comisión de la orden cuando MP no la desglosa, reventa por neto ≥ 99 %).
 * El residual queda visible como cargo sin desglose; nunca modifica el neto.
 */
export function resumirPagosMeli(
  pagos: PagoMercadoPago[],
  totalOrden: number,
  comisionOrden = 0,
  netoControl?: number | null,
  reembolsoIncluidoNetoBase?: number | null,
  reembolsoBaseConfiable?: boolean | null,
  contexto?: ContextoOrden,
): ResumenPagosMeli {
  const cobrados = pagos.filter((p) => p.estado !== "rejected" && p.estado !== "cancelled");
  const neto =
    cobrados.length > 0 && pagosCobrablesCompletos(pagos)
      ? redondea(cobrados.reduce((a, p) => a + (p.neto ?? 0), 0))
      : null;
  const netoParaCargos = netoControl != null ? redondea(netoControl) : neto;
  const suma = (clase: keyof CargosPagoMeli) => redondea(cobrados.reduce((a, p) => a + p.cargos[clase], 0));
  const comisionCargos = suma("comision");
  let comision = comisionCargos;
  let envio = suma("envio");
  const isr = suma("isr");
  const iva = suma("iva");
  const otros = suma("otros");
  const retencionSinSeparar = redondea(cobrados.reduce((a, p) => a + p.retencionSinSeparar, 0));
  const cargosReales = comisionCargos + envio + isr + iva + otros + retencionSinSeparar;
  const envioComprador = redondea(contexto?.envioComprador ?? 0);
  const envioVendedor = contexto?.envioVendedor ?? null;
  const edadHoras = contexto?.edadHoras ?? Infinity;

  // Reventa: por etiqueta cuando se leyó la orden; por respaldo (todos los
  // sale_fee en null, pasadas 24 h); y si no hay orden, por la forma del
  // depósito. GUARD: si el pago sí trae cargos, mandan los cargos.
  let tipoVenta: TipoVentaMeli;
  if (contexto?.staticTags != null) {
    const marcada =
      esReventaPorEtiqueta(contexto.staticTags) ||
      (contexto.todosSaleFeeNulos === true && edadHoras >= HORAS_ASENTAMIENTO);
    tipoVenta = marcada && cargosReales < 0.01 ? "reventa" : "directa";
  } else {
    tipoVenta =
      totalOrden > 0 &&
      netoParaCargos != null &&
      netoParaCargos >= totalOrden * 0.99 &&
      cargosReales < 0.01
        ? "reventa"
        : "directa";
  }

  let cargosCompletos = true;
  let totalComprador: number | null = null;
  if (tipoVenta === "directa") {
    // Comisión = máx(cargos del pago, Σ sale_fee × cantidad). Los cargos
    // pueden legítimamente exceder el sale_fee (cupón cofinanciado,
    // financiamiento), pero nunca quedar abajo: si quedan, MP aún no los
    // publicó todos (orden reciente) o los factura aparte (orden vieja).
    if (comisionOrden > 0 && comisionCargos < comisionOrden - 0.01) {
      comision = redondea(comisionOrden);
      if (edadHoras < HORAS_ASENTAMIENTO) cargosCompletos = false;
    }
    // El cargo de envío del pago mezcla la parte del vendedor con la del
    // comprador (que MELI compensa aparte): manda /shipments/{id}/costs.
    if (envioVendedor != null) envio = redondea(envioVendedor);
    else if (envioComprador > 0) envio = redondea(Math.max(0, envio - envioComprador));
  } else {
    // Reventa: el pago viene sin cargos. Comisión y envío se CONTEMPLAN
    // reconstruyendo el precio público (decisión del dueño); sin tarifa o
    // sin envío leído se dejan en cero y la orden queda sin reconstruir.
    const reconstruida =
      contexto?.renglones?.length && envioVendedor != null
        ? reconstruirReventa(contexto.renglones, envioVendedor)
        : null;
    if (reconstruida) {
      comision = reconstruida.comision;
      envio = reconstruida.envio;
      totalComprador = reconstruida.facturado;
    } else {
      comision = 0;
      envio = 0;
    }
  }

  const reembolsado = redondea(cobrados.reduce((a, p) => a + p.reembolsado, 0));
  const conocidos = redondea(comision + envio + isr + iva + otros + retencionSinSeparar);
  // Para la conciliación contra el neto de MP, la reventa reconstruida no
  // cuenta sus cargos contemplados: MP nunca los cobró.
  const conocidosEnDeposito = tipoVenta === "reventa" ? 0 : conocidos;
  const diferenciaBase =
    netoParaCargos != null && totalOrden > 0 ? redondea(totalOrden - netoParaCargos - conocidosEnDeposito) : 0;
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

  // Base facturada: lo que el comprador pagó por los productos (sin su envío).
  // paid_amount si vino; si no, los pagos cobrados; si no, el total.
  const brutoPagos = redondea(cobrados.reduce((a, p) => a + (p.bruto ?? 0), 0));
  const gross =
    contexto?.pagado != null && contexto.pagado > 0
      ? contexto.pagado
      : brutoPagos > 0
        ? brutoPagos
        : totalOrden > 0
          ? totalOrden
          : null;
  const facturado = gross == null ? null : redondea(gross - envioComprador);
  const netoCalculado =
    facturado == null ? null : redondea(facturado - (tipoVenta === "reventa" ? 0 : conocidos));

  const fuentes = new Set(pagos.map((p) => p.fuente));
  const fuente: ResumenPagosMeli["fuente"] =
    fuentes.size === 1 ? pagos[0]!.fuente : fuentes.size === 0 ? "collections" : "mixta";

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
    retencionSinSeparar,
    cargosCompletos,
    liberaEn: cobrados.reduce<string | null>((max, p) => (p.liberaEn && (!max || p.liberaEn > max) ? p.liberaEn : max), null),
    fuente,
    envioComprador,
    envioVendedor,
    facturado,
    netoCalculado,
    totalComprador,
    comisionReembolsada: redondea(cobrados.reduce((a, p) => a + p.cargosReembolsados.comision, 0)),
    envioReembolsado: redondea(cobrados.reduce((a, p) => a + p.cargosReembolsados.envio, 0)),
    retencionReembolsada: redondea(cobrados.reduce((a, p) => a + p.cargosReembolsados.retenciones, 0)),
    pagosCrudos: pagos.map((p) => p.crudo),
  };
}

/** Una respuesta HTTP exitosa no basta: todo pago cobrable debe traer saldo. */
export function pagosCobrablesCompletos(pagos: PagoMercadoPago[]): boolean {
  return pagos.every((p) => p.estado === "rejected" || p.estado === "cancelled" || p.neto != null);
}
