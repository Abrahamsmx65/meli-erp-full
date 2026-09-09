/**
 * Lo que la cascada de dinero le pregunta a Mercado Libre y Mercado Pago.
 * Aquí vive el I/O; las reglas están en `pagos.ts` (puras y probadas).
 *
 *   - El pago REAL: `https://api.mercadopago.com/v1/payments/{id}` (el
 *     mismo token sirve). Si Mercado Pago no lo entrega por ese camino, se
 *     cae a `/collections/{id}` y se deja constancia de la fuente.
 *   - El envío del vendedor: `/shipments/{id}/costs` con `x-format-new`,
 *     `senders[].cost` sumado (ya con sus descuentos por reputación).
 *   - La tarifa de la categoría, para reconstruir la reventa:
 *     `/sites/MLM/listing_prices?price=&category_id=&listing_type_id=`,
 *     cacheada por corrida y por banda de precio ($149 / $299).
 */
import { MeliError, type MeliClient } from "./client";
import { bandaDeTarifa, type ContextoOrden, type RenglonParaCascada } from "./orden";
import { leerPagoMercadoPago, resumirPagosMeli, type PagoMercadoPago, type ResumenPagosMeli } from "./pagos";

export const URL_PAGOS_MP = "https://api.mercadopago.com/v1/payments";

const redondea = (x: number) => Math.round(x * 100) / 100;

/** El pago completo de Mercado Pago; la forma vieja solo como respaldo. */
export async function leerPagoReal(cliente: MeliClient, paymentId: number | string): Promise<PagoMercadoPago> {
  try {
    return leerPagoMercadoPago(await cliente.get<unknown>(`${URL_PAGOS_MP}/${paymentId}`), "v1/payments");
  } catch (err) {
    // Un 4xx del dominio de MP (sin permiso, no encontrado) no es motivo
    // para quedarse sin neto: la forma vieja sigue contestando, con menos
    // desglose. La fuente queda guardada para saber qué se leyó.
    if (err instanceof MeliError && err.status >= 400 && err.status < 500 && err.status !== 429) {
      return leerPagoMercadoPago(await cliente.get<unknown>(`/collections/${paymentId}`), "collections");
    }
    throw err;
  }
}

/**
 * Lo que el vendedor paga de envío según MELI (`senders[].cost`), o null si
 * no se pudo leer. Nunca truena: un envío sin costo leído se declara.
 */
export async function costoEnvioVendedor(cliente: MeliClient, shippingId: number | string): Promise<number | null> {
  try {
    const r = await cliente.get<{ senders?: { cost?: number | string }[] }>(
      `/shipments/${shippingId}/costs`,
      undefined,
      { headers: { "x-format-new": "true" }, reintentos: 1 },
    );
    if (!Array.isArray(r?.senders)) return null;
    let suma = 0;
    for (const s of r.senders) {
      const n = Number(s?.cost);
      if (Number.isFinite(n)) suma += n;
    }
    return redondea(suma);
  } catch {
    return null;
  }
}

export interface Tarifa {
  /** % de comisión sobre el precio público */
  porcentaje: number;
  /** cargo fijo por unidad (artículos baratos) */
  fijo: number;
}

/**
 * Tarifas de `/sites/{site}/listing_prices`, recordadas por corrida: la
 * tarifa cambia por categoría, tipo de publicación y banda de precio, y
 * una corrida de cientos de órdenes repite las mismas tres o cuatro.
 */
export class CacheTarifas {
  private readonly cache = new Map<string, Promise<Tarifa | null>>();

  constructor(
    private readonly cliente: MeliClient,
    private readonly site = "MLM",
  ) {}

  tarifa(precio: number, categoria: string | null | undefined, listing: string | null | undefined): Promise<Tarifa | null> {
    const tipo = listing || "gold_special";
    const clave = `${categoria ?? ""}|${tipo}|${bandaDeTarifa(precio)}`;
    let pendiente = this.cache.get(clave);
    if (!pendiente) {
      pendiente = this.consultar(precio, categoria, tipo);
      this.cache.set(clave, pendiente);
    }
    return pendiente;
  }

  private async consultar(precio: number, categoria: string | null | undefined, tipo: string): Promise<Tarifa | null> {
    try {
      const r = await this.cliente.get<unknown>(
        `/sites/${this.site}/listing_prices`,
        { price: redondea(precio), category_id: categoria ?? undefined, listing_type_id: tipo },
        { reintentos: 1 },
      );
      const lista = (Array.isArray(r) ? r : [r]) as Record<string, unknown>[];
      const t = lista.find((x) => x && x.listing_type_id === tipo) ?? lista[0];
      if (!t) return null;
      const det = (t.sale_fee_details ?? null) as Record<string, unknown> | null;
      const porcentaje = Number(det?.percentage_fee);
      const fijo = Number(det?.fixed_fee);
      if (Number.isFinite(porcentaje)) {
        return { porcentaje, fijo: Number.isFinite(fijo) ? fijo : 0 };
      }
      // Sin desglose: solo el monto de comisión para ese precio.
      const monto = Number(t.sale_fee_amount);
      if (Number.isFinite(monto) && precio > 0) return { porcentaje: (monto / precio) * 100, fijo: 0 };
      return null;
    } catch {
      return null;
    }
  }
}

/**
 * Le pone a cada renglón de una reventa la tarifa de su categoría. La
 * banda depende del precio público que aún no se conoce: se estima con
 * base ÷ 0.85, se consulta, se recalcula y se vuelve a consultar UNA vez
 * si cambió de banda.
 */
export async function tarifasParaReventa(
  tarifas: CacheTarifas,
  renglones: RenglonParaCascada[],
  envioVendedor: number,
): Promise<RenglonParaCascada[]> {
  const base = renglones.reduce((a, r) => a + r.importe, 0);
  const salida: RenglonParaCascada[] = [];
  for (const r of renglones) {
    if (r.unidades <= 0 || base <= 0) {
      salida.push({ ...r, tarifa: null });
      continue;
    }
    const unitBase = r.importe / r.unidades;
    const unitShip = (envioVendedor * (r.importe / base)) / r.unidades;
    const estimado = unitBase / 0.85;
    let tarifa = await tarifas.tarifa(estimado, r.categoria, r.listing);
    if (tarifa && tarifa.porcentaje < 100) {
      const publico = (unitBase + unitShip + tarifa.fijo) / (1 - tarifa.porcentaje / 100);
      if (bandaDeTarifa(publico) !== bandaDeTarifa(estimado)) {
        tarifa = await tarifas.tarifa(publico, r.categoria, r.listing);
      }
    }
    salida.push({ ...r, tarifa });
  }
  return salida;
}

export interface EntradaResumenOrden {
  pagos: PagoMercadoPago[];
  total: number;
  comisionOrden: number;
  netoControl?: number | null;
  reembolsoIncluidoNetoBase?: number | null;
  reembolsoBaseConfiable?: boolean | null;
  /** lo que la orden aporta; `envioVendedor` ya leído si se guardó antes */
  contexto: ContextoOrden;
  /** renglones con categoría y tipo de publicación, para la reventa */
  renglones: RenglonParaCascada[];
  tarifas: CacheTarifas;
}

/**
 * La cascada de UNA orden, preguntándole a MELI solo lo que haga falta:
 * el envío del vendedor cuando hay mezcla con el del comprador o cuando
 * es reventa (para reconstruirla), y las tarifas solo en reventa.
 */
export async function resumirOrdenConMeli(cliente: MeliClient, e: EntradaResumenOrden): Promise<ResumenPagosMeli> {
  const ctx: ContextoOrden = { ...e.contexto, renglones: e.renglones };
  const resumir = () =>
    resumirPagosMeli(e.pagos, e.total, e.comisionOrden, e.netoControl, e.reembolsoIncluidoNetoBase, e.reembolsoBaseConfiable, ctx);
  let r = resumir();

  const hayCargoEnvio = e.pagos.some((p) => p.cargos.envio > 0);
  const mezclaConComprador = (ctx.envioComprador ?? 0) > 0 && hayCargoEnvio;
  const necesitaCostos = ctx.envioVendedor == null && ctx.shippingId != null && (r.tipoVenta === "reventa" || mezclaConComprador);
  if (necesitaCostos) {
    ctx.envioVendedor = await costoEnvioVendedor(cliente, ctx.shippingId!);
    r = resumir();
  }
  if (r.tipoVenta === "reventa" && ctx.envioVendedor != null && e.renglones.length) {
    ctx.renglones = await tarifasParaReventa(e.tarifas, e.renglones, ctx.envioVendedor);
    r = resumir();
  }
  return r;
}

/** Los renglones guardados en `ordenes_neto.renglones`, listos para la cascada. */
export function renglonesParaCascada(renglones: unknown): RenglonParaCascada[] {
  if (!Array.isArray(renglones)) return [];
  return renglones
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      sku: typeof r.sku === "string" ? r.sku : undefined,
      unidades: Number(r.unidades) || 0,
      importe: Number(r.importe) || 0,
      categoria: typeof r.categoria === "string" ? r.categoria : null,
      listing: typeof r.listing === "string" ? r.listing : null,
    }));
}

/** El contexto de una orden ya guardada (sin volver a MELI). */
export function contextoGuardado(f: Record<string, unknown>, ahoraMs: number): ContextoOrden {
  const staticTags = Array.isArray(f.static_tags) ? (f.static_tags as string[]) : undefined;
  const fecha = typeof f.fecha === "string" ? Date.parse(`${f.fecha}T12:00:00.000-06:00`) : NaN;
  return {
    staticTags,
    todosSaleFeeNulos: false,
    edadHoras: Number.isFinite(fecha) ? Math.max(0, (ahoraMs - fecha) / 3_600_000) : Infinity,
    envioComprador: f.envio_comprador == null ? 0 : Number(f.envio_comprador) || 0,
    envioVendedor: f.envio_vendedor == null ? null : Number(f.envio_vendedor),
    pagado: f.pagado == null ? undefined : Number(f.pagado) || 0,
    packId: f.pack_id == null ? null : Number(f.pack_id),
    shippingId: f.shipping_id == null ? null : Number(f.shipping_id),
  };
}
