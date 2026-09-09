/**
 * Finances API de Amazon (SP-API `/finances/v0`): los eventos financieros
 * tal como Amazon los asienta. Es la única fuente que trae, por pedido y
 * por renglón, el precio, el impuesto, la comisión, la tarifa de FBA, lo
 * retenido y las promociones con su NOMBRE, y por eso es la base para que
 * el dinero de Amazon sea exacto en vez de un agregado.
 *
 * La unidad de lectura es el GRUPO DE LIQUIDACIÓN (settlement): un grupo
 * cerrado ya no cambia y trae su total (`OriginalTotal`), que es el número
 * de control: la suma de todos sus eventos tiene que dar ese total. Si no
 * da, falta o sobra algo y se declara, no se estima.
 *
 * Aquí viven las llamadas y la clasificación pura de un evento. Nada de
 * esto escribe en la base.
 */
import { createHash } from "node:crypto";
import type { Cliente } from "./spapi";

export interface MontoAmazon {
  CurrencyCode?: string;
  CurrencyAmount?: number;
}

export interface ComponenteAmazon {
  ChargeType?: string;
  FeeType?: string;
  PromotionType?: string;
  PromotionId?: string;
  TaxCollectionModel?: string;
  TaxesWithheld?: { ChargeType?: string; ChargeAmount?: MontoAmazon }[];
  ChargeAmount?: MontoAmazon;
  FeeAmount?: MontoAmazon;
  PromotionAmount?: MontoAmazon;
}

export interface RenglonEnvioAmazon {
  SellerSKU?: string;
  OrderItemId?: string;
  OrderAdjustmentItemId?: string;
  QuantityShipped?: number;
  ItemChargeList?: ComponenteAmazon[];
  ItemChargeAdjustmentList?: ComponenteAmazon[];
  ItemFeeList?: ComponenteAmazon[];
  ItemFeeAdjustmentList?: ComponenteAmazon[];
  ItemTaxWithheldList?: ComponenteAmazon[];
  PromotionList?: ComponenteAmazon[];
  PromotionAdjustmentList?: ComponenteAmazon[];
}

export interface EventoEnvioAmazon {
  AmazonOrderId?: string;
  SellerOrderId?: string;
  MarketplaceName?: string;
  PostedDate?: string;
  OrderChargeList?: ComponenteAmazon[];
  OrderChargeAdjustmentList?: ComponenteAmazon[];
  OrderFeeList?: ComponenteAmazon[];
  OrderFeeAdjustmentList?: ComponenteAmazon[];
  ShipmentFeeList?: ComponenteAmazon[];
  ShipmentFeeAdjustmentList?: ComponenteAmazon[];
  ShipmentItemList?: RenglonEnvioAmazon[];
  ShipmentItemAdjustmentList?: RenglonEnvioAmazon[];
}

export interface EventosFinancierosAmazon {
  ShipmentEventList?: EventoEnvioAmazon[];
  RefundEventList?: EventoEnvioAmazon[];
  GuaranteeClaimEventList?: EventoEnvioAmazon[];
  ChargebackEventList?: EventoEnvioAmazon[];
  ShipmentSettleEventList?: EventoEnvioAmazon[];
  ServiceFeeEventList?: { AmazonOrderId?: string; FeeReason?: string; FeeList?: ComponenteAmazon[]; SellerSKU?: string }[];
  ProductAdsPaymentEventList?: { postedDate?: string; transactionType?: string; invoiceId?: string; baseValue?: MontoAmazon; taxValue?: MontoAmazon; transactionValue?: MontoAmazon }[];
  [otro: string]: unknown;
}

export interface GrupoFinancieroAmazon {
  FinancialEventGroupId?: string;
  ProcessingStatus?: string;
  FundTransferStatus?: string;
  OriginalTotal?: MontoAmazon;
  ConvertedTotal?: MontoAmazon;
  FundTransferDate?: string;
  TraceId?: string;
  AccountTail?: string;
  BeginningBalance?: MontoAmazon;
  FinancialEventGroupStart?: string;
  FinancialEventGroupEnd?: string;
}

type RespuestaEventos = { payload?: { FinancialEvents?: EventosFinancierosAmazon; NextToken?: string } };

/** Los eventos financieros de UN pedido (primera página; un pedido rara vez pasa de 100 eventos). */
export async function eventosDePedido(cliente: Cliente, amazonOrderId: string): Promise<EventosFinancierosAmazon | null> {
  const r = await cliente.llamar<RespuestaEventos>(
    "GET",
    `/finances/v0/orders/${encodeURIComponent(amazonOrderId)}/financialEvents`,
    "listFinancialEventsByOrderId",
    { params: { MaxResultsPerPage: 100 } },
  );
  return r?.payload?.FinancialEvents ?? null;
}

/** Los grupos de liquidación (settlements) creados desde `desde`. */
export async function gruposFinancieros(cliente: Cliente, desdeIso: string): Promise<GrupoFinancieroAmazon[]> {
  const grupos: GrupoFinancieroAmazon[] = [];
  let token: string | undefined;
  for (let pagina = 0; pagina < 10; pagina++) {
    const r = await cliente.llamar<{ payload?: { FinancialEventGroupList?: GrupoFinancieroAmazon[]; NextToken?: string } }>(
      "GET",
      "/finances/v0/financialEventGroups",
      "listFinancialEventGroups",
      { params: token ? { NextToken: token } : { FinancialEventGroupStartedAfter: desdeIso, MaxResultsPerPage: 100 } },
    );
    if (!r?.payload) break;
    grupos.push(...(r.payload.FinancialEventGroupList ?? []));
    token = r.payload.NextToken;
    if (!token) break;
  }
  return grupos;
}

/**
 * Una página de eventos de UN grupo de liquidación. `token` es el NextToken
 * de la página anterior; se devuelve el siguiente (o undefined al acabar).
 * `null` si el cliente ya no tiene plazo para llamar.
 */
export async function paginaDeEventosDeGrupo(
  cliente: Cliente,
  grupoId: string,
  token?: string | null,
): Promise<{ eventos: EventosFinancierosAmazon; siguiente?: string } | null> {
  const r = await cliente.llamar<RespuestaEventos>(
    "GET",
    `/finances/v0/financialEventGroups/${encodeURIComponent(grupoId)}/financialEvents`,
    "listFinancialEventsByGroupId",
    { params: token ? { NextToken: token } : { MaxResultsPerPage: 100 } },
  );
  if (!r) return null;
  return { eventos: r.payload?.FinancialEvents ?? {}, siguiente: r.payload?.NextToken || undefined };
}

/** Una página de eventos por fecha de asiento (para sondear formas). */
export async function eventosDesde(cliente: Cliente, postedAfterIso: string, maximo = 20): Promise<EventosFinancierosAmazon | null> {
  const r = await cliente.llamar<RespuestaEventos>("GET", "/finances/v0/financialEvents", "listFinancialEvents", {
    params: { PostedAfter: postedAfterIso, MaxResultsPerPage: maximo },
  });
  return r?.payload?.FinancialEvents ?? null;
}

// ---------------------------------------------------------------------------
// Clasificación pura
// ---------------------------------------------------------------------------

export interface CascadaPedidoAmazon {
  /** Principal: lo que pagó el comprador por los productos */
  principal: number;
  /** Tax: impuesto cobrado al comprador (IVA incluido en el precio de México) */
  impuestoCobrado: number;
  /** envío cobrado al comprador y otros cargos a favor */
  otrosCargos: number;
  /** Commission (referral fee) */
  comision: number;
  /** FBAPerUnitFulfillmentFee, FBAWeightBasedFee, FBAPerOrderFulfillmentFee… */
  fba: number;
  /** las demás tarifas por renglón (ShippingChargeback, GiftwrapChargeback, VariableClosingFee…) */
  otrasTarifas: number;
  /** ItemTaxWithheldList: lo que Amazon retiene de impuestos (MarketplaceFacilitator, retención ISR/IVA México) */
  retenido: number;
  /** promociones (descuentos que absorbe el vendedor) */
  promociones: number;
  /** Σ de todo: lo que Amazon deja al vendedor por este evento */
  neto: number;
  unidades: number;
  /** nombre → monto, para ver qué llegó con qué nombre */
  porNombre: Record<string, number>;
  /** la misma cascada por renglón (SKU), para repartir por modelo sin prorratear */
  renglones: RenglonCascadaAmazon[];
}

export interface RenglonCascadaAmazon {
  sku: string | null;
  unidades: number;
  principal: number;
  impuestoCobrado: number;
  otrosCargos: number;
  comision: number;
  fba: number;
  otrasTarifas: number;
  retenido: number;
  promociones: number;
  neto: number;
}

const monto = (m?: MontoAmazon): number => (typeof m?.CurrencyAmount === "number" ? m.CurrencyAmount : Number(m?.CurrencyAmount) || 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

const CAMPOS_CASCADA = ["principal", "impuestoCobrado", "otrosCargos", "comision", "fba", "otrasTarifas", "retenido", "promociones", "neto"] as const;

function vacia(): CascadaPedidoAmazon {
  return { principal: 0, impuestoCobrado: 0, otrosCargos: 0, comision: 0, fba: 0, otrasTarifas: 0, retenido: 0, promociones: 0, neto: 0, unidades: 0, porNombre: {}, renglones: [] };
}

function renglonVacio(sku: string | null): RenglonCascadaAmazon {
  return { sku, unidades: 0, principal: 0, impuestoCobrado: 0, otrosCargos: 0, comision: 0, fba: 0, otrasTarifas: 0, retenido: 0, promociones: 0, neto: 0 };
}

function sumarNombre(c: CascadaPedidoAmazon, nombre: string, valor: number): void {
  c.porNombre[nombre] = r2((c.porNombre[nombre] ?? 0) + valor);
}

/** Clasifica un evento de envío o reembolso en la cascada (montos con el signo de Amazon). */
export function cascadaDeEvento(e: EventoEnvioAmazon): CascadaPedidoAmazon {
  const c = vacia();
  // Los cargos a nivel de orden (sin renglón) se guardan en un renglón sin SKU.
  const nivelOrden = renglonVacio(null);

  const cargos = (r: RenglonCascadaAmazon, lista: ComponenteAmazon[] | undefined, origen: string) => {
    for (const x of lista ?? []) {
      const tipo = x.ChargeType ?? "Charge";
      const v = monto(x.ChargeAmount);
      sumarNombre(c, `${origen}:${tipo}`, v);
      if (tipo === "Principal") r.principal += v;
      else if (tipo === "Tax") r.impuestoCobrado += v;
      else r.otrosCargos += v;
      r.neto += v;
    }
  };
  const tarifas = (r: RenglonCascadaAmazon, lista: ComponenteAmazon[] | undefined, origen: string) => {
    for (const x of lista ?? []) {
      const tipo = x.FeeType ?? "Fee";
      const v = monto(x.FeeAmount);
      sumarNombre(c, `${origen}:${tipo}`, v);
      if (/^Commission$|ReferralFee/i.test(tipo)) r.comision += v;
      else if (/^FBA/i.test(tipo)) r.fba += v;
      else r.otrasTarifas += v;
      r.neto += v;
    }
  };
  const retenidos = (r: RenglonCascadaAmazon, lista: ComponenteAmazon[] | undefined) => {
    for (const x of lista ?? []) {
      for (const t of x.TaxesWithheld ?? []) {
        const v = monto(t.ChargeAmount);
        sumarNombre(c, `Retenido:${x.TaxCollectionModel ?? ""}:${t.ChargeType ?? ""}`, v);
        r.retenido += v;
        r.neto += v;
      }
    }
  };
  const promos = (r: RenglonCascadaAmazon, lista: ComponenteAmazon[] | undefined, origen: string) => {
    for (const x of lista ?? []) {
      const v = monto(x.PromotionAmount);
      sumarNombre(c, `${origen}:${x.PromotionType ?? "Promotion"}`, v);
      r.promociones += v;
      r.neto += v;
    }
  };

  cargos(nivelOrden, e.OrderChargeList, "Orden");
  cargos(nivelOrden, e.OrderChargeAdjustmentList, "Orden");
  tarifas(nivelOrden, e.OrderFeeList, "Orden");
  tarifas(nivelOrden, e.OrderFeeAdjustmentList, "Orden");
  tarifas(nivelOrden, e.ShipmentFeeList, "Envío");
  tarifas(nivelOrden, e.ShipmentFeeAdjustmentList, "Envío");

  for (const ri of [...(e.ShipmentItemList ?? []), ...(e.ShipmentItemAdjustmentList ?? [])]) {
    const r = renglonVacio(ri.SellerSKU?.trim() || null);
    r.unidades = ri.QuantityShipped ?? 0;
    cargos(r, ri.ItemChargeList, "Renglón");
    cargos(r, ri.ItemChargeAdjustmentList, "Ajuste");
    tarifas(r, ri.ItemFeeList, "Renglón");
    tarifas(r, ri.ItemFeeAdjustmentList, "Ajuste");
    retenidos(r, ri.ItemTaxWithheldList);
    promos(r, ri.PromotionList, "Renglón");
    promos(r, ri.PromotionAdjustmentList, "Ajuste");
    c.renglones.push(r);
  }
  if (nivelOrden.neto !== 0) c.renglones.push(nivelOrden);

  for (const r of c.renglones) {
    for (const k of CAMPOS_CASCADA) {
      r[k] = r2(r[k]);
      c[k] += r[k];
    }
    c.unidades += r.unidades;
  }
  for (const k of CAMPOS_CASCADA) c[k] = r2(c[k]);
  return c;
}

/** La cascada de un pedido completo: envíos (venta) y reembolsos por separado. */
export function cascadaDePedido(ev: EventosFinancierosAmazon): { ventas: CascadaPedidoAmazon[]; reembolsos: CascadaPedidoAmazon[] } {
  return {
    ventas: (ev.ShipmentEventList ?? []).map(cascadaDeEvento),
    reembolsos: (ev.RefundEventList ?? []).map(cascadaDeEvento),
  };
}

// ---------------------------------------------------------------------------
// Todas las listas de un grupo, aplanadas a eventos con monto
// ---------------------------------------------------------------------------

/** Las listas que tienen la forma de un envío (cargos, tarifas, retenidos por renglón). */
export const LISTAS_DE_PEDIDO = new Set(["ShipmentEventList", "RefundEventList", "GuaranteeClaimEventList", "ChargebackEventList", "ShipmentSettleEventList"]);

export interface EventoClasificadoAmazon {
  /** nombre de la lista de Amazon (ShipmentEventList, ProductAdsPaymentEventList…) */
  lista: string;
  /** huella del evento crudo: la llave de idempotencia */
  clave: string;
  amazonOrderId: string | null;
  postedEn: string | null;
  /** lo que este evento suma o resta al depósito; null si no se supo leer */
  monto: number | null;
  /** para cargos con IVA desglosado (publicidad): base e impuesto */
  base: number | null;
  impuesto: number | null;
  /** qué es (tipo de ajuste, razón del cargo, número de factura…) */
  descripcion: string | null;
  /** cascada por renglón cuando el evento tiene forma de envío */
  cascada: CascadaPedidoAmazon | null;
  /** false cuando la lista no se conoce y el monto se dejó en null */
  clasificado: boolean;
  crudo: unknown;
}

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x && typeof x === "object" ? (x as Obj) : {});
const mAmt = (x: unknown): number => monto(x as MontoAmazon | undefined);
const texto = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);
const sumaLista = (lista: unknown, campo: string): number => (Array.isArray(lista) ? lista.reduce<number>((s, x) => s + mAmt(obj(x)[campo]), 0) : 0);

/** Huella estable del JSON crudo (mismas llaves en el mismo orden → misma clave). */
export function claveDeEvento(lista: string, crudo: unknown): string {
  return createHash("sha256").update(lista).update("\n").update(JSON.stringify(crudo)).digest("hex").slice(0, 40);
}

/**
 * Monto, base e impuesto de un evento que NO tiene forma de envío. Cada
 * lista tiene su propio campo; las que no se conocen se dejan en null y
 * se marcan sin clasificar (el cuadre del grupo las delata).
 */
function montoDeOtro(lista: string, e: Obj): { monto: number | null; base: number | null; impuesto: number | null; descripcion: string | null; clasificado: boolean } {
  const ok = (monto: number, extra: Partial<{ base: number; impuesto: number; descripcion: string | null }> = {}) => ({
    monto: r2(monto),
    base: extra.base != null ? r2(extra.base) : null,
    impuesto: extra.impuesto != null ? r2(extra.impuesto) : null,
    descripcion: extra.descripcion ?? null,
    clasificado: true,
  });
  switch (lista) {
    case "ProductAdsPaymentEventList": {
      const base = mAmt(e.baseValue);
      const impuesto = mAmt(e.taxValue);
      const total = e.transactionValue != null ? mAmt(e.transactionValue) : base + impuesto;
      return ok(total, { base, impuesto, descripcion: [texto(e.transactionType), texto(e.invoiceId)].filter(Boolean).join(" ") || null });
    }
    case "ServiceFeeEventList":
      return ok(sumaLista(e.FeeList, "FeeAmount"), { descripcion: texto(e.FeeReason) ?? texto(e.FeeDescription) });
    case "AdjustmentEventList":
      return ok(mAmt(e.AdjustmentAmount), { descripcion: texto(e.AdjustmentType) });
    case "TaxWithholdingEventList":
      return ok(mAmt(e.WithheldAmount), { base: mAmt(e.BaseAmount), descripcion: texto(obj(e.TaxWithholdingPeriod).StartDate) ? "Retención del periodo" : null });
    case "DebtRecoveryEventList":
      return ok(mAmt(e.RecoveryAmount), { descripcion: texto(e.DebtRecoveryType) });
    case "SAFETReimbursementEventList":
      return ok(mAmt(e.ReimbursedAmount), { descripcion: texto(e.ReasonCode) ?? texto(e.SAFETClaimId) });
    case "TDSReimbursementEventList":
      return ok(mAmt(e.ReimbursedAmount), { descripcion: texto(e.TDSOrderId) });
    case "RetrochargeEventList":
      return ok(mAmt(e.BaseTax) + mAmt(e.ShippingTax) + sumaLista(obj(e.RetrochargeTaxWithheldList)[0] ? (obj(e.RetrochargeTaxWithheldList)[0] as Obj).TaxesWithheld : [], "ChargeAmount"), {
        descripcion: texto(e.RetrochargeEventType),
      });
    case "CouponPaymentEventList":
      return ok(mAmt(e.TotalAmount), { descripcion: texto(e.CouponId) });
    case "SellerDealPaymentEventList":
      return ok(mAmt(e.totalAmount), { base: mAmt(e.dealFeeAmount), impuesto: mAmt(e.taxAmount), descripcion: texto(e.dealDescription) ?? texto(e.dealFeeType) });
    case "RemovalShipmentEventList":
      return ok(sumaLista(e.RemovalShipmentItemList, "FeeAmount"), { descripcion: texto(e.TransactionType) });
    case "RemovalShipmentAdjustmentEventList":
      return ok(sumaLista(e.RemovalShipmentItemAdjustmentList, "FeeAmountAdjustment"), { descripcion: texto(e.TransactionType) });
    case "FBALiquidationEventList":
      return ok(mAmt(e.LiquidationProceedsAmount) + mAmt(e.LiquidationFeeAmount), { descripcion: texto(e.OriginalRemovalOrderId) });
    case "ImagingServicesFeeEventList":
    case "TrialShipmentEventList":
      return ok(sumaLista(e.FeeList, "FeeAmount"), { descripcion: texto(e.ASIN) ?? texto(e.SKU) });
    case "LoanServicingEventList":
      return ok(mAmt(e.LoanAmount), { descripcion: texto(e.SourceBusinessEventType) });
    case "SellerReviewEnrollmentPaymentEventList":
      return ok(mAmt(e.TotalAmount), { descripcion: texto(e.EnrollmentId) });
    case "AdhocDisbursementEventList":
    case "FailedAdhocDisbursementEventList":
    case "ValueAddedServiceChargeEventList":
    case "CapacityReservationBillingEventList":
      return ok(mAmt(e.TransactionAmount), { descripcion: texto(e.TransactionType) ?? texto(e.Description) });
    case "PerformanceBondRefundEventList":
      return ok(mAmt(e.Amount), { descripcion: texto(e.MarketplaceCountryCode) });
    case "ChargeRefundEventList":
      return ok(sumaLista(e.ChargeRefundTransactions, "ChargeAmount"), { descripcion: texto(e.ReasonCode) });
    case "AffordabilityExpenseEventList":
    case "AffordabilityExpenseReversalEventList":
      return ok(mAmt(e.TotalExpensesAmount), { base: mAmt(e.BaseExpense), impuesto: mAmt(e.TotalExpensesAmount) - mAmt(e.BaseExpense), descripcion: texto(e.TransactionType) });
    case "NetworkComminglingTransactionEventList":
      return ok(mAmt(e.TaxExclusiveAmount) + mAmt(e.TaxAmount), { base: mAmt(e.TaxExclusiveAmount), impuesto: mAmt(e.TaxAmount), descripcion: texto(e.TransactionType) });
    case "PayWithAmazonEventList":
      return ok(mAmt(obj(e.Charge).ChargeAmount) + sumaLista(e.FeeList, "FeeAmount"), { descripcion: texto(e.PaymentAmountType) });
    case "RentalTransactionEventList":
      return ok(sumaLista(e.RentalChargeList, "ChargeAmount") + sumaLista(e.RentalFeeList, "FeeAmount"), { descripcion: texto(e.RentalEventType) });
    default:
      return { monto: null, base: null, impuesto: null, descripcion: null, clasificado: false };
  }
}

/**
 * Aplana todas las listas de una página de eventos a eventos con monto.
 *
 * Dos eventos IDÉNTICOS en la misma página son dos cargos de verdad (Amazon
 * cobró dos veces la misma tarifa de transporte de −619.27 sin fecha ni
 * descripción, y el total del grupo los trae a los dos): el segundo lleva
 * la clave con `#2`, el tercero `#3`… Así no se colapsan y releer la misma
 * página da las mismas claves.
 */
export function clasificarEventos(ev: EventosFinancierosAmazon): EventoClasificadoAmazon[] {
  const salida: EventoClasificadoAmazon[] = [];
  const vistas = new Map<string, number>();
  const clave = (lista: string, crudo: unknown): string => {
    const base = claveDeEvento(lista, crudo);
    const n = (vistas.get(base) ?? 0) + 1;
    vistas.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  };
  for (const [lista, valor] of Object.entries(ev)) {
    if (!Array.isArray(valor) || !valor.length) continue;
    for (const crudo of valor) {
      const e = obj(crudo);
      const postedEn = texto(e.PostedDate) ?? texto(e.postedDate) ?? texto(e.TransactionPostedDate) ?? texto(e.transactionPostedDate);
      const amazonOrderId = texto(e.AmazonOrderId) ?? texto(e.amazonOrderId);
      if (LISTAS_DE_PEDIDO.has(lista)) {
        const cascada = cascadaDeEvento(crudo as EventoEnvioAmazon);
        salida.push({ lista, clave: clave(lista, crudo), amazonOrderId, postedEn, monto: cascada.neto, base: null, impuesto: null, descripcion: null, cascada, clasificado: true, crudo });
      } else {
        const m = montoDeOtro(lista, e);
        salida.push({ lista, clave: clave(lista, crudo), amazonOrderId, postedEn, ...m, cascada: null, crudo });
      }
    }
  }
  return salida;
}
