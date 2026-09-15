/**
 * Conciliación del dinero de Amazon: el reporte de TRANSACCIONES de Seller
 * Central (Pagos → Reportes → Transacciones → CSV del mes; "fecha/hora",
 * "Id. de liquidación", "tipo", "Id. del pedido", …, "total") contra los
 * eventos de la Finances API guardados en `amazon_finanzas_eventos`.
 *
 * Este módulo es PURO (sin base ni servidor): el navegador lee el CSV con
 * él y manda solo los renglones compactos, porque el archivo del mes pesa
 * más de lo que Vercel deja subir a una función (4.5 MB). El cruce con la
 * base vive en `conciliar-db.ts`.
 *
 * Es la prueba del dueño: mismo rango de fechas de asiento, orden por
 * orden, y los renglones sin pedido (publicidad, tarifas de FBA, ajustes)
 * por tipo contra lista. Lo que no cuadra se enseña con su monto; nada se
 * ajusta.
 *
 * El reporte indexa por fecha de PUBLICACIÓN (posted) y trae también las
 * transacciones DIFERIDAS (aún sin liberar): esas se cuentan aparte porque
 * el total del grupo de liquidación de Amazon no las incluye todavía.
 * "Trasferir" es el depósito del grupo anterior, no un movimiento del mes.
 */
import { leerCsv } from "../servicios/pedidos-sheet";

export interface RenglonReporte {
  fechaIso: string | null;
  liquidacion: string;
  tipo: string;
  orden: string | null;
  sku: string | null;
  cantidad: number;
  total: number;
  estado: string;
}

const MESES: Record<string, number> = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, sept: 8, oct: 9, nov: 10, dic: 11 };

/** "31 jul 2026 11:03:53 p.m. GMT-7" → ISO en UTC. */
export function fechaDeReporte(texto: string): string | null {
  const m = texto.trim().match(/^(\d{1,2})\s+([a-záé]+)\.?\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?\s*GMT([+-]\d{1,2})(?::?(\d{2}))?$/i);
  if (!m) return null;
  const mes = MESES[m[2].toLowerCase().replace(/\./g, "")];
  if (mes == null) return null;
  let hora = Number(m[4]);
  const ampm = (m[7] ?? "").toLowerCase().replace(/[\s.]/g, "");
  if (ampm === "pm" && hora < 12) hora += 12;
  if (ampm === "am" && hora === 12) hora = 0;
  const desfaseH = Number(m[8]);
  const desfaseM = m[9] ? Number(m[9]) * Math.sign(desfaseH || 1) : 0;
  const ms = Date.UTC(Number(m[3]), mes, Number(m[1]), hora, Number(m[5]), Number(m[6] ?? 0)) - (desfaseH * 60 + desfaseM) * 60_000;
  return new Date(ms).toISOString();
}

const numero = (x: string | undefined): number => {
  const t = (x ?? "").replace(/[,\s$]/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
};

/** Lee el CSV del reporte (BOM, preámbulo de definiciones, encabezado por nombre). */
export function leerReporteTransacciones(texto: string): RenglonReporte[] {
  const filas = leerCsv(texto);
  const iEnc = filas.findIndex((f) => f[0]?.toLowerCase() === "fecha/hora" || f[0]?.toLowerCase() === "date/time");
  if (iEnc < 0) throw new Error('No encontré el encabezado "fecha/hora" del reporte de transacciones de Amazon.');
  const enc = filas[iEnc].map((h) => h.toLowerCase());
  const col = (...nombres: string[]): number => {
    for (const n of nombres) {
      const i = enc.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const cFecha = col("fecha/hora", "date/time");
  const cLiq = col("id. de liquidación", "settlement id");
  const cTipo = col("tipo", "type");
  const cOrden = col("id. del pedido", "order id");
  const cSku = col("sku");
  const cCant = col("cantidad", "quantity");
  const cTotal = col("total");
  const cEstado = col("estado de la transacción", "transaction status");
  if (cTotal < 0 || cTipo < 0) throw new Error('Al reporte le faltan las columnas "tipo" o "total".');

  const salida: RenglonReporte[] = [];
  for (const f of filas.slice(iEnc + 1)) {
    if (!f.length || f.every((c) => !c)) continue;
    salida.push({
      fechaIso: cFecha >= 0 ? fechaDeReporte(f[cFecha] ?? "") : null,
      liquidacion: cLiq >= 0 ? f[cLiq] ?? "" : "",
      tipo: f[cTipo] ?? "",
      orden: cOrden >= 0 && f[cOrden] ? f[cOrden] : null,
      sku: cSku >= 0 && f[cSku] ? f[cSku] : null,
      cantidad: cCant >= 0 ? numero(f[cCant]) : 0,
      total: numero(f[cTotal]),
      estado: cEstado >= 0 ? f[cEstado] ?? "" : "",
    });
  }
  return salida;
}

/** Cómo llama Seller Central a cada lista de la Finances API. */
export const EQUIVALENCIAS: { tipos: string[]; listas: string[]; nombre: string }[] = [
  { nombre: "Pedidos (ventas)", tipos: ["Pedido", "Order"], listas: ["ShipmentEventList", "ShipmentSettleEventList"] },
  { nombre: "Reembolsos", tipos: ["Reembolso", "Refund"], listas: ["RefundEventList"] },
  { nombre: "Reembolsos por reintegro / contracargos", tipos: ["Reembolso por reintegro", "Chargeback Refund", "Reclamación de la garantía", "A-to-z Guarantee Refund"], listas: ["ChargebackEventList", "GuaranteeClaimEventList"] },
  { nombre: "Cargos retroactivos", tipos: ["Pedido_Cargo retroactivo", "Reembolso_Retroactivo", "Order_Retrocharge", "Refund_Retrocharge"], listas: ["RetrochargeEventList"] },
  { nombre: "Ajustes", tipos: ["Ajuste", "Adjustment"], listas: ["AdjustmentEventList"] },
  { nombre: "Publicidad (Amazon la llama «Tarifa de servicio»)", tipos: ["Tarifa de servicio", "Service Fee"], listas: ["ProductAdsPaymentEventList"] },
  {
    nombre: "Tarifas de FBA y de cuenta (transporte, retiros, almacenaje)",
    tipos: ["Tarifas de transacciones de Logística de Amazon", "Tarifa de inventario FBA", "Tarifas de Amazon", "FBA Inventory Fee", "FBA Customer Return Fee", "Amazon Fees"],
    listas: ["ServiceFeeEventList"],
  },
  { nombre: "Ajustes de tarifa", tipos: ["Ajuste de tarifa", "Fee Adjustment"], listas: [] },
  { nombre: "Transferencias (depósito del grupo anterior; no es movimiento del mes)", tipos: ["Trasferir", "Transfer"], listas: [] },
];

const TIPOS_TRANSFERENCIA = new Set(["Trasferir", "Transfer"]);
const TIPOS_CON_PEDIDO = new Set(EQUIVALENCIAS.slice(0, 4).flatMap((e) => e.tipos));
const esLanzado = (r: RenglonReporte) => !/diferid|deferred/i.test(r.estado);
const r2 = (x: number) => Math.round(x * 100) / 100;

export interface OrdenErp {
  amazon_order_id: string;
  eventos: number;
  monto: number;
  unidades?: number;
}
export interface SueltoErp {
  lista: string;
  descripcion: string | null;
  posted_en: string | null;
  monto: number | null;
  clasificado: boolean;
}
export interface GrupoErp {
  grupo_id: string;
  inicio: string | null;
  fin: string | null;
  estado: string | null;
  total_original: number | null;
  suma_eventos: number | null;
  completo: boolean;
  cuadra: boolean | null;
}

export interface InformeConciliacion {
  rango: { desde: string; hasta: string };
  renglones: number;
  diferidos: { renglones: number; total: number };
  transferencias: { liquidacion: string; monto: number }[];
  /** total del reporte (lanzado, sin transferencias) vs total del ERP en el rango */
  totales: { reporte: number; erp: number; diferencia: number };
  equivalencias: { nombre: string; renglones: number; reporte: number; eventos: number; erp: number; diferencia: number }[];
  /** tipos del reporte que no caen en ninguna equivalencia */
  tiposSinEquivalente: { tipo: string; renglones: number; total: number }[];
  /** listas del ERP que no caen en ninguna equivalencia */
  listasSinEquivalente: { lista: string; eventos: number; total: number }[];
  ordenes: {
    enReporte: number;
    enErp: number;
    cuadran: number;
    soloReporte: number;
    soloErp: number;
    distintas: number;
    sumaReporte: number;
    sumaErp: number;
    /** las diferencias más grandes (hasta 60) */
    ejemplos: { orden: string; reporte: number | null; erp: number | null; diferencia: number }[];
  };
  liquidaciones: { grupo: string; inicio: string | null; fin: string | null; estado: string | null; total: number | null; suma: number | null; completo: boolean; cuadra: boolean | null }[];
  avisos: string[];
}

/** Cruce puro: reporte contra lo que el ERP tiene en el mismo rango. */
export function conciliar(reporte: RenglonReporte[], ordenesErp: OrdenErp[], sueltosErp: SueltoErp[], grupos: GrupoErp[]): InformeConciliacion {
  const fechas = reporte.map((r) => r.fechaIso).filter((f): f is string => Boolean(f)).sort();
  const rango = { desde: fechas[0] ?? "", hasta: fechas[fechas.length - 1] ?? "" };
  const avisos: string[] = [];
  if (!fechas.length) avisos.push("El reporte no trae fechas legibles: el rango se dejó vacío.");

  const lanzados = reporte.filter(esLanzado);
  const diferidosFilas = reporte.filter((r) => !esLanzado(r));
  const transferencias = lanzados.filter((r) => TIPOS_TRANSFERENCIA.has(r.tipo)).map((r) => ({ liquidacion: r.liquidacion, monto: r2(r.total) }));
  const movimientos = lanzados.filter((r) => !TIPOS_TRANSFERENCIA.has(r.tipo));

  // Por tipo (reporte) y por lista (ERP)
  const porTipo = new Map<string, { renglones: number; total: number }>();
  for (const r of movimientos) {
    const t = porTipo.get(r.tipo) ?? { renglones: 0, total: 0 };
    t.renglones++;
    t.total += r.total;
    porTipo.set(r.tipo, t);
  }
  const porLista = new Map<string, { eventos: number; total: number }>();
  const sumarLista = (lista: string, monto: number) => {
    const l = porLista.get(lista) ?? { eventos: 0, total: 0 };
    l.eventos++;
    l.total += monto;
    porLista.set(lista, l);
  };
  for (const s of sueltosErp) sumarLista(s.lista, s.monto ?? 0);
  // Los eventos con pedido del ERP entran por orden; su lista se sabe por la equivalencia de pedidos.
  let erpOrdenesTotal = 0;
  for (const o of ordenesErp) erpOrdenesTotal += o.monto;

  const tiposUsados = new Set<string>();
  const listasUsadas = new Set<string>();
  const equivalencias = EQUIVALENCIAS.filter((e) => !e.tipos.some((t) => TIPOS_TRANSFERENCIA.has(t))).map((e) => {
    let renglones = 0;
    let rep = 0;
    for (const t of e.tipos) {
      const v = porTipo.get(t);
      if (v) {
        renglones += v.renglones;
        rep += v.total;
        tiposUsados.add(t);
      }
    }
    let eventos = 0;
    let erp = 0;
    for (const l of e.listas) {
      const v = porLista.get(l);
      if (v) {
        eventos += v.eventos;
        erp += v.total;
        listasUsadas.add(l);
      }
    }
    return { nombre: e.nombre, renglones, reporte: r2(rep), eventos, erp: r2(erp), diferencia: r2(rep - erp) };
  });
  // Las cuatro primeras equivalencias son de pedidos y del lado del ERP vienen por orden, no por lista.
  const conPedidoRep = equivalencias.slice(0, 4).reduce((s, e) => s + e.reporte, 0);
  const conPedido = { nombre: "Movimientos con pedido (ventas, reembolsos, contracargos, retroactivos)", renglones: equivalencias.slice(0, 4).reduce((s, e) => s + e.renglones, 0), reporte: r2(conPedidoRep), eventos: ordenesErp.reduce((s, o) => s + o.eventos, 0), erp: r2(erpOrdenesTotal), diferencia: r2(conPedidoRep - erpOrdenesTotal) };
  const equivalenciasSalida = [conPedido, ...equivalencias.slice(4)];

  const tiposSinEquivalente = [...porTipo.entries()].filter(([t]) => !tiposUsados.has(t)).map(([tipo, v]) => ({ tipo, renglones: v.renglones, total: r2(v.total) }));
  const listasSinEquivalente = [...porLista.entries()].filter(([l]) => !listasUsadas.has(l)).map(([lista, v]) => ({ lista, eventos: v.eventos, total: r2(v.total) }));

  // Orden por orden
  const repPorOrden = new Map<string, number>();
  for (const r of movimientos) {
    if (!r.orden || !TIPOS_CON_PEDIDO.has(r.tipo)) continue;
    repPorOrden.set(r.orden, (repPorOrden.get(r.orden) ?? 0) + r.total);
  }
  const erpPorOrden = new Map(ordenesErp.map((o) => [o.amazon_order_id, o.monto]));
  let cuadran = 0;
  let soloReporte = 0;
  let soloErp = 0;
  let distintas = 0;
  const diferencias: { orden: string; reporte: number | null; erp: number | null; diferencia: number }[] = [];
  for (const [orden, rep] of repPorOrden) {
    const erp = erpPorOrden.get(orden);
    if (erp == null) {
      soloReporte++;
      diferencias.push({ orden, reporte: r2(rep), erp: null, diferencia: r2(rep) });
    } else if (Math.abs(erp - rep) <= 0.005) cuadran++;
    else {
      distintas++;
      diferencias.push({ orden, reporte: r2(rep), erp: r2(erp), diferencia: r2(rep - erp) });
    }
  }
  for (const [orden, erp] of erpPorOrden) {
    if (!repPorOrden.has(orden)) {
      soloErp++;
      diferencias.push({ orden, reporte: null, erp: r2(erp), diferencia: r2(-erp) });
    }
  }
  diferencias.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));

  const totalReporte = r2(movimientos.reduce((s, r) => s + r.total, 0));
  const totalErp = r2(erpOrdenesTotal + sueltosErp.reduce((s, x) => s + (x.monto ?? 0), 0));

  const liquidaciones = grupos.map((g) => ({ grupo: g.grupo_id, inicio: g.inicio, fin: g.fin, estado: g.estado, total: g.total_original, suma: g.suma_eventos, completo: g.completo, cuadra: g.cuadra }));
  const incompletos = grupos.filter((g) => g.estado === "Closed" && !g.completo).length;
  const abiertos = grupos.filter((g) => g.estado !== "Closed").length;
  if (incompletos) avisos.push(`${incompletos} liquidación(es) del rango todavía a medio leer en el ERP: sus pedidos van a salir como «solo en el reporte» hasta que termine la ingesta.`);
  if (abiertos) avisos.push("El rango toca la liquidación en curso: Amazon sigue asentando eventos y el reporte y el ERP pueden diferir en los últimos días.");
  if (diferidosFilas.length) avisos.push(`${diferidosFilas.length} renglón(es) DIFERIDOS (sin liberar) por ${r2(diferidosFilas.reduce((s, r) => s + r.total, 0)).toLocaleString("es-MX", { style: "currency", currency: "MXN" })}: el reporte los trae, la liquidación de Amazon todavía no.`);
  if (sueltosErp.some((s) => !s.clasificado)) avisos.push("Hay eventos del ERP de un tipo que no sabe leer (sin monto): aparecen en «listas sin equivalente».");

  return {
    rango,
    renglones: reporte.length,
    diferidos: { renglones: diferidosFilas.length, total: r2(diferidosFilas.reduce((s, r) => s + r.total, 0)) },
    transferencias,
    totales: { reporte: totalReporte, erp: totalErp, diferencia: r2(totalReporte - totalErp) },
    equivalencias: equivalenciasSalida,
    tiposSinEquivalente,
    listasSinEquivalente,
    ordenes: {
      enReporte: repPorOrden.size,
      enErp: erpPorOrden.size,
      cuadran,
      soloReporte,
      soloErp,
      distintas,
      sumaReporte: r2([...repPorOrden.values()].reduce((s, v) => s + v, 0)),
      sumaErp: r2(erpOrdenesTotal),
      ejemplos: diferencias.slice(0, 60),
    },
    liquidaciones,
    avisos,
  };
}
