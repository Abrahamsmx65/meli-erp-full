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
import { traerRpcTodo, traerTodo, type Cuenta, type DB } from "../datos/repos";
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
  /** distingue un saldo confirmado en cero del cero temporal antes de leer Mercado Pago */
  netoLeido?: boolean;
  reembolsado: number;
  /** reembolso que ya estaba descontado cuando se guardó el primer neto */
  reembolsoIncluidoNetoBase?: number | null;
  /** false/null = la primera lectura no permite separar con certeza reembolso y cargos desconocidos */
  reembolsoBaseConfiable?: boolean | null;
  estado: string | null;
  estadoPago: string | null;
  revisiones: number;
  comisionMp?: number;
  envio?: number;
  isr?: number;
  iva?: number;
  otrosCargos?: number;
  cargosSinDesglosar?: number;
  cargosLeidos?: boolean;
  tipoVenta?: "directa" | "reventa" | null;
  renglones?: { sku: string; importe: number; unidades?: number }[] | null;
  /** retención que Mercado Pago entregó sumada, sin separar ISR de IVA */
  retencionMp?: number;
  /** reventa: precio público reconstruido; null = sin reconstruir */
  totalComprador?: number | null;
  /** false = la comisión aún no estaba toda publicada al leer (orden reciente) */
  cargosCompletos?: boolean | null;
  /** "v1/payments" cuando el desglose salió del pago real */
  cargosFuente?: string | null;
}

export interface VentaDelCorte {
  sku: string;
  fecha: string;
  unidades: number;
  ordenes?: number;
  importe?: number;
  comision?: number;
  neto?: number;
  /** true también para saldos reales en cero o negativos */
  netoConfirmado?: boolean;
}

export interface RenglonModelo {
  modelo: string;
  categoria: string | null;
  unidades: number;
  importe: number;
  comision: number;
  envio: number;
  isr: number;
  iva: number;
  otrosCargos: number;
  ajusteLiquidacion: number;
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
  comision: number;
  envio: number;
  isr: number;
  iva: number;
  otrosCargos: number;
  ajusteLiquidacion: number;
  neto: number;
  costo: number | null;
  publicidad: number;
  ganancia: number | null;
}

export interface DesgloseSku {
  sku: string;
  neto: number;
  comision: number;
  envio: number;
  isr: number;
  iva: number;
  otrosCargos: number;
  ajusteLiquidacion: number;
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
  envio: number;
  isr: number;
  iva: number;
  otrosCargos: number;
  cargosSinDesglosar: number;
  /** cargos diferidos o reversas que cambiaron el neto después del depósito original */
  ajusteLiquidacion: number;
  /** alias compatible con cortes guardados antes del desglose */
  enviosYOtros: number;
  netoDepositado: number;
  /** siempre 0 desde que nada se estima; se conserva por los cortes guardados antes */
  netoEstimado: number;
  /** venta cuyo depósito aún no se lee: NO está en el neto ni en la utilidad (se declara) */
  ventaSinDeposito?: number;
  /** fracción de la venta bruta cuyo neto es el depósito real (0-1) */
  coberturaNetoReal: number;

  cancelaciones: { ordenes: number; importe: number };
  /**
   * Devoluciones: se resta lo reembolsado y se SUMA de vuelta el costo de
   * los pares devueltos, que regresan al stock (decisión del dueño). Exacto
   * cuando la orden tiene sus renglones; estimado con costo ÷ venta del mes
   * cuando no.
   */
  devoluciones: {
    ordenes: number;
    /** reembolso que Mercado Pago ya descontó del neto actual (informativo) */
    incluidoEnNeto: number;
    /** parte del reembolso que todavía debe restarse aparte del neto actual */
    monto: number;
    unidades: number;
    costoRecuperado: number;
    /** siempre 0 desde que nada se estima; se conserva por los cortes guardados antes */
    costoEstimado: number;
    unidadesSinCosto: number;
  };
  /**
   * Ventas en REVENTA (MELI compra y revende, verificado con la orden
   * 2000014843734267 del 3 sep 2026): el importe de la orden ya viene neto
   * de comisión y envío, que MELI absorbe, y Mercado Pago lo deposita
   * completo. Por eso no traen comisión y no se les descuenta nada más.
   */
  reventa: {
    ordenes: number;
    /** lo que MELI pagó (ya neto) */
    importe: number;
    /** precio público reconstruido (decisión del dueño); igual a importe en cortes viejos */
    totalComprador?: number;
    reconstruidas?: number;
  };
  /** retención que llegó sumada sin separar ISR de IVA (forma vieja del pago) */
  retencionSinSeparar?: number;

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

/** Lo que el motor necesita de las órdenes de UN día, ya sumado (en pesos). */
export interface DiaOrdenesAgregado {
  fecha: string;
  /** órdenes vivas (no canceladas) */
  ordenes: number;
  /** neto de hoy de las órdenes vivas */
  neto: number;
  cancelOrdenes: number;
  cancelImporte: number;
  devOrdenes: number;
  devEnNeto?: number;
  devMonto: number;
  ajusteLiquidacion?: number;
  /** todas las órdenes del día, canceladas incluidas */
  total: number;
  revisadas: number;
  pendientes: number;
  /** órdenes vivas sin renglones (solo fundas) */
  sinRenglones?: number;
  /**
   * Órdenes en REVENTA (MELI compra y revende): se depositan completas
   * (neto ≥ 99% del total) porque su importe YA viene neto de comisión y
   * envío, que MELI absorbe. No cuestan nada más.
   */
  sinDescOrdenes?: number;
  /** la venta (ya neta) de esas órdenes */
  sinDescTotal?: number;
  /** costo (Productos y costos) de los pares de las órdenes devueltas con renglones */
  devCosto?: number;
  devUnidades?: number;
  /** pares devueltos de modelos sin costo capturado */
  devSinCostoUnidades?: number;
  /** reembolso sin cantidades devueltas verificables (su costo se estima) */
  devSinRenglonesMonto?: number;
  comisionMp?: number;
  envio?: number;
  isr?: number;
  iva?: number;
  otrosCargos?: number;
  cargosSinDesglosar?: number;
  cargosLeidos?: number;
  netosLeidos?: number;
  /** órdenes reembolsadas cuya primera liquidación no permite certificar el puente */
  reembolsosBasePendientes?: number;
  /** retención sumada sin separar ISR de IVA (forma vieja del pago) */
  retencionMp?: number;
  /** reventa: Σ precio público reconstruido (o el total si no se reconstruyó) */
  reventaTotalComprador?: number;
  /** órdenes en reventa con precio público reconstruido */
  reventaReconstruidas?: number;
  /** órdenes vivas con el desglose leído y la comisión completa */
  cargosCompletos?: number;
  /** órdenes vivas cuyo desglose salió del pago real (/v1/payments) */
  cargosReales?: number;
  /** venta y depósito de las órdenes vivas SIN desglose leído: su cargo es total − depósito, exacto */
  sinDesgloseTotal?: number;
  sinDesgloseNeto?: number;
  /** órdenes a las que YA les toca su revisión (10 o 40 días de vendidas) */
  pendientesVencidas?: number;
}

/** Hoy en hora de México (AAAA-MM-DD). */
const hoyMexico = () => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
const restarDias = (dia: string, n: number) => new Date(Date.parse(dia) - n * 86_400_000).toISOString().slice(0, 10);

/**
 * Suma las órdenes por día con la regla de la devolución: si Mercado Pago ya
 * bajó el neto, solo se resta lo que falte. Es la referencia de lo que hacen
 * los RPC `cortes_ordenes_por_dia` y `yz_cortes_ordenes_por_dia` en la base.
 */
export function agregarOrdenes(ordenes: OrdenDelCorte[], desde: string, hasta: string, hoy = hoyMexico()): DiaOrdenesAgregado[] {
  const dias = new Map<string, {
    ordenes: number; neto: number; cancelOrdenes: number; cancelImporte: number;
    devOrdenes: number; devEnNeto: number; devMonto: number; ajusteLiquidacion: number; total: number; revisadas: number;
    pendientes: number; pendientesVencidas: number; sinDescOrdenes: number; sinDescTotal: number;
    sinRenglones: number;
    devSinRenglonesMonto: number; comisionMp: number; envio: number; isr: number;
    iva: number; otrosCargos: number; cargosSinDesglosar: number; cargosLeidos: number;
    netosLeidos: number; reembolsosBasePendientes: number;
    retencionMp: number; reventaTotalComprador: number; reventaReconstruidas: number;
    cargosCompletos: number; cargosReales: number; sinDesgloseTotal: number; sinDesgloseNeto: number;
  }>();
  const vencePrimera = restarDias(hoy, 10);
  const venceSegunda = restarDias(hoy, 40);
  for (const o of ordenes) {
    if (o.fecha < desde || o.fecha > hasta) continue;
    const d = dias.get(o.fecha) ?? {
      ordenes: 0, neto: 0, cancelOrdenes: 0, cancelImporte: 0, devOrdenes: 0,
      devEnNeto: 0, devMonto: 0, ajusteLiquidacion: 0, total: 0, revisadas: 0, pendientes: 0, pendientesVencidas: 0, sinDescOrdenes: 0,
      sinDescTotal: 0, sinRenglones: 0, devSinRenglonesMonto: 0, comisionMp: 0, envio: 0,
      isr: 0, iva: 0, otrosCargos: 0, cargosSinDesglosar: 0, cargosLeidos: 0,
      netosLeidos: 0, reembolsosBasePendientes: 0,
      retencionMp: 0, reventaTotalComprador: 0, reventaReconstruidas: 0, cargosCompletos: 0, cargosReales: 0,
      sinDesgloseTotal: 0, sinDesgloseNeto: 0,
    };
    d.total++;
    const revisiones = o.revisiones ?? 0;
    if (revisiones >= 1) d.revisadas++;
    if (revisiones < 2) d.pendientes++;
    if ((revisiones === 0 && o.fecha <= vencePrimera) || (revisiones === 1 && o.fecha <= venceSegunda)) d.pendientesVencidas++;
    if (o.estado === "cancelled") {
      d.cancelOrdenes++;
      d.cancelImporte += c(o.total);
    } else {
      if (!o.renglones?.length) d.sinRenglones++;
      const netoOriginal = c(o.neto);
      const netoHoy = o.netoActual != null ? c(o.netoActual) : netoOriginal;
      const reembolso = Math.max(0, c(o.reembolsado));
      const reembolsoBase = Math.min(reembolso, Math.max(0, c(o.reembolsoIncluidoNetoBase)));
      const movimientoPosterior = Math.max(0, netoOriginal - netoHoy);
      const devolucionEnNeto = Math.min(reembolso, reembolsoBase + movimientoPosterior);
      const baseConfiable =
        o.reembolsoBaseConfiable ??
        (reembolso === 0);
      const devolucion = baseConfiable ? Math.max(0, reembolso - devolucionEnNeto) : 0;
      d.devEnNeto += devolucionEnNeto;
      d.ajusteLiquidacion += netoOriginal - netoHoy - Math.max(0, devolucionEnNeto - reembolsoBase);
      if (reembolso > 0 && !baseConfiable) d.reembolsosBasePendientes++;
      d.ordenes++;
      d.neto += netoHoy;
      if (o.netoLeido ?? (o.neto !== 0 || o.netoActual != null)) d.netosLeidos++;
      if (o.cargosLeidos) d.cargosLeidos++;
      else {
        // Su cargo exacto es total − depósito ORIGINAL: lo que bajó después
        // (reembolso, ajuste de liquidación) ya se cuenta aparte.
        d.sinDesgloseTotal += c(o.total);
        d.sinDesgloseNeto += netoOriginal;
      }
      if (o.cargosLeidos && o.cargosCompletos !== false) d.cargosCompletos++;
      if (o.cargosFuente === "v1/payments") d.cargosReales++;
      d.comisionMp += c(o.comisionMp);
      d.envio += c(o.envio);
      d.isr += c(o.isr);
      d.iva += c(o.iva);
      d.otrosCargos += c(o.otrosCargos);
      d.retencionMp += c(o.retencionMp);
      d.cargosSinDesglosar += c(o.cargosSinDesglosar);
      if (o.tipoVenta === "reventa" || (o.tipoVenta == null && c(o.total) > 0 && netoHoy >= c(o.total) * 0.99)) {
        d.sinDescOrdenes++;
        d.sinDescTotal += c(o.total);
        d.reventaTotalComprador += o.totalComprador != null ? c(o.totalComprador) : c(o.total);
        if (o.totalComprador != null) d.reventaReconstruidas++;
      }
      if (reembolso > 0 || o.estadoPago === "refunded" || o.estadoPago === "charged_back") {
        d.devOrdenes++;
        d.devMonto += devolucion;
        // El costo del producto devuelto depende del reembolso original, no de
        // cuánto de ese reembolso ya apareció en el saldo actual.
        d.devSinRenglonesMonto += reembolso;
      }
    }
    dias.set(o.fecha, d);
  }
  return [...dias.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([fecha, d]) => ({
      fecha, ...d, neto: p(d.neto), cancelImporte: p(d.cancelImporte),
      devMonto: p(d.devMonto), sinDescTotal: p(d.sinDescTotal),
      devEnNeto: p(d.devEnNeto),
      ajusteLiquidacion: p(d.ajusteLiquidacion),
      devSinRenglonesMonto: p(d.devSinRenglonesMonto),
      comisionMp: p(d.comisionMp), envio: p(d.envio), isr: p(d.isr),
      iva: p(d.iva), otrosCargos: p(d.otrosCargos),
      cargosSinDesglosar: p(d.cargosSinDesglosar),
      retencionMp: p(d.retencionMp),
      reventaTotalComprador: p(d.reventaTotalComprador),
      sinDesgloseTotal: p(d.sinDesgloseTotal),
      sinDesgloseNeto: p(d.sinDesgloseNeto),
    }));
}

export interface EntradaCorte {
  periodo: string;
  desde: string;
  hasta: string;
  cuenta?: string | null;
  generadoEn?: string;
  /** renglones de ventas_diarias, se filtran al rango aquí */
  ventas: VentaDelCorte[];
  /** órdenes de ordenes_neto del rango (o, en su lugar, ya sumadas por día) */
  ordenes?: OrdenDelCorte[];
  ordenesPorDia?: DiaOrdenesAgregado[];
  /** Neto actual y cargos de las órdenes, atribuidos solo a sus propios SKUs. */
  desglosePorSku?: DesgloseSku[];
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
  /** avisos extra del que arma la entrada (p. ej. órdenes registradas a medias) */
  avisosExtra?: string[];

  /** true si el API de facturación de MELI ya se leyó COMPLETO para el periodo */
  cargosLeidos: boolean;
  /** avance de la lectura de facturación, para el aviso: renglones leídos y declarados */
  cargosAvance?: { offset: number; total: number | null };
}

/** Atribuye cada importe únicamente a los SKUs contenidos en su propia orden. */
export function desglosePorSkuDesdeOrdenes(ordenes: OrdenDelCorte[]): DesgloseSku[] {
  const acumulado = new Map<string, { neto: number; comision: number; envio: number; isr: number; iva: number; otrosCargos: number; ajusteLiquidacion: number }>();
  const campos = ["neto", "comision", "envio", "isr", "iva", "otrosCargos", "ajusteLiquidacion"] as const;
  for (const o of ordenes) {
    if (o.estado === "cancelled" || !o.renglones?.length) continue;
    const pesos = o.renglones.map((r) => Math.max(0, c(r.importe)));
    const pesoTotal = pesos.reduce((a, x) => a + x, 0);
    if (pesoTotal <= 0) continue;
    const totales = {
      neto: o.netoActual != null ? c(o.netoActual) : c(o.neto),
      comision: c(o.comisionMp),
      envio: c(o.envio),
      isr: c(o.isr),
      iva: c(o.iva),
      otrosCargos: c(o.otrosCargos) + c(o.cargosSinDesglosar),
      ajusteLiquidacion:
        (c(o.neto) - (o.netoActual != null ? c(o.netoActual) : c(o.neto))) -
        Math.max(
          0,
          Math.min(
            c(o.reembolsado),
            Math.max(0, c(o.reembolsoIncluidoNetoBase)) +
              Math.max(0, c(o.neto) - (o.netoActual != null ? c(o.netoActual) : c(o.neto))),
          ) - Math.max(0, c(o.reembolsoIncluidoNetoBase)),
        ),
    };
    const repartos = Object.fromEntries(campos.map((campo) => [campo, { restante: totales[campo], pesoRestante: pesoTotal }])) as
      Record<(typeof campos)[number], { restante: number; pesoRestante: number }>;
    o.renglones.forEach((r, indice) => {
      const sku = r.sku;
      const actual = acumulado.get(sku) ?? { neto: 0, comision: 0, envio: 0, isr: 0, iva: 0, otrosCargos: 0, ajusteLiquidacion: 0 };
      for (const campo of campos) {
        const estado = repartos[campo];
        const parte = indice === o.renglones!.length - 1 || estado.pesoRestante <= 0
          ? estado.restante
          : Math.round((estado.restante * pesos[indice]) / estado.pesoRestante);
        actual[campo] += parte;
        estado.restante -= parte;
        estado.pesoRestante -= pesos[indice];
      }
      acumulado.set(sku, actual);
    });
  }
  return [...acumulado].map(([sku, x]) => ({
    sku,
    neto: p(x.neto),
    comision: p(x.comision),
    envio: p(x.envio),
    isr: p(x.isr),
    iva: p(x.iva),
    otrosCargos: p(x.otrosCargos),
    ajusteLiquidacion: p(x.ajusteLiquidacion),
  }));
}

export function armarEstadoResultados(e: EntradaCorte): EstadoResultados {
  const avisos: string[] = [...(e.avisosExtra ?? [])];
  const modeloDe = (sku: string): string => e.modeloDeSku.get(sku) ?? sku.split("-")[0] ?? sku;
  // Regla del dueño: NADA se estima. Lo que no tiene depósito leído de
  // Mercado Pago no entra al neto; se declara cuánto es y el corte queda
  // marcado como parcial hasta que el fondo lo lea.

  // --- Órdenes: el neto real, las cancelaciones y las devoluciones --------
  // Ya sumadas por día (por el RPC de la base o por agregarOrdenes), en centavos.
  interface DiaOrdenes { neto: number; ordenes: number; netosLeidos: number; puenteLiquidacion: number }
  const ordenesPorDia = new Map<string, DiaOrdenes>();
  let cancelOrdenes = 0;
  let cancelImporte = 0;
  let devOrdenes = 0;
  let devEnNeto = 0;
  let devMonto = 0;
  let revisadas = 0;
  let pendientes = 0;
  let totalOrdenes = 0;
  let sinDescOrdenes = 0;
  let sinDescTotal = 0;
  let reventaTotalComprador = 0;
  let reventaReconstruidas = 0;
  let retencionSinSeparar = 0;
  let devCosto = 0;
  let devUnidades = 0;
  let devSinCosto = 0;
  let devSinRenglones = 0;
  let sinRenglones = 0;
  let comisionMp = 0;
  let envio = 0;
  let isr = 0;
  let iva = 0;
  let otrosCargos = 0;
  let ajusteLiquidacion = 0;
  let cargosSinDesglosarGuardados = 0;
  let reembolsosBasePendientes = 0;
  let ordenesConDesglose = 0;
  let ordenesActivasConNeto = 0;
  let sinDesgloseTotal = 0;
  let sinDesgloseNeto = 0;
  let pendientesVencidas = 0;
  const agregados = e.ordenesPorDia ?? agregarOrdenes(e.ordenes ?? [], e.desde, e.hasta);
  for (const d of agregados) {
    if (d.fecha < e.desde || d.fecha > e.hasta) continue;
    totalOrdenes += d.total;
    ordenesActivasConNeto += d.ordenes;
    sinDescOrdenes += d.sinDescOrdenes ?? 0;
    sinDescTotal += c(d.sinDescTotal);
    reventaTotalComprador += d.reventaTotalComprador != null ? c(d.reventaTotalComprador) : c(d.sinDescTotal);
    reventaReconstruidas += d.reventaReconstruidas ?? 0;
    retencionSinSeparar += c(d.retencionMp);
    devCosto += c(d.devCosto);
    devUnidades += d.devUnidades ?? 0;
    devSinCosto += d.devSinCostoUnidades ?? 0;
    devSinRenglones += c(d.devSinRenglonesMonto);
    sinRenglones += d.sinRenglones ?? 0;
    comisionMp += c(d.comisionMp);
    envio += c(d.envio);
    isr += c(d.isr);
    iva += c(d.iva);
    otrosCargos += c(d.otrosCargos);
    ajusteLiquidacion += c(d.ajusteLiquidacion);
    cargosSinDesglosarGuardados += c(d.cargosSinDesglosar);
    reembolsosBasePendientes += d.reembolsosBasePendientes ?? 0;
    ordenesConDesglose += d.cargosLeidos ?? 0;
    sinDesgloseTotal += c(d.sinDesgloseTotal);
    sinDesgloseNeto += c(d.sinDesgloseNeto);
    revisadas += d.revisadas;
    pendientes += d.pendientes;
    pendientesVencidas += d.pendientesVencidas ?? 0;
    cancelOrdenes += d.cancelOrdenes;
    cancelImporte += c(d.cancelImporte);
    devOrdenes += d.devOrdenes;
    devEnNeto += c(d.devEnNeto);
    devMonto += c(d.devMonto);
    if (d.ordenes > 0) {
      ordenesPorDia.set(d.fecha, {
        neto: c(d.neto),
        ordenes: d.ordenes,
        netosLeidos: d.netosLeidos ?? (d.neto !== 0 ? d.ordenes : 0),
        puenteLiquidacion: c(d.devEnNeto) + c(d.ajusteLiquidacion),
      });
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
    const netoNumerico = v.neto == null ? null : Number(v.neto);
    const netoConfirmado =
      v.netoConfirmado === true ||
      (v.netoConfirmado == null && netoNumerico != null && netoNumerico > 0);
    const netoFila = netoConfirmado && netoNumerico != null && Number.isFinite(netoNumerico)
      ? c(netoNumerico)
      : null;
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
    m.neto += netoFila ?? 0;
    porModelo.set(modelo, m);
  }

  // --- Neto del mes, día por día ------------------------------------------
  let unidades = 0;
  let ordenes = 0;
  let ventaBruta = 0;
  let comision = 0;
  let netoDepositado = 0;
  /** venta (importe) cuyo depósito aún no se ha leído: NO está en el neto */
  let ventaSinDeposito = 0;
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

    let netoDia: number;
    let real: boolean;
    if (o && o.netosLeidos >= o.ordenes) {
      // Las órdenes son la verdad; los renglones, su reparto redondeado.
      // Una fila histórica puede conservar el saldo original; una ya
      // refrescada contiene el actual. Cualquiera de los dos debe cuadrar.
      let usarNetoDeOrdenes = true;
      if (f.importeSinNeto === 0 && f.netoFilas > 0) {
        const diferenciaActual = Math.abs(f.netoFilas - o.neto);
        const diferenciaHistorica = Math.abs((f.netoFilas - o.neto) - o.puenteLiquidacion);
        const diferencia = Math.min(diferenciaActual, diferenciaHistorica);
        if (diferencia > Math.max(5_000, f.netoFilas * 0.02)) {
          diasDescuadrados.push(fecha);
          usarNetoDeOrdenes = false;
        }
      }
      // Si faltan órdenes guardadas, el total diario completo es más seguro
      // que sustituirlo por un subtotal aunque ese subtotal tenga neto leído.
      netoDia = usarNetoDeOrdenes ? o.neto : f.netoFilas;
      real = true;
      importeConNetoReal += f.importe;
    } else {
      // Solo lo real. La venta sin depósito leído se declara aparte.
      netoDia = f.netoFilas;
      ventaSinDeposito += f.importeSinNeto;
      importeConNetoReal += f.importe - f.importeSinNeto;
      real = f.importeSinNeto === 0;
    }
    netoDepositado += netoDia;
    porDia.push({ fecha, unidades: f.unidades, ordenes: f.ordenes, importe: p(f.importe), neto: p(netoDia), real });
  }
  const desgloseCompleto =
    ordenesActivasConNeto === 0 || ordenesConDesglose >= ordenesActivasConNeto;
  // El desglose por orden se usa en cuanto HAY órdenes con desglose: lo que
  // falte entra como «sin desglose» con su cargo exacto (total − depósito).
  // Antes UNA orden sin desglose tiraba el mes al cálculo residual, donde
  // la comisión y el envío reconstruidos de las reventas (que solo cierran
  // con la venta al precio público) salían como un descuadre de cientos de
  // miles (10-sep-2026).
  const usarDesglosePorOrden = ordenesActivasConNeto > 0 && ordenesConDesglose > 0;
  if (usarDesglosePorOrden) comision = comisionMp;
  // Reventa al precio público (decisión del dueño): la venta bruta sube lo
  // que la reconstrucción le puso de comisión y envío, para que se compare
  // con las ventas normales y la cascada cierre con esos cargos contemplados.
  const reventaInflacion = Math.max(0, reventaTotalComprador - sinDescTotal);
  if (usarDesglosePorOrden) ventaBruta += reventaInflacion;

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
      envio: 0,
      isr: 0,
      iva: 0,
      otrosCargos: 0,
      ajusteLiquidacion: 0,
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
      unidades: 0, importe: 0, comision: 0, envio: 0, isr: 0, iva: 0, otrosCargos: 0, ajusteLiquidacion: 0, neto: 0,
      costo: e.config.get(modelo)?.costo != null ? 0 : null,
      publicidad: p(c(gasto)),
      ganancia: e.config.get(modelo)?.costo != null ? p(-c(gasto)) : null,
    });
  }
  const desglosePorSku = e.desglosePorSku ?? desglosePorSkuDesdeOrdenes(e.ordenes ?? []);
  const desglosePorModelo = new Map<string, { neto: number; comision: number; envio: number; isr: number; iva: number; otrosCargos: number; ajusteLiquidacion: number }>();
  for (const r of desglosePorSku) {
    const modelo = modeloDe(r.sku);
    const m = desglosePorModelo.get(modelo) ?? { neto: 0, comision: 0, envio: 0, isr: 0, iva: 0, otrosCargos: 0, ajusteLiquidacion: 0 };
    m.neto += c(r.neto);
    m.comision += c(r.comision);
    m.envio += c(r.envio);
    m.isr += c(r.isr);
    m.iva += c(r.iva);
    m.otrosCargos += c(r.otrosCargos);
    m.ajusteLiquidacion += c(r.ajusteLiquidacion);
    desglosePorModelo.set(modelo, m);
  }
  // El residual concilia exactamente venta − comisión − depósito. Los cargos
  // explícitos solo lo explican; no se descuentan otra vez de la utilidad.
  // Con desglose por orden, lo que no lo tiene aporta su cargo exacto.
  const cargosNoComision = ventaBruta - comision - netoDepositado - devEnNeto;
  const cargosConocidos = envio + isr + iva + retencionSinSeparar + otrosCargos + ajusteLiquidacion;
  const cargosSinDesglosar = usarDesglosePorOrden
    ? cargosSinDesglosarGuardados + Math.max(0, sinDesgloseTotal - sinDesgloseNeto)
    : cargosNoComision - cargosConocidos;
  let desgloseAtribuible =
    usarDesglosePorOrden && sinRenglones === 0 && desglosePorModelo.size > 0;
  if (desgloseAtribuible) {
    const tolerancia = Math.max(100, desglosePorModelo.size);
    const suma = (campo: "neto" | "comision" | "envio" | "isr" | "iva" | "otrosCargos" | "ajusteLiquidacion") =>
      [...desglosePorModelo.values()].reduce((a, x) => a + x[campo], 0);
    const objetivos = {
      neto: netoDepositado,
      comision,
      envio,
      isr,
      iva,
      otrosCargos: otrosCargos + cargosSinDesglosarGuardados,
      ajusteLiquidacion,
    };
    desgloseAtribuible = (Object.keys(objetivos) as (keyof typeof objetivos)[])
      .every((campo) => Math.abs(suma(campo) - objetivos[campo]) <= tolerancia);
  }
  if (desgloseAtribuible) {
    for (const f of filasModelo) {
      const x = desglosePorModelo.get(f.modelo);
      f.neto = p(x?.neto ?? 0);
      f.comision = p(x?.comision ?? 0);
      f.envio = p(x?.envio ?? 0);
      f.isr = p(x?.isr ?? 0);
      f.iva = p(x?.iva ?? 0);
      f.otrosCargos = p(x?.otrosCargos ?? 0);
      f.ajusteLiquidacion = p(x?.ajusteLiquidacion ?? 0);
    }
    const ajustar = (campo: "neto" | "comision" | "envio" | "isr" | "iva" | "otrosCargos" | "ajusteLiquidacion", objetivo: number) => {
      const principal = filasModelo.filter((f) => c(f.importe) > 0).sort((a, b) => c(b.importe) - c(a.importe))[0];
      if (!principal) return;
      const suma = filasModelo.reduce((a, f) => a + c(f[campo]), 0);
      principal[campo] = p(c(principal[campo]) + objetivo - suma);
    };
    ajustar("neto", netoDepositado);
    ajustar("comision", comision);
    ajustar("envio", envio);
    ajustar("isr", isr);
    ajustar("iva", iva);
    ajustar("otrosCargos", otrosCargos + cargosSinDesglosar);
    ajustar("ajusteLiquidacion", ajusteLiquidacion);
  }
  const repartirCargo = (total: number, campo: "comision" | "envio" | "isr" | "iva" | "otrosCargos" | "ajusteLiquidacion") => {
    const conVenta = filasModelo.filter((f) => c(f.importe) > 0);
    let restante = total;
    let pesoRestante = conVenta.reduce((a, f) => a + c(f.importe), 0);
    conVenta.forEach((f, indice) => {
      const peso = c(f.importe);
      const parte = indice === conVenta.length - 1 || pesoRestante <= 0
        ? restante
        : Math.round((restante * peso) / pesoRestante);
      f[campo] = p(parte);
      restante -= parte;
      pesoRestante -= peso;
    });
  };
  const enviosYOtros = envio + isr + iva + retencionSinSeparar + otrosCargos + cargosSinDesglosar + ajusteLiquidacion;
  if (!desgloseAtribuible) {
    repartirCargo(comision, "comision");
    repartirCargo(envio, "envio");
    repartirCargo(isr, "isr");
    repartirCargo(iva, "iva");
    repartirCargo(otrosCargos + cargosSinDesglosar, "otrosCargos");
    repartirCargo(ajusteLiquidacion, "ajusteLiquidacion");
  }
  for (const f of filasModelo) {
    f.ganancia = f.costo == null ? null : p(c(f.neto) - c(f.costo) - c(f.publicidad));
  }
  filasModelo.sort((a, b) => b.neto - a.neto || a.modelo.localeCompare(b.modelo, "es"));

  const cats = new Map<string, RenglonCategoria & { conCosto: boolean }>();
  for (const f of filasModelo) {
    const nombre = f.categoria ?? "Sin categoría";
    const k = cats.get(nombre) ?? {
      categoria: nombre, unidades: 0, importe: 0, comision: 0, envio: 0,
      isr: 0, iva: 0, otrosCargos: 0, ajusteLiquidacion: 0, neto: 0, costo: 0, publicidad: 0,
      ganancia: 0, conCosto: false,
    };
    k.unidades += f.unidades;
    k.importe = p(c(k.importe) + c(f.importe));
    k.comision = p(c(k.comision) + c(f.comision));
    k.envio = p(c(k.envio) + c(f.envio));
    k.isr = p(c(k.isr) + c(f.isr));
    k.iva = p(c(k.iva) + c(f.iva));
    k.otrosCargos = p(c(k.otrosCargos) + c(f.otrosCargos));
    k.ajusteLiquidacion = p(c(k.ajusteLiquidacion) + c(f.ajusteLiquidacion));
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
  // Sin API de publicidad, la factura de MELI (PADS) es el respaldo.
  const adsFacturados = sumaCargos("publicidad");
  // …o cuando el API contesta CERO y la factura sí trae Product Ads: el
  // permiso puede faltar sin error explícito, o el advertiser no ser el de
  // esta cuenta.
  const adsDesdeFactura = adsAmarrados + adsSinAmarre === 0 && adsFacturados > 0;
  const publicidad = {
    ads: adsDesdeFactura ? adsFacturados : adsAmarrados + adsSinAmarre,
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

  // --- Costo recuperado de las devoluciones --------------------------------
  // Los pares devueltos regresan al stock: su costo no se perdió. SOLO se
  // suma cuando la orden tiene sus renglones (cantidades verificables); sin
  // ellos no se estima nada, se declara y la revisión los pide a MELI.
  const costoRecuperado = devCosto;

  // --- La cuenta -----------------------------------------------------------
  const utilidadBruta = netoDepositado - devMonto + costoRecuperado - costoProducto;
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
      `${p(ventaSinDeposito).toLocaleString("es-MX", { style: "currency", currency: "MXN" })} de venta (el ${Math.round((1 - coberturaNetoReal) * 100)}%) todavía no tiene el depósito real de Mercado Pago: NO está en el neto ni en la utilidad; nada se estima. El fondo lo lee solo y el corte se completa.`,
    );
  }
  if (diasDescuadrados.length) {
    avisos.push(
      `${diasDescuadrados.length} día(s) donde las órdenes y los renglones de venta no cuadran (${diasDescuadrados.slice(0, 5).join(", ")}): se usó el reparto por SKU. Casi siempre es una orden marcada como cancelada que MELI tiene pagada; el latido la repara solo. Si persiste, vuelve a sincronizar esos días.`,
    );
  }
  if (sinDescOrdenes > 0) {
    const pesos = (x: number) => p(x).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
    avisos.push(
      reventaInflacion > 0 && usarDesglosePorOrden
        ? `${sinDescOrdenes.toLocaleString("es-MX")} órdenes fueron ventas en REVENTA (MELI compra y revende): MELI pagó ${pesos(sinDescTotal)}, ya neto de comisión y envío. Para compararlas con las ventas normales, ${reventaReconstruidas.toLocaleString("es-MX")} se reconstruyeron al precio público (${pesos(reventaTotalComprador)}) con la tarifa de su categoría y el envío real del paquete: la venta bruta y la comisión suben ${pesos(reventaInflacion)} entre las dos; el neto no cambia.${sinDescOrdenes > reventaReconstruidas ? ` ${(sinDescOrdenes - reventaReconstruidas).toLocaleString("es-MX")} quedaron sin reconstruir (sin tarifa o sin envío leído) y van con lo que MELI pagó.` : ""}`
        : `${sinDescOrdenes.toLocaleString("es-MX")} órdenes por ${pesos(sinDescTotal)} fueron ventas en REVENTA (MELI compra y revende): su importe ya viene neto de comisión y envío, que MELI absorbe, y se depositó completo. Por eso la comisión del mes se ve baja: no es un error.`,
    );
  }
  if (retencionSinSeparar > 0) {
    avisos.push(
      `${p(retencionSinSeparar).toLocaleString("es-MX", { style: "currency", currency: "MXN" })} de retenciones llegaron sumadas (ISR + IVA) sin que Mercado Pago las separara: van en «Retenciones sin separar».`,
    );
  }
  if (pendientes > 0) {
    const porVencer = Math.max(0, pendientes - pendientesVencidas);
    avisos.push(
      pendientesVencidas > 0
        ? `${pendientesVencidas.toLocaleString("es-MX")} órdenes del mes ya tienen vencida una revisión de devolución/cancelación (a los 10 y 40 días) y el latido las está revisando; ${porVencer.toLocaleString("es-MX")} más aún no llegan al plazo. Hacer el corte las revisa todas.`
        : `${pendientes.toLocaleString("es-MX")} órdenes del mes aún no llegan al plazo de sus revisiones de devolución/cancelación (a los 10 y 40 días): se revisan solas cuando les toque. Hacer el corte las revisa todas.`,
    );
  }
  if (e.errorAds) {
    avisos.push(
      adsDesdeFactura
        ? `Publicidad: ${e.errorAds} Se tomó el cargo de Product Ads de la factura de MELI (${p(adsFacturados).toLocaleString("es-MX", { style: "currency", currency: "MXN" })}).`
        : `Publicidad: ${e.errorAds} Solo cuenta lo capturado a mano.`,
    );
  } else if (adsDesdeFactura) {
    avisos.push(
      `El API de Product Ads contestó cero y la factura de MELI sí trae publicidad: se tomó el cargo facturado (${p(adsFacturados).toLocaleString("es-MX", { style: "currency", currency: "MXN" })}), sin reparto por modelo.`,
    );
  }
  const bonificaciones = sumaCargos("bonificacion");
  if (bonificaciones > 0) {
    avisos.push(
      `MELI anuló cargos por ${p(bonificaciones).toLocaleString("es-MX", { style: "currency", currency: "MXN" })} en la factura (bonificaciones de venta y envío, casi siempre de órdenes canceladas o devueltas): no se suman como ingreso porque esas órdenes ya quedaron fuera o ya se restaron.`,
    );
  }
  if (!e.cargosLeidos) {
    const av = e.cargosAvance;
    avisos.push(
      av && av.offset > 0
        ? `La facturación de MELI va a medias: ${av.offset.toLocaleString("es-MX")}${av.total != null ? ` de ${av.total.toLocaleString("es-MX")}` : ""} renglones leídos (MELI da 5 llamadas por minuto; el latido la sigue solo). Los gastos de Full pueden estar incompletos.`
        : "No se han leído los cargos facturados por MELI del periodo (almacenamiento de Full, etc.): los gastos de Full solo incluyen lo capturado a mano.",
    );
  }
  if (!desgloseCompleto) {
    const cargoSinDesglose = Math.max(0, sinDesgloseTotal - sinDesgloseNeto);
    avisos.push(
      `${Math.max(0, ordenesActivasConNeto - ordenesConDesglose).toLocaleString("es-MX")} órdenes del periodo aún no tienen el desglose por operación de Mercado Pago${usarDesglosePorOrden ? `: su cargo (${p(cargoSinDesglose).toLocaleString("es-MX", { style: "currency", currency: "MXN" })}, venta − depósito) va en «Otros cargos sin desglose»` : ""}; el latido seguirá completándolo.`,
    );
  }
  if (usarDesglosePorOrden && !desgloseAtribuible) {
    avisos.push(
      "El desglose por operación está completo, pero algunas órdenes no se pudieron atribuir a sus propios productos; el reparto por modelo y categoría sigue marcado como parcial.",
    );
  }
  if (devSinRenglones > 0) {
    avisos.push(
      `${p(devSinRenglones).toLocaleString("es-MX", { style: "currency", currency: "MXN" })} de devoluciones aún no tienen leída la revisión del almacén de MELI (si el par volvió a la venta o se descartó): su costo recuperado NO se suma; nada se estima. La revisión de órdenes la lee sola.`,
    );
  }
  if (devSinCosto > 0) {
    avisos.push(`${devSinCosto.toLocaleString("es-MX")} pares devueltos son de modelos sin costo capturado: su costo no se pudo recuperar en la cuenta.`);
  }
  if (devOrdenes > 0) {
    avisos.push(
      "El costo de los pares devueltos se suma de vuelta SOLO cuando la revisión del almacén de MELI dice que volvieron a la venta; los descartados o no devueltos son merma (decisión del dueño, 9-sep-2026).",
    );
  }
  if (reembolsosBasePendientes > 0) {
    avisos.push(
      `${reembolsosBasePendientes.toLocaleString("es-MX")} orden(es) se leyeron por primera vez con un reembolso ya reportado, pero el neto base no permite separar con certeza cuánto ya estaba descontado. No se volvió a restar el reembolso y el corte queda marcado como parcial.`,
    );
  }
  if (cargosSinDesglosar > 0) {
    avisos.push(
      `${p(cargosSinDesglosar).toLocaleString("es-MX", { style: "currency", currency: "MXN" })} del depósito aún no trae concepto por operación; se muestra como «Otros cargos sin desglose» y no se descuenta dos veces.`,
    );
  }
  if (cargosSinDesglosar < 0) {
    avisos.push(
      `Los cargos detallados superan por ${p(-cargosSinDesglosar).toLocaleString("es-MX", { style: "currency", currency: "MXN" })} la diferencia entre venta y depósito. El ajuste se conserva con signo para que la conciliación no oculte el descuadre.`,
    );
  }
  if (isr + iva > 0) avisos.push("Las retenciones de ISR e IVA son impuesto adelantado que MELI entera al SAT; no son un gasto adicional y se acreditan en la declaración.");

  const exacto =
    pendientes === 0 && reembolsosBasePendientes === 0 && coberturaNetoReal >= 0.999 && ventaSinDeposito === 0 && coberturaCosto >= 0.999 && (!e.errorAds || adsDesdeFactura) && e.cargosLeidos && desgloseCompleto && (!usarDesglosePorOrden || desgloseAtribuible) && diasDescuadrados.length === 0;

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
    envio: p(envio),
    isr: p(isr),
    iva: p(iva),
    otrosCargos: p(otrosCargos),
    cargosSinDesglosar: p(cargosSinDesglosar),
    ajusteLiquidacion: p(ajusteLiquidacion),
    enviosYOtros: p(enviosYOtros),
    netoDepositado: p(netoDepositado),
    netoEstimado: 0,
    ventaSinDeposito: p(ventaSinDeposito),
    coberturaNetoReal,
    cancelaciones: { ordenes: cancelOrdenes, importe: p(cancelImporte) },
    devoluciones: {
      ordenes: devOrdenes,
      incluidoEnNeto: p(devEnNeto),
      monto: p(devMonto),
      unidades: devUnidades,
      costoRecuperado: p(costoRecuperado),
      costoEstimado: 0,
      unidadesSinCosto: devSinCosto,
    },
    reventa: {
      ordenes: sinDescOrdenes,
      importe: p(sinDescTotal),
      totalComprador: p(reventaTotalComprador),
      reconstruidas: reventaReconstruidas,
    },
    retencionSinSeparar: p(retencionSinSeparar),
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
    revision: { ordenes: totalOrdenes, revisadas, pendientes, exacto },
    avisos,
  };
}

// ---------------------------------------------------------------------------
// Carga desde la base
// ---------------------------------------------------------------------------

async function leerVentas(db: DB, accountId: string, desde: string, hasta: string): Promise<VentaDelCorte[]> {
  const filtro = (q: any) => q.eq("account_id", accountId).gte("fecha", desde).lte("fecha", hasta);
  const normalizar = (filas: any[]): VentaDelCorte[] => filas.map((f) => ({
    ...f,
    netoConfirmado: f.neto_confirmado === true || (f.neto_confirmado == null && Number(f.neto) > 0),
  }));
  try {
    return normalizar(await traerTodo<any>(
      db,
      "ventas_diarias",
      "sku, fecha, unidades, ordenes, importe, comision, neto, neto_confirmado",
      filtro,
    ));
  } catch {
    return normalizar(await traerTodo<any>(
      db,
      "ventas_diarias",
      "sku, fecha, unidades, ordenes, importe, comision, neto",
      filtro,
    ));
  }
}

export async function gastosDelRango(db: DB, accountId: string, desde: string, hasta: string, tabla = "gastos_meli"): Promise<GastoManual[]> {
  const filas = await traerTodo<any>(db, tabla, "id, fecha, concepto, categoria, monto", (q) =>
    q.eq("account_id", accountId).gte("fecha", desde).lte("fecha", hasta),
  );
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
    "order_id, fecha, total, neto, neto_actual, neto_en, reembolsado, reembolso_incluido_neto_base, reembolso_base_confiable, estado, estado_pago, revisiones, comision_mp, envio_mp, isr_mp, iva_mp, otros_mp, cargos_sin_desglosar, cargos_leidos_en, tipo_venta, retencion_mp, total_comprador, cargos_completos, cargos_fuente",
    (q) => q.eq("account_id", accountId).gte("fecha", desde).lte("fecha", hasta),
  );
  return filas.map((o) => ({
    orderId: Number(o.order_id),
    fecha: o.fecha,
    total: Number(o.total) || 0,
    neto: Number(o.neto) || 0,
    netoActual: o.neto_actual == null ? null : Number(o.neto_actual),
    netoLeido: o.neto_en != null,
    reembolsado: Number(o.reembolsado) || 0,
    reembolsoIncluidoNetoBase:
      o.reembolso_incluido_neto_base == null ? null : Number(o.reembolso_incluido_neto_base),
    reembolsoBaseConfiable:
      o.reembolso_base_confiable == null ? null : Boolean(o.reembolso_base_confiable),
    estado: o.estado ?? null,
    estadoPago: o.estado_pago ?? null,
    revisiones: Number(o.revisiones) || 0,
    comisionMp: Number(o.comision_mp) || 0,
    envio: Number(o.envio_mp) || 0,
    isr: Number(o.isr_mp) || 0,
    iva: Number(o.iva_mp) || 0,
    otrosCargos: Number(o.otros_mp) || 0,
    cargosSinDesglosar: Number(o.cargos_sin_desglosar) || 0,
    cargosLeidos: o.cargos_leidos_en != null,
    tipoVenta: o.tipo_venta ?? null,
    retencionMp: Number(o.retencion_mp) || 0,
    totalComprador: o.total_comprador == null ? null : Number(o.total_comprador),
    cargosCompletos: o.cargos_completos == null ? null : Boolean(o.cargos_completos),
    cargosFuente: o.cargos_fuente ?? null,
  }));
}

/** Las órdenes del rango ya sumadas por día, por el RPC de la base (una sola verificación de permiso). */
export async function ordenesPorDiaDesdeRpc(db: DB, fn: string, accountId: string, desde: string, hasta: string): Promise<DiaOrdenesAgregado[]> {
  const { data, error } = await db.rpc(fn, { p_account: accountId, p_desde: desde, p_hasta: hasta });
  if (error) throw new Error(`${fn}: ${error}`);
  return ((data ?? []) as any[]).map((d) => ({
    fecha: String(d.fecha),
    ordenes: Number(d.ordenes) || 0,
    neto: Number(d.neto) || 0,
    cancelOrdenes: Number(d.cancel_ordenes) || 0,
    cancelImporte: Number(d.cancel_importe) || 0,
    devOrdenes: Number(d.dev_ordenes) || 0,
    devEnNeto: Number(d.dev_en_neto) || 0,
    devMonto: Number(d.dev_monto) || 0,
    ajusteLiquidacion: Number(d.ajuste_liquidacion) || 0,
    total: Number(d.total) || 0,
    revisadas: Number(d.revisadas) || 0,
    pendientes: Number(d.pendientes) || 0,
    sinRenglones: Number(d.sin_renglones) || 0,
    sinDescOrdenes: Number(d.sin_desc_ordenes) || 0,
    sinDescTotal: Number(d.sin_desc_total) || 0,
    devCosto: Number(d.dev_costo) || 0,
    devUnidades: Number(d.dev_unidades) || 0,
    devSinCostoUnidades: Number(d.dev_sin_costo_unidades) || 0,
    devSinRenglonesMonto: Number(d.dev_sin_renglones_monto) || 0,
    comisionMp: Number(d.comision_mp) || 0,
    envio: Number(d.envio_mp) || 0,
    isr: Number(d.isr_mp) || 0,
    iva: Number(d.iva_mp) || 0,
    otrosCargos: Number(d.otros_mp) || 0,
    cargosSinDesglosar: Number(d.cargos_sin_desglosar) || 0,
    cargosLeidos: Number(d.cargos_leidos) || 0,
    netosLeidos: Number(d.netos_leidos) || 0,
    reembolsosBasePendientes: Number(d.reembolsos_base_pendientes) || 0,
    retencionMp: Number(d.retencion_mp) || 0,
    reventaTotalComprador: Number(d.reventa_total_comprador) || 0,
    reventaReconstruidas: Number(d.reventa_reconstruidas) || 0,
    cargosCompletos: Number(d.cargos_completos) || 0,
    cargosReales: Number(d.cargos_reales) || 0,
    sinDesgloseTotal: Number(d.sin_desglose_total) || 0,
    sinDesgloseNeto: Number(d.sin_desglose_neto) || 0,
    pendientesVencidas: Number(d.pendientes_vencidas) || 0,
  }));
}

export async function desglosePorSkuDesdeRpc(
  db: DB,
  fn: string,
  accountId: string,
  desde: string,
  hasta: string,
): Promise<DesgloseSku[]> {
  const { filas, error } = await traerRpcTodo<any>(
    db,
    fn,
    { p_account: accountId, p_desde: desde, p_hasta: hasta },
  );
  if (error) throw new Error(`${fn}: ${error}`);
  return filas.map((r) => ({
    sku: String(r.sku),
    neto: Number(r.neto) || 0,
    comision: Number(r.comision_mp) || 0,
    envio: Number(r.envio_mp) || 0,
    isr: Number(r.isr_mp) || 0,
    iva: Number(r.iva_mp) || 0,
    otrosCargos:
      (Number(r.otros_mp) || 0) +
      (Number(r.cargos_sin_desglosar) || 0),
    ajusteLiquidacion: Number(r.ajuste_liquidacion) || 0,
  }));
}

/** Neto ÷ venta de las órdenes normales de una ventana (RPC); null con menos de 50 órdenes. */
export async function ratioObservadoDesdeRpc(db: DB, fn: string, accountId: string, desde: string, hasta: string): Promise<number | null> {
  const { data, error } = await db.rpc(fn, { p_account: accountId, p_desde: desde, p_hasta: hasta });
  if (error) throw new Error(`${fn}: ${error.message}`);
  const f: any = Array.isArray(data) ? data[0] : data;
  const ordenes = Number(f?.ordenes ?? 0);
  const total = Number(f?.total ?? 0);
  const neto = Number(f?.neto ?? 0);
  return ordenes >= 50 && total > 0 ? neto / total : null;
}

export async function cargarEstadoResultados(db: DB, cuenta: Cuenta, periodo: string): Promise<EstadoResultados> {
  const { desde, hasta } = rangoDelPeriodo(periodo);
  const [ventas, skus, config, gastos, cargos, ordenesPorDia, desglosePorSku, publicidad, progreso] = await Promise.all([
    leerVentas(db, cuenta.id, desde, hasta),
    traerTodo<{ sku: string; modelo: string | null }>(db, "skus", "sku, modelo", (q) => q.eq("account_id", cuenta.id)),
    configPorProducto(db, cuenta.id),
    gastosDelRango(db, cuenta.id, desde, hasta),
    cargosGuardados(db, cuenta.id, periodo),
    // Sumadas en la base: traer 35 mil órdenes a la página se pasaba del tiempo.
    ordenesPorDiaDesdeRpc(db, "cortes_ordenes_por_dia", cuenta.id, desde, hasta),
    desglosePorSkuDesdeRpc(db, "cortes_desglose_por_sku", cuenta.id, desde, hasta),
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
    ordenesPorDia,
    desglosePorSku,
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

/** Congela un estado de resultados como el corte del periodo (el del mismo mes se reemplaza). */
export async function guardarCorte(
  db: DB,
  accountId: string,
  periodo: string,
  estado: EstadoResultados,
  creadoPor: string | null,
  tabla = "cortes_meli",
): Promise<number> {
  const { data, error } = await db
    .from(tabla)
    .upsert(
      {
        account_id: accountId,
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
  return Number(data.id);
}

export async function hacerCorte(
  db: DB,
  cuenta: Cuenta,
  periodo: string,
  creadoPor: string | null,
): Promise<{ id: number; estado: EstadoResultados }> {
  const estado = await cargarEstadoResultados(db, cuenta, periodo);
  const id = await guardarCorte(db, cuenta.id, periodo, estado, creadoPor);
  return { id, estado };
}

export async function listarCortes(db: DB, accountId: string, tabla = "cortes_meli"): Promise<CorteGuardado[]> {
  const { data } = await db
    .from(tabla)
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
  tabla = "cortes_meli",
): Promise<{ estado: EstadoResultados; creadoEn: string } | null> {
  const { data } = await db
    .from(tabla)
    .select("resumen, creado_en")
    .eq("account_id", accountId)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return { estado: data.resumen as EstadoResultados, creadoEn: data.creado_en };
}
