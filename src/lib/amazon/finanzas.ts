/**
 * Finances API de Amazon (SP-API `/finances/v0`): los eventos financieros
 * POR PEDIDO, tal como Amazon los asienta. Es la única fuente que trae, por
 * orden y por renglón, el precio, el impuesto, la comisión, la tarifa de
 * FBA, lo retenido y las promociones con su NOMBRE, y por eso es la base
 * para que el dinero de Amazon sea exacto en vez de un agregado.
 *
 * Aquí viven las llamadas y la clasificación pura de un evento. Nada de
 * esto escribe en la base.
 */
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
  OrderFeeList?: ComponenteAmazon[];
  ShipmentFeeList?: ComponenteAmazon[];
  ShipmentItemList?: RenglonEnvioAmazon[];
  ShipmentItemAdjustmentList?: RenglonEnvioAmazon[];
}

export interface EventosFinancierosAmazon {
  ShipmentEventList?: EventoEnvioAmazon[];
  RefundEventList?: EventoEnvioAmazon[];
  GuaranteeClaimEventList?: EventoEnvioAmazon[];
  ChargebackEventList?: EventoEnvioAmazon[];
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

/** Los eventos financieros de UN pedido (todas las páginas). */
export async function eventosDePedido(cliente: Cliente, amazonOrderId: string): Promise<EventosFinancierosAmazon | null> {
  const r = await cliente.llamar<{ payload?: { FinancialEvents?: EventosFinancierosAmazon; NextToken?: string } }>(
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

/** Una página de eventos por fecha de asiento (para sondear formas). */
export async function eventosDesde(cliente: Cliente, postedAfterIso: string, maximo = 20): Promise<EventosFinancierosAmazon | null> {
  const r = await cliente.llamar<{ payload?: { FinancialEvents?: EventosFinancierosAmazon; NextToken?: string } }>(
    "GET",
    "/finances/v0/financialEvents",
    "listFinancialEvents",
    { params: { PostedAfter: postedAfterIso, MaxResultsPerPage: maximo } },
  );
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
}

const monto = (m?: MontoAmazon): number => (typeof m?.CurrencyAmount === "number" ? m.CurrencyAmount : Number(m?.CurrencyAmount) || 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

function vacia(): CascadaPedidoAmazon {
  return { principal: 0, impuestoCobrado: 0, otrosCargos: 0, comision: 0, fba: 0, otrasTarifas: 0, retenido: 0, promociones: 0, neto: 0, unidades: 0, porNombre: {} };
}

function sumarNombre(c: CascadaPedidoAmazon, nombre: string, valor: number): void {
  c.porNombre[nombre] = r2((c.porNombre[nombre] ?? 0) + valor);
}

/** Clasifica un evento de envío o reembolso en la cascada (montos con el signo de Amazon). */
export function cascadaDeEvento(e: EventoEnvioAmazon): CascadaPedidoAmazon {
  const c = vacia();
  const cargos = (lista: ComponenteAmazon[] | undefined, origen: string) => {
    for (const x of lista ?? []) {
      const tipo = x.ChargeType ?? "Charge";
      const v = monto(x.ChargeAmount);
      sumarNombre(c, `${origen}:${tipo}`, v);
      if (tipo === "Principal") c.principal += v;
      else if (tipo === "Tax") c.impuestoCobrado += v;
      else c.otrosCargos += v;
      c.neto += v;
    }
  };
  const tarifas = (lista: ComponenteAmazon[] | undefined, origen: string) => {
    for (const x of lista ?? []) {
      const tipo = x.FeeType ?? "Fee";
      const v = monto(x.FeeAmount);
      sumarNombre(c, `${origen}:${tipo}`, v);
      if (/^Commission$|ReferralFee/i.test(tipo)) c.comision += v;
      else if (/^FBA/i.test(tipo)) c.fba += v;
      else c.otrasTarifas += v;
      c.neto += v;
    }
  };
  const retenidos = (lista: ComponenteAmazon[] | undefined) => {
    for (const x of lista ?? []) {
      for (const t of x.TaxesWithheld ?? []) {
        const v = monto(t.ChargeAmount);
        sumarNombre(c, `Retenido:${x.TaxCollectionModel ?? ""}:${t.ChargeType ?? ""}`, v);
        c.retenido += v;
        c.neto += v;
      }
    }
  };
  const promos = (lista: ComponenteAmazon[] | undefined, origen: string) => {
    for (const x of lista ?? []) {
      const v = monto(x.PromotionAmount);
      sumarNombre(c, `${origen}:${x.PromotionType ?? "Promotion"}`, v);
      c.promociones += v;
      c.neto += v;
    }
  };

  cargos(e.OrderChargeList, "Orden");
  tarifas(e.OrderFeeList, "Orden");
  tarifas(e.ShipmentFeeList, "Envío");
  for (const r of [...(e.ShipmentItemList ?? []), ...(e.ShipmentItemAdjustmentList ?? [])]) {
    c.unidades += r.QuantityShipped ?? 0;
    cargos(r.ItemChargeList, "Renglón");
    cargos(r.ItemChargeAdjustmentList, "Ajuste");
    tarifas(r.ItemFeeList, "Renglón");
    tarifas(r.ItemFeeAdjustmentList, "Ajuste");
    retenidos(r.ItemTaxWithheldList);
    promos(r.PromotionList, "Renglón");
    promos(r.PromotionAdjustmentList, "Ajuste");
  }
  for (const k of ["principal", "impuestoCobrado", "otrosCargos", "comision", "fba", "otrasTarifas", "retenido", "promociones", "neto"] as const) {
    c[k] = r2(c[k]);
  }
  return c;
}

/** La cascada de un pedido completo: envíos (venta) y reembolsos por separado. */
export function cascadaDePedido(ev: EventosFinancierosAmazon): { ventas: CascadaPedidoAmazon[]; reembolsos: CascadaPedidoAmazon[] } {
  return {
    ventas: (ev.ShipmentEventList ?? []).map(cascadaDeEvento),
    reembolsos: (ev.RefundEventList ?? []).map(cascadaDeEvento),
  };
}
