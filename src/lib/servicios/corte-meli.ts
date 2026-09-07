/**
 * Corte mensual de Mercado Libre: el estado de resultados del mes, exacto
 * al centavo con lo que Mercado Pago y MELI ya reportaron.
 *
 * La cuenta, de arriba hacia abajo:
 *
 *   Venta bruta            precio × pares de las órdenes pagadas del mes
 *   − Comisión de MELI     el sale_fee de cada orden
 *   − Envíos y otros       envío de Full, retenciones de ISR/IVA y demás
 *                          cargos: es la diferencia contra el depósito real
 *   = Neto depositado      net_received_amount de Mercado Pago, POR ORDEN
 *   − Devoluciones         lo que se le devolvió al comprador después
 *   − Costo de producto    costo capturado por modelo × pares vendidos
 *   = Utilidad bruta
 *   − Publicidad           Product Ads (API) + lo capturado a mano
 *   − Gastos de Full       almacenamiento y retiros facturados por MELI
 *                          + lo capturado a mano
 *   − Otros gastos         otros cargos de MELI + lo capturado a mano
 *   = Utilidad neta
 *
 * Las órdenes CANCELADAS no existen para el corte: ni venta ni neto. Las
 * DEVUELTAS sí vendieron y sí cobraron, y la devolución se resta aparte para
 * que se vea cuánto costó.
 *
 * Todo se suma en CENTAVOS enteros: sumar decimales de punto flotante
 * pierde centavos, y el corte tiene que cuadrar contra Mercado Pago.
 *
 * El neto sale de las ÓRDENES (ordenes_neto) y no de los renglones diarios,
 * que reparten el neto de cada orden entre sus SKUs y redondean: por SKU se
 * usan para el desglose por modelo, pero el total del mes se toma tal cual
 * lo depositó Mercado Pago. Un día cuyas órdenes aún no tienen neto real se
 * estima como importe − comisión y el corte lo declara.
 */
import { traerTodo, type Cuenta, type DB } from "../datos/repos";
import { cargosGuardados, progresoCargos, type CargoMeli, type ClaseCargo } from "./cargos-meli";
import { configPorProducto, type ConfigProducto } from "./productos";
import { cargarPublicidad } from "./publicidad";
import { fechaMx } from "./ventas-monitor";

export type CategoriaGasto = "full" | "publicidad" | "otro";

export interface GastoManual {
  id: number;
  fecha: string;
  concepto: string;
  categoria: CategoriaGasto;
  monto: number;
}

export interface OrdenDelCorte {
  orderId: number;
  fecha: string;
  total: number;
  neto: number;
  netoActual: number | null;
  reembolsado: number;
  estado: string | null;
  estadoPago: string | null;
  revisiones: number;
}

export interface VentaDelCorte {
  sku: string;
  fecha: string;
  unidades: number;
  ordenes?: number;
  importe?: number;
  comision?: number;
  neto?: number;
}

export interface RenglonModelo {
  modelo: string;
  categoria: string | null;
  unidades: number;
  importe: number;
  comision: number;
  neto: number;
  /** costo × unidades; null = modelo sin costo capturado */
  costo: number | null;
  publicidad: number;
  /** neto − costo − publicidad; null = sin costo */
  ganancia: number | null;
}

export interface RenglonCategoria {
  categoria: string;
  unidades: number;
  importe: number;
  neto: number;
  costo: number | null;
  publicidad: number;
  ganancia: number | null;
}

export interface RenglonDia {
  fecha: string;
  unidades: number;
  ordenes: number;
  importe: number;
  neto: number;
  /** true si el neto del día es el depósito real de todas sus órdenes */
  real: boolean;
}

export interface RenglonCargo {
  tipo: string;
  clase: ClaseCargo;
  monto: number;
  renglones: number;
}

export interface EstadoResultados {
  periodo: string;
  desde: string;
  hasta: string;
  dias: number;
  generadoEn: string;
  cuenta: string | null;

  unidades: number;
  ordenes: number;
  ventaBruta: number;
  comision: number;
  enviosYOtros: number;
  netoDepositado: number;
  /** parte del neto que es estimación (importe − comisión) por falta de depósito real */
  netoEstimado: number;
  /** fracción de la venta bruta cuyo neto es el depósito real (0-1) */
  coberturaNetoReal: number;

  cancelaciones: { ordenes: number; importe: number };
  devoluciones: { ordenes: number; monto: number };

  costoProducto: number;
  unidadesConCosto: number;
  coberturaCosto: number;
  utilidadBruta: number;

  publicidad: { ads: number; manual: number; total: number; sinAmarre: number; errorAds: string | null };
  full: { cargosMeli: number; manual: number; total: number };
  otros: { cargosMeli: number; manual: number; total: number };

  utilidadNeta: number;
  margenSobreVenta: number | null;
  margenSobreNeto: number | null;
  gananciaPorPar: number | null;

  gastosManuales: GastoManual[];
  cargosPorTipo: RenglonCargo[];
  cargosLeidos: boolean;
  porModelo: RenglonModelo[];
  porCategoria: RenglonCategoria[];
  porDia: RenglonDia[];

  revision: { ordenes: number; revisadas: number; pendientes: number; exacto: boolean };
  avisos: string[];
}

// ---------------------------------------------------------------------------
// Periodo
// ---------------------------------------------------------------------------

export function validarPeriodo(p?: string | null): string | null {
  return p && /^\d{4}-(0[1-9]|1[0-2])$/.test(p) ? p : null;
}

/** El mes en curso en hora de México. */
export function periodoActual(): string {
  return fechaMx(0).slice(0, 7);
}

/** Del primero al último día del mes, sin pasarse de hoy. */
export function rangoDelPeriodo(periodo: string, hoy = fechaMx(0)): { desde: string; hasta: string } {
  const [a, m] = periodo.split("-").map(Number);
  const desde = `${periodo}-01`;
  const ultimo = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  return { desde, hasta: ultimo > hoy ? hoy : ultimo };
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function nombreDelPeriodo(periodo: string): string {
  const [a, m] = periodo.split("-").map(Number);
  const mes = MESES[(m ?? 1) - 1] ?? periodo;
  return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} ${a}`;
}

export function periodoAnterior(periodo: string): string {
  const [a, m] = periodo.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

export function periodoSiguiente(periodo: string): string {
  const [a, m] = periodo.split("-").map(Number);
  const d = new Date(Date.UTC(a, m, 1));
  return d.toISOString().slice(0, 7);
}

// ---------------------------------------------------------------------------
// Motor puro
// ---------------------------------------------------------------------------

/** A centavos enteros. */
const c = (x: number | null | undefined): number => Math.round((Number(x) || 0) * 100);
/** De centavos a pesos con dos decimales exactos. */
const p = (centavos: number): number => Math.round(centavos) / 100;

export interface EntradaCorte {
  periodo: string;
  desde: string;
  hasta: string;
  cuenta?: string | null;
  generadoEn?: string;
  /** renglones de ventas_diarias, se filtran al rango aquí */
  ventas: VentaDelCorte[];
  /** órdenes de ordenes_neto del rango */
  ordenes: OrdenDelCorte[];
  /** sku → modelo (del catálogo); lo que falte se parte por guion */
  modeloDeSku: Map<string, string>;
  /** modelo → categoría y costo (productos_config) */
  config: Map<string, ConfigProducto>;
  /** modelo → gasto en Product Ads del periodo */
  adsPorModelo: Map<string, number>;
  adsSinAmarre: number;
  errorAds: string | null;
  gastos: GastoManual[];
  cargos: CargoMeli[];
  /** true si el API de facturación de MELI ya se leyó COMPLETO para el periodo */
  cargosLeidos: boolean;
  /** avance de la lectura de facturación, para el aviso: renglones leídos y declarados */
  cargosAvance?: { offset: number; total: number | null };
}

export function armarEstadoResultados(e: EntradaCorte): EstadoResultados {
  const avisos: string[] = [];
  const modeloDe = (sku: string): string => e.modeloDeSku.get(sku) ?? sku.split("-")[0] ?? sku;

  // --- Órdenes: el neto real, las cancelaciones y las devoluciones --------
  interface DiaOrdenes { neto: number; ordenes: number }
  const ordenesPorDia = new Map<string, DiaOrdenes>();
  let cancelOrdenes = 0;
  let cancelImporte = 0;
  let devOrdenes = 0;
  let devMonto = 0;
  let revisadas = 0;
  let pendientes = 0;
  for (const o of e.ordenes) {
    if (o.fecha < e.desde || o.fecha > e.hasta) continue;
    if ((o.revisiones ?? 0) >= 1) revisadas++;
    if ((o.revisiones ?? 0) < 2) pendientes++;
    if (o.estado === "cancelled") {
      cancelOrdenes++;
      cancelImporte += c(o.total);
      continue;
    }
    const netoOriginal = c(o.neto);
    const netoHoy = o.netoActual != null ? c(o.netoActual) : netoOriginal;
    // Si Mercado Pago ya bajó el neto por el reembolso, solo se resta lo
    // que falte: nunca la misma devolución dos veces.
    const yaDescontado = Math.max(0, netoOriginal - netoHoy);
    const devolucion = Math.max(0, c(o.reembolsado) - yaDescontado);
    const d = ordenesPorDia.get(o.fecha) ?? { neto: 0, ordenes: 0 };
    d.neto += netoHoy;
    d.ordenes += 1;
    ordenesPorDia.set(o.fecha, d);
    if (devolucion > 0 || o.estadoPago === "refunded" || o.estadoPago === "charged_back") {
      devOrdenes++;
      devMonto += devolucion;
    }
  }

  // --- Renglones diarios: bruto, comisión, unidades, y el desglose --------
  interface DiaFilas { unidades: number; ordenes: number; importe: number; comision: number; netoFilas: number; importeSinNeto: number; comisionSinNeto: number }
  const filasPorDia = new Map<string, DiaFilas>();
  interface AcumModelo { unidades: number; importe: number; comision: number; neto: number }
  const porModelo = new Map<string, AcumModelo>();

  for (const v of e.ventas) {
    if (v.fecha < e.desde || v.fecha > e.hasta) continue;
    const importe = c(v.importe);
    const comision = c(v.comision);
    const netoFila = v.neto != null && Number(v.neto) > 0 ? c(v.neto) : null;
    const d = filasPorDia.get(v.fecha) ?? { unidades: 0, ordenes: 0, importe: 0, comision: 0, netoFilas: 0, importeSinNeto: 0, comisionSinNeto: 0 };
    d.unidades += v.unidades ?? 0;
    d.ordenes += v.ordenes ?? 0;
    d.importe += importe;
    d.comision += comision;
    if (netoFila != null) d.netoFilas += netoFila;
    else if (importe > 0) {
      d.importeSinNeto += importe;
      d.comisionSinNeto += comision;
    }
    filasPorDia.set(v.fecha, d);

    const modelo = modeloDe(v.sku);
    const m = porModelo.get(modelo) ?? { unidades: 0, importe: 0, comision: 0, neto: 0 };
    m.unidades += v.unidades ?? 0;
    m.importe += importe;
    m.comision += comision;
    m.neto += netoFila ?? importe - comision;
    porModelo.set(modelo, m);
  }

  // --- Neto del mes, día por día ------------------------------------------
  let unidades = 0;
  let ordenes = 0;
  let ventaBruta = 0;
  let comision = 0;
  let netoDepositado = 0;
  let netoEstimado = 0;
  let importeConNetoReal = 0;
  const porDia: RenglonDia[] = [];
  const diasDescuadrados: string[] = [];
  const fechas = [...new Set([...filasPorDia.keys(), ...ordenesPorDia.keys()])].sort();
  for (const fecha of fechas) {
    const f = filasPorDia.get(fecha) ?? { unidades: 0, ordenes: 0, importe: 0, comision: 0, netoFilas: 0, importeSinNeto: 0, comisionSinNeto: 0 };
    const o = ordenesPorDia.get(fecha);
    unidades += f.unidades;
    ordenes += f.ordenes;
    ventaBruta += f.importe;
    comision += f.comision;

    const diaCompleto = f.importeSinNeto === 0 && f.netoFilas > 0;
    let netoDia: number;
    let real: boolean;
    if (diaCompleto && o) {
      // Las órdenes son la verdad; los renglones, su reparto redondeado.
      // Si no cuadran ni de cerca, algo está viejo y se avisa.
      const diferencia = Math.abs(o.neto - f.netoFilas);
      if (diferencia > Math.max(5_000, f.netoFilas * 0.02)) {
        diasDescuadrados.push(fecha);
        netoDia = f.netoFilas;
      } else {
        netoDia = o.neto;
      }
      real = true;
      importeConNetoReal += f.importe;
    } else {
      const estimado = f.importeSinNeto - f.comisionSinNeto;
      netoDia = f.netoFilas + estimado;
      netoEstimado += estimado;
      importeConNetoReal += f.importe - f.importeSinNeto;
      real = f.importeSinNeto === 0;
    }
    netoDepositado += netoDia;
    porDia.push({ fecha, unidades: f.unidades, ordenes: f.ordenes, importe: p(f.importe), neto: p(netoDia), real });
  }

  // --- Costo, publicidad y ganancia por modelo -----------------------------
  const filasModelo: RenglonModelo[] = [];
  let costoProducto = 0;
  let unidadesConCosto = 0;
  let adsAmarrados = 0;
  const modelosConAds = new Set<string>();
  for (const [modelo, m] of porModelo) {
    const cfg = e.config.get(modelo);
    const ads = c(e.adsPorModelo.get(modelo));
    modelosConAds.add(modelo);
    adsAmarrados += ads;
    let costo: number | null = null;
    if (cfg?.costo != null && m.unidades > 0) {
      costo = c(cfg.costo) * m.unidades;
      costoProducto += costo;
      unidadesConCosto += m.unidades;
    }
    filasModelo.push({
      modelo,
      categoria: cfg?.categoria ?? null,
      unidades: m.unidades,
      importe: p(m.importe),
      comision: p(m.comision),
      neto: p(m.neto),
      costo: costo == null ? null : p(costo),
      publicidad: p(ads),
      ganancia: costo == null ? null : p(m.neto - costo - ads),
    });
  }
  // Ads de modelos que no vendieron en el mes: gasto igual.
  for (const [modelo, gasto] of e.adsPorModelo) {
    if (modelosConAds.has(modelo)) continue;
    adsAmarrados += c(gasto);
    filasModelo.push({
      modelo,
      categoria: e.config.get(modelo)?.categoria ?? null,
      unidades: 0, importe: 0, comision: 0, neto: 0,
      costo: e.config.get(modelo)?.costo != null ? 0 : null,
      publicidad: p(c(gasto)),
      ganancia: e.config.get(modelo)?.costo != null ? p(-c(gasto)) : null,
    });
  }
  filasModelo.sort((a, b) => b.neto - a.neto || a.modelo.localeCompare(b.modelo, "es"));

  const cats = new Map<string, RenglonCategoria & { conCosto: boolean }>();
  for (const f of filasModelo) {
    const nombre = f.categoria ?? "Sin categoría";
    const k = cats.get(nombre) ?? { categoria: nombre, unidades: 0, importe: 0, neto: 0, costo: 0, publicidad: 0, ganancia: 0, conCosto: false };
    k.unidades += f.unidades;
    k.importe = p(c(k.importe) + c(f.importe));
    k.neto = p(c(k.neto) + c(f.neto));
    k.publicidad = p(c(k.publicidad) + c(f.publicidad));
    if (f.costo != null) {
      k.costo = p(c(k.costo) + c(f.costo));
      k.ganancia = p(c(k.ganancia) + c(f.ganancia));
      k.conCosto = true;
    }
    cats.set(nombre, k);
  }
  const porCategoria: RenglonCategoria[] = [...cats.values()]
    .map(({ conCosto, ...k }) => ({ ...k, costo: conCosto ? k.costo : null, ganancia: conCosto ? k.ganancia : null }))
    .sort((a, b) => b.neto - a.neto);

  // --- Gastos: publicidad, Full y otros ------------------------------------
  const sumaGastos = (cat: CategoriaGasto) =>
    e.gastos.filter((g) => g.categoria === cat && g.fecha >= e.desde && g.fecha <= e.hasta).reduce((a, g) => a + c(g.monto), 0);
  const sumaCargos = (clase: ClaseCargo) => e.cargos.filter((x) => x.clase === clase).reduce((a, x) => a + c(x.monto), 0);

  const adsSinAmarre = c(e.adsSinAmarre);
  const publicidad = {
    ads: adsAmarrados + adsSinAmarre,
    manual: sumaGastos("publicidad"),
    sinAmarre: adsSinAmarre,
  };
  const full = { cargosMeli: sumaCargos("full"), manual: sumaGastos("full") };
  const otros = { cargosMeli: sumaCargos("otro"), manual: sumaGastos("otro") };

  const cargosTipo = new Map<string, RenglonCargo>();
  for (const x of e.cargos) {
    const tipo = x.tipo ?? x.descripcion ?? "Sin tipo";
    const k = cargosTipo.get(tipo) ?? { tipo, clase: x.clase, monto: 0, renglones: 0 };
    k.monto = p(c(k.monto) + c(x.monto));
    k.renglones += 1;
    cargosTipo.set(tipo, k);
  }

  // --- La cuenta -----------------------------------------------------------
  const enviosYOtros = ventaBruta - comision - netoDepositado;
  const utilidadBruta = netoDepositado - devMonto - costoProducto;
  const publicidadTotal = publicidad.ads + publicidad.manual;
  const fullTotal = full.cargosMeli + full.manual;
  const otrosTotal = otros.cargosMeli + otros.manual;
  const utilidadNeta = utilidadBruta - publicidadTotal - fullTotal - otrosTotal;

  // --- Avisos: qué le falta al corte para ser exacto -----------------------
  const coberturaCosto = unidades > 0 ? unidadesConCosto / unidades : 0;
  const coberturaNetoReal = ventaBruta > 0 ? importeConNetoReal / ventaBruta : 0;
  if (unidades > 0 && coberturaCosto < 0.999) {
    avisos.push(
      `${(unidades - unidadesConCosto).toLocaleString("es-MX")} de ${unidades.toLocaleString("es-MX")} pares vendidos son de modelos sin costo capturado: su costo NO está descontado. Captúralo en Productos y costos.`,
    );
  }
  if (ventaBruta > 0 && coberturaNetoReal < 0.999) {
    avisos.push(
      `El ${Math.round((1 - coberturaNetoReal) * 100)}% de la venta todavía no tiene el depósito real de Mercado Pago: su neto está estimado como importe − comisión. El latido lo completa solo.`,
    );
  }
  if (diasDescuadrados.length) {
    avisos.push(
      `${diasDescuadrados.length} día(s) donde las órdenes y los renglones de venta no cuadran (${diasDescuadrados.slice(0, 5).join(", ")}): se usó el reparto por SKU. Vuelve a sincronizar esos días.`,
    );
  }
  if (pendientes > 0) {
    avisos.push(
      `${pendientes.toLocaleString("es-MX")} órdenes del mes aún no tienen sus dos revisiones de devolución/cancelación (a los 10 y 40 días). Hacer el corte las revisa todas.`,
    );
  }
  if (e.errorAds) avisos.push(`Publicidad: ${e.errorAds} Solo cuenta lo capturado a mano.`);
  if (!e.cargosLeidos) {
    const av = e.cargosAvance;
    avisos.push(
      av && av.offset > 0
        ? `La facturación de MELI va a medias: ${av.offset.toLocaleString("es-MX")}${av.total != null ? ` de ${av.total.toLocaleString("es-MX")}` : ""} renglones leídos (MELI da 5 llamadas por minuto; el latido la sigue solo). Los gastos de Full pueden estar incompletos.`
        : "No se han leído los cargos facturados por MELI del periodo (almacenamiento de Full, etc.): los gastos de Full solo incluyen lo capturado a mano.",
    );
  }
  if (devOrdenes > 0) {
    avisos.push(
      "Los pares devueltos siguen contando su costo de producto: si volvieron al stock en buen estado, la ganancia real es mayor por ese costo.",
    );
  }
  if (enviosYOtros > 0) {
    avisos.push(
      "«Envíos y otros» incluye el envío de Full y las retenciones de ISR e IVA que MELI entera al SAT: las retenciones son impuesto adelantado, no gasto perdido, y se acreditan en la declaración.",
    );
  }

  const exacto =
    pendientes === 0 && coberturaNetoReal >= 0.999 && coberturaCosto >= 0.999 && !e.errorAds && e.cargosLeidos && diasDescuadrados.length === 0;

  const dias = Math.max(1, Math.round((Date.parse(e.hasta) - Date.parse(e.desde)) / 86_400_000) + 1);
  return {
    periodo: e.periodo,
    desde: e.desde,
    hasta: e.hasta,
    dias,
    generadoEn: e.generadoEn ?? new Date().toISOString(),
    cuenta: e.cuenta ?? null,
    unidades,
    ordenes,
    ventaBruta: p(ventaBruta),
    comision: p(comision),
    enviosYOtros: p(enviosYOtros),
    netoDepositado: p(netoDepositado),
    netoEstimado: p(netoEstimado),
    coberturaNetoReal,
    cancelaciones: { ordenes: cancelOrdenes, importe: p(cancelImporte) },
    devoluciones: { ordenes: devOrdenes, monto: p(devMonto) },
    costoProducto: p(costoProducto),
    unidadesConCosto,
    coberturaCosto,
    utilidadBruta: p(utilidadBruta),
    publicidad: {
      ads: p(publicidad.ads),
      manual: p(publicidad.manual),
      total: p(publicidadTotal),
      sinAmarre: p(publicidad.sinAmarre),
      errorAds: e.errorAds,
    },
    full: { cargosMeli: p(full.cargosMeli), manual: p(full.manual), total: p(fullTotal) },
    otros: { cargosMeli: p(otros.cargosMeli), manual: p(otros.manual), total: p(otrosTotal) },
    utilidadNeta: p(utilidadNeta),
    margenSobreVenta: ventaBruta > 0 ? utilidadNeta / ventaBruta : null,
    margenSobreNeto: netoDepositado > 0 ? utilidadNeta / netoDepositado : null,
    gananciaPorPar: unidades > 0 ? p(utilidadNeta / unidades) : null,
    gastosManuales: e.gastos.filter((g) => g.fecha >= e.desde && g.fecha <= e.hasta),
    cargosPorTipo: [...cargosTipo.values()].sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto)),
    cargosLeidos: e.cargosLeidos,
    porModelo: filasModelo,
    porCategoria,
    porDia,
    revision: { ordenes: e.ordenes.filter((o) => o.fecha >= e.desde && o.fecha <= e.hasta).length, revisadas, pendientes, exacto },
    avisos,
  };
}

// ---------------------------------------------------------------------------
// Carga desde la base
// ---------------------------------------------------------------------------

async function leerVentas(db: DB, accountId: string, desde: string, hasta: string): Promise<VentaDelCorte[]> {
  const filtro = (q: any) => q.eq("account_id", accountId).gte("fecha", desde).lte("fecha", hasta);
  try {
    return await traerTodo<VentaDelCorte>(db, "ventas_diarias", "sku, fecha, unidades, ordenes, importe, comision, neto", filtro);
  } catch {
    return traerTodo<VentaDelCorte>(db, "ventas_diarias", "sku, fecha, unidades, ordenes, importe, comision", filtro);
  }
}

export async function gastosDelRango(db: DB, accountId: string, desde: string, hasta: string): Promise<GastoManual[]> {
  const filas = await traerTodo<any>(db, "gastos_meli", "id, fecha, concepto, categoria, monto", (q) =>
    q.eq("account_id", accountId).gte("fecha", desde).lte("fecha", hasta),
  ).catch(() => [] as any[]);
  return filas
    .map((g) => ({
      id: Number(g.id),
      fecha: g.fecha,
      concepto: g.concepto,
      categoria: (["full", "publicidad", "otro"].includes(g.categoria) ? g.categoria : "otro") as CategoriaGasto,
      monto: Number(g.monto) || 0,
    }))
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id));
}

export async function ordenesDelRango(db: DB, accountId: string, desde: string, hasta: string): Promise<OrdenDelCorte[]> {
  const filas = await traerTodo<any>(
    db,
    "ordenes_neto",
    "order_id, fecha, total, neto, neto_actual, reembolsado, estado, estado_pago, revisiones",
    (q) => q.eq("account_id", accountId).gte("fecha", desde).lte("fecha", hasta),
  );
  return filas.map((o) => ({
    orderId: Number(o.order_id),
    fecha: o.fecha,
    total: Number(o.total) || 0,
    neto: Number(o.neto) || 0,
    netoActual: o.neto_actual == null ? null : Number(o.neto_actual),
    reembolsado: Number(o.reembolsado) || 0,
    estado: o.estado ?? null,
    estadoPago: o.estado_pago ?? null,
    revisiones: Number(o.revisiones) || 0,
  }));
}

export async function cargarEstadoResultados(db: DB, cuenta: Cuenta, periodo: string): Promise<EstadoResultados> {
  const { desde, hasta } = rangoDelPeriodo(periodo);
  const [ventas, skus, config, gastos, cargos, ordenes, publicidad, progreso] = await Promise.all([
    leerVentas(db, cuenta.id, desde, hasta),
    traerTodo<{ sku: string; modelo: string | null }>(db, "skus", "sku, modelo", (q) => q.eq("account_id", cuenta.id)),
    configPorProducto(db, cuenta.id),
    gastosDelRango(db, cuenta.id, desde, hasta),
    cargosGuardados(db, cuenta.id, periodo),
    ordenesDelRango(db, cuenta.id, desde, hasta),
    cargarPublicidad(db, cuenta, { desde, hasta }).catch((err) => ({
      filas: [] as { modelo: string; gastoAds: number }[],
      sinAmarre: { gasto: 0 },
      errorAds: `No se pudo leer Product Ads: ${(err as Error).message}`,
    })),
    progresoCargos(db, cuenta.id, periodo).catch(() => ({ periodo, clave: null, offset: 0, total: null, completo: false, actualizadoEn: null })),
  ]);

  const modeloDeSku = new Map<string, string>();
  for (const s of skus) if (s.modelo) modeloDeSku.set(s.sku, s.modelo);
  const adsPorModelo = new Map<string, number>();
  for (const f of publicidad.filas) if (f.gastoAds > 0) adsPorModelo.set(f.modelo, f.gastoAds);

  return armarEstadoResultados({
    periodo,
    desde,
    hasta,
    cuenta: cuenta.nickname,
    ventas,
    ordenes,
    modeloDeSku,
    config,
    adsPorModelo,
    adsSinAmarre: publicidad.sinAmarre.gasto,
    errorAds: publicidad.errorAds,
    gastos,
    cargos,
    cargosLeidos: progreso.completo,
    cargosAvance: { offset: progreso.offset, total: progreso.total },
  });
}

// ---------------------------------------------------------------------------
// Cortes guardados
// ---------------------------------------------------------------------------

export interface CorteGuardado {
  id: number;
  periodo: string;
  desde: string;
  hasta: string;
  creadoEn: string;
  ventaBruta: number;
  netoDepositado: number;
  utilidadNeta: number;
  exacto: boolean;
}

export async function hacerCorte(
  db: DB,
  cuenta: Cuenta,
  periodo: string,
  creadoPor: string | null,
): Promise<{ id: number; estado: EstadoResultados }> {
  const estado = await cargarEstadoResultados(db, cuenta, periodo);
  const { data, error } = await db
    .from("cortes_meli")
    .upsert(
      {
        account_id: cuenta.id,
        periodo,
        desde: estado.desde,
        hasta: estado.hasta,
        resumen: estado,
        creado_en: new Date().toISOString(),
        creado_por: creadoPor,
      },
      { onConflict: "account_id,periodo" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error(`No se pudo guardar el corte: ${error?.message ?? "sin id"}`);
  return { id: Number(data.id), estado };
}

export async function listarCortes(db: DB, accountId: string): Promise<CorteGuardado[]> {
  const { data } = await db
    .from("cortes_meli")
    .select("id, periodo, desde, hasta, creado_en, resumen")
    .eq("account_id", accountId)
    .order("periodo", { ascending: false })
    .limit(36);
  return (data ?? []).map((c: any) => ({
    id: Number(c.id),
    periodo: c.periodo,
    desde: c.desde,
    hasta: c.hasta,
    creadoEn: c.creado_en,
    ventaBruta: Number(c.resumen?.ventaBruta) || 0,
    netoDepositado: Number(c.resumen?.netoDepositado) || 0,
    utilidadNeta: Number(c.resumen?.utilidadNeta) || 0,
    exacto: Boolean(c.resumen?.revision?.exacto),
  }));
}

export async function cargarCorteGuardado(
  db: DB,
  accountId: string,
  id: number,
): Promise<{ estado: EstadoResultados; creadoEn: string } | null> {
  const { data } = await db
    .from("cortes_meli")
    .select("resumen, creado_en")
    .eq("account_id", accountId)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return { estado: data.resumen as EstadoResultados, creadoEn: data.creado_en };
}
