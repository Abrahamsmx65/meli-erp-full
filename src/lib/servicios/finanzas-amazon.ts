/**
 * El dinero REAL de Amazon en un periodo, desde los eventos de la Finances
 * API guardados por `amazon/finanzas-sync.ts` (tablas `amazon_finanzas_*`,
 * migración 0071). Por fecha de ASIENTO (cuando Amazon lo carga a la
 * liquidación), como el estado de cuenta.
 *
 * NADA SE ESTIMA: cada peso sale de un evento con nombre. Lo que falta se
 * declara en `cobertura` y `avisos`: una liquidación abierta (la quincena
 * en curso), una cerrada que aún no se termina de leer, o una cuya suma
 * no da el total de Amazon.
 *
 * Las sumas las hace Postgres (`amazon_finanzas_por_sku`,
 * `amazon_finanzas_otros`, `amazon_finanzas_cobertura`); aquí solo se
 * agrupa por modelo y se cruza con el costo.
 */
import { traerRpcTodo, type DB } from "../datos/repos";
import { modeloUnificado } from "./costos-unificados";
import type { ConfigProducto } from "./productos";

export interface CascadaAmazon {
  eventos: number;
  unidades: number;
  /** principal + impuesto cobrado + otros cargos al comprador: lo que pagó el cliente */
  bruto: number;
  principal: number;
  impuestoCobrado: number;
  otrosCargos: number;
  comision: number;
  fba: number;
  otrasTarifas: number;
  /** IVA/ISR que Amazon retiene (MarketplaceFacilitator…) */
  retenido: number;
  promociones: number;
  /** lo que queda al vendedor: bruto + cargos (que vienen negativos) */
  neto: number;
}

export interface ModeloFinanzasAmazon extends CascadaAmazon {
  modelo: string;
  categoria: string | null;
  /** reembolsos del modelo (negativo) */
  reembolsos: number;
  unidadesReembolsadas: number;
  /** costo × unidades vendidas; null sin costo capturado */
  costo: number | null;
  /** neto + reembolsos − costo; null sin costo */
  ganancia: number | null;
}

export interface OtroFinanzasAmazon {
  lista: string;
  eventos: number;
  monto: number;
  base: number | null;
  impuesto: number | null;
  sinClasificar: number;
}

export interface GrupoCobertura {
  grupoId: string;
  inicio: string | null;
  fin: string | null;
  estado: string | null;
  totalOriginal: number | null;
  sumaEventos: number | null;
  eventos: number;
  sinClasificar: number;
  completo: boolean;
  cuadra: boolean | null;
}

export interface FinanzasAmazon {
  rango: { desde: string; hasta: string };
  ventas: CascadaAmazon;
  reembolsos: CascadaAmazon;
  /** Product Ads cobrados en el periodo (negativo), con su IVA aparte */
  publicidad: { eventos: number; monto: number; base: number; impuesto: number };
  otros: OtroFinanzasAmazon[];
  otrosTotal: number;
  /** ventas.neto + reembolsos.neto: el dinero de los productos */
  netoProductos: number;
  /** netoProductos + publicidad + otros: lo que Amazon deposita del periodo */
  netoDepositado: number;
  porModelo: ModeloFinanzasAmazon[];
  costoProducto: number;
  unidadesConCosto: number;
  coberturaCosto: number;
  /** netoProductos − costo (donde hay costo) − publicidad − otros; null sin costos */
  ganancia: number | null;
  cobertura: {
    grupos: GrupoCobertura[];
    cerrados: number;
    abiertos: number;
    incompletos: number;
    descuadrados: number;
    /** todos los grupos que tocan el rango están cerrados, leídos y cuadran */
    completa: boolean;
    /** último asiento leído (fin del último grupo completo o leído_en del abierto) */
    hasta: string | null;
  };
  avisos: string[];
  /** cobertura completa y costo para todas las unidades */
  exacto: boolean;
  generadoEn: string;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const num = (x: unknown) => Number(x) || 0;

const LISTAS_VENTA = new Set(["ShipmentEventList", "ShipmentSettleEventList"]);
const LISTAS_REEMBOLSO = new Set(["RefundEventList", "GuaranteeClaimEventList", "ChargebackEventList"]);

export function cascadaVacia(): CascadaAmazon {
  return { eventos: 0, unidades: 0, bruto: 0, principal: 0, impuestoCobrado: 0, otrosCargos: 0, comision: 0, fba: 0, otrasTarifas: 0, retenido: 0, promociones: 0, neto: 0 };
}

interface FilaSku {
  seller_sku: string;
  lista: string;
  eventos: number;
  unidades: number;
  principal: number;
  impuesto_cobrado: number;
  otros_cargos: number;
  comision: number;
  fba: number;
  otras_tarifas: number;
  retenido: number;
  promociones: number;
  neto: number;
}

function sumar(c: CascadaAmazon, f: FilaSku): void {
  c.eventos += num(f.eventos);
  c.unidades += num(f.unidades);
  c.principal += num(f.principal);
  c.impuestoCobrado += num(f.impuesto_cobrado);
  c.otrosCargos += num(f.otros_cargos);
  c.comision += num(f.comision);
  c.fba += num(f.fba);
  c.otrasTarifas += num(f.otras_tarifas);
  c.retenido += num(f.retenido);
  c.promociones += num(f.promociones);
  c.neto += num(f.neto);
}

function redondear(c: CascadaAmazon): CascadaAmazon {
  c.bruto = r2(c.principal + c.impuestoCobrado + c.otrosCargos);
  for (const k of ["principal", "impuestoCobrado", "otrosCargos", "comision", "fba", "otrasTarifas", "retenido", "promociones", "neto"] as const) c[k] = r2(c[k]);
  return c;
}

/**
 * Arma el periodo desde las filas de los tres RPC (función pura, con
 * pruebas). `config` es el costo por modelo de Productos y costos.
 */
export function armarFinanzasAmazon(
  rango: { desde: string; hasta: string },
  filasSku: FilaSku[],
  filasOtros: { lista: string; eventos: number; monto: number | null; base: number | null; impuesto: number | null; sin_clasificar: number }[],
  filasGrupos: { grupo_id: string; inicio: string | null; fin: string | null; estado: string | null; total_original: number | null; suma_eventos: number | null; eventos: number; sin_clasificar: number; completo: boolean; cuadra: boolean | null }[],
  config: Map<string, ConfigProducto>,
  ahora = new Date(),
): FinanzasAmazon {
  const ventas = cascadaVacia();
  const reembolsos = cascadaVacia();
  const modelos = new Map<string, { venta: CascadaAmazon; reembolso: CascadaAmazon }>();

  for (const f of filasSku) {
    const esVenta = LISTAS_VENTA.has(f.lista);
    const esReembolso = LISTAS_REEMBOLSO.has(f.lista);
    if (!esVenta && !esReembolso) continue;
    sumar(esVenta ? ventas : reembolsos, f);
    const modelo = f.seller_sku ? modeloUnificado(f.seller_sku) || "(sin SKU)" : "(cargos de orden)";
    const m = modelos.get(modelo) ?? { venta: cascadaVacia(), reembolso: cascadaVacia() };
    sumar(esVenta ? m.venta : m.reembolso, f);
    modelos.set(modelo, m);
  }
  redondear(ventas);
  redondear(reembolsos);

  const publicidad = { eventos: 0, monto: 0, base: 0, impuesto: 0 };
  const otros: OtroFinanzasAmazon[] = [];
  let otrosTotal = 0;
  let sinClasificar = 0;
  for (const o of filasOtros) {
    if (o.lista === "ProductAdsPaymentEventList") {
      publicidad.eventos += num(o.eventos);
      publicidad.monto = r2(publicidad.monto + num(o.monto));
      publicidad.base = r2(publicidad.base + num(o.base));
      publicidad.impuesto = r2(publicidad.impuesto + num(o.impuesto));
      continue;
    }
    const fila = { lista: o.lista, eventos: num(o.eventos), monto: r2(num(o.monto)), base: o.base == null ? null : r2(num(o.base)), impuesto: o.impuesto == null ? null : r2(num(o.impuesto)), sinClasificar: num(o.sin_clasificar) };
    otros.push(fila);
    otrosTotal += fila.monto;
    sinClasificar += fila.sinClasificar;
  }
  otros.sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto));
  otrosTotal = r2(otrosTotal);

  let costoProducto = 0;
  let unidadesConCosto = 0;
  let unidadesVendidas = 0;
  const porModelo: ModeloFinanzasAmazon[] = [...modelos.entries()]
    .map(([modelo, m]) => {
      redondear(m.venta);
      redondear(m.reembolso);
      const cfg = config.get(modelo);
      unidadesVendidas += m.venta.unidades;
      const costo = cfg?.costo != null ? r2(cfg.costo * m.venta.unidades) : null;
      if (costo != null) {
        costoProducto += costo;
        unidadesConCosto += m.venta.unidades;
      }
      return {
        modelo,
        categoria: cfg?.categoria ?? null,
        ...m.venta,
        reembolsos: m.reembolso.neto,
        unidadesReembolsadas: m.reembolso.unidades,
        costo,
        ganancia: costo != null ? r2(m.venta.neto + m.reembolso.neto - costo) : null,
      };
    })
    .sort((a, b) => b.unidades - a.unidades);

  const grupos: GrupoCobertura[] = filasGrupos.map((g) => ({
    grupoId: g.grupo_id,
    inicio: g.inicio,
    fin: g.fin,
    estado: g.estado,
    totalOriginal: g.total_original == null ? null : num(g.total_original),
    sumaEventos: g.suma_eventos == null ? null : num(g.suma_eventos),
    eventos: num(g.eventos),
    sinClasificar: num(g.sin_clasificar),
    completo: Boolean(g.completo),
    cuadra: g.cuadra,
  }));
  const cerrados = grupos.filter((g) => g.estado === "Closed").length;
  const abiertos = grupos.filter((g) => g.estado !== "Closed").length;
  const incompletos = grupos.filter((g) => g.estado === "Closed" && !g.completo).length;
  const descuadrados = grupos.filter((g) => g.cuadra === false).length;
  const completa = grupos.length > 0 && abiertos === 0 && incompletos === 0 && descuadrados === 0;
  let hasta: string | null = null;
  for (const g of grupos) {
    const fin = g.estado === "Closed" && g.completo ? g.fin : null;
    if (fin && (!hasta || fin > hasta)) hasta = fin;
  }

  const avisos: string[] = [];
  if (!grupos.length) avisos.push("Amazon: todavía no hay liquidaciones leídas para este periodo (la ingesta de la Finances API corre cada 10 minutos).");
  if (abiertos) avisos.push("Amazon: la liquidación en curso aún no cierra; sus eventos entran conforme Amazon los asienta y el total puede crecer.");
  if (incompletos) avisos.push(`Amazon: ${incompletos} liquidación(es) cerrada(s) todavía a medio leer: faltan eventos del periodo.`);
  for (const g of grupos.filter((x) => x.cuadra === false)) {
    const dif = r2((g.totalOriginal ?? 0) - (g.sumaEventos ?? 0));
    const dia = (t: string | null) => (t ? t.slice(0, 10) : "hoy");
    avisos.push(
      `Amazon: la liquidación del ${dia(g.inicio)} al ${dia(g.fin)} descuadra por ${Math.abs(dif).toLocaleString("es-MX", { style: "currency", currency: "MXN" })}: Amazon depositó ${(g.totalOriginal ?? 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" })} y sus eventos suman ${(g.sumaEventos ?? 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" })}. Las cifras usan los eventos; solo esa diferencia queda sin clasificar.`,
    );
  }
  if (sinClasificar) avisos.push(`Amazon: ${sinClasificar} evento(s) de un tipo que el ERP no sabe leer; su monto no está en ninguna cifra.`);
  const coberturaCosto = unidadesVendidas > 0 ? unidadesConCosto / unidadesVendidas : 0;
  if (unidadesVendidas > 0 && coberturaCosto < 0.999) avisos.push(`Amazon: ${Math.round((1 - coberturaCosto) * 100)}% de las unidades vendidas son de modelos sin costo capturado; su ganancia no se calcula.`);

  const netoProductos = r2(ventas.neto + reembolsos.neto);
  const netoDepositado = r2(netoProductos + publicidad.monto + otrosTotal);
  const ganancia = unidadesConCosto > 0 ? r2(netoProductos - costoProducto + publicidad.monto + otrosTotal) : null;

  return {
    rango,
    ventas,
    reembolsos,
    publicidad,
    otros,
    otrosTotal,
    netoProductos,
    netoDepositado,
    porModelo,
    costoProducto: r2(costoProducto),
    unidadesConCosto,
    coberturaCosto,
    ganancia,
    cobertura: { grupos, cerrados, abiertos, incompletos, descuadrados, completa, hasta },
    avisos,
    exacto: completa && coberturaCosto >= 0.999 && sinClasificar === 0,
    generadoEn: ahora.toISOString(),
  };
}

/** Lee los tres RPC y arma el periodo. `null` si las tablas aún no existen. */
export async function leerFinanzasAmazon(
  db: DB,
  amazonAccountId: string,
  rango: { desde: string; hasta: string },
  config: Map<string, ConfigProducto>,
): Promise<FinanzasAmazon | null> {
  const params = { p_account: amazonAccountId, p_desde: rango.desde, p_hasta: rango.hasta };
  const ausente = (e: unknown) => e instanceof Error && /does not exist|42P01|42883|PGRST202|schema cache/i.test(e.message);
  try {
    const [sku, otros, grupos] = await Promise.all([
      traerRpcTodo<FilaSku>(db, "amazon_finanzas_por_sku", params),
      traerRpcTodo<any>(db, "amazon_finanzas_otros", params),
      traerRpcTodo<any>(db, "amazon_finanzas_cobertura", params),
    ]);
    for (const r of [sku, otros, grupos]) if (r.error) throw new Error(r.error);
    if (!sku.filas.length && !otros.filas.length && !grupos.filas.length) return null;
    return armarFinanzasAmazon(rango, sku.filas, otros.filas, grupos.filas, config);
  } catch (err) {
    if (ausente(err)) return null;
    throw err;
  }
}
