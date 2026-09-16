/**
 * Pedidos de almacén de TikTok: armar, guardar, listar y el Excel.
 *
 * El motor es puro (`tiktok/pedidos-almacen.ts`); aquí se le dan sus tres
 * entradas —lo vendido en el periodo (`tiktok_ventas_diarias`), el kardex
 * de TikTok (`tiktok_inventario`) y la existencia por bodega de cajas (la
 * vista de inventario ya masticada, `inventario_cache`)— y se guarda el
 * resultado en `tiktok_pedidos_almacen` para que el siguiente pedido
 * arranque donde terminó este.
 */
import ExcelJS from "exceljs";
import { traerTodo, type DB } from "../datos/repos";
import { cargarInventario } from "./inventario";
import { fechaMx } from "./ventas-monitor";
import {
  armarPedidoAlmacen,
  DIAS_COBERTURA,
  ORDEN_BODEGAS,
  type ExistenciaBodega,
  type ModoPedido,
  type PedidoAlmacen,
} from "../tiktok/pedidos-almacen";

export interface ParametrosPedido {
  /** "YYYY-MM-DD", días de México, inclusive */
  desde: string;
  hasta: string;
  modo: ModoPedido;
  diasObjetivo?: number;
}

export interface PedidoAlmacenArmado extends PedidoAlmacen {
  desde: string;
  hasta: string;
  /** SKUs vendidos que la vista de inventario no conoce (sin existencia en ninguna bodega) */
  sinInventario: number;
}

export interface PedidoAlmacenGuardado extends PedidoAlmacenArmado {
  id: number;
  numero: number;
  creadoEn: string;
}

export interface ResumenPedidoGuardado {
  id: number;
  numero: number;
  creadoEn: string;
  desde: string;
  hasta: string;
  modo: ModoPedido;
  diasObjetivo: number | null;
  skus: number;
  pares: number;
}

function esFecha(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) + 1;
}

/** Los parámetros tal como llegan de la pantalla, saneados. */
export function normalizarParametros(p: {
  desde?: unknown;
  hasta?: unknown;
  modo?: unknown;
  diasObjetivo?: unknown;
}, desdeSugerido: string): ParametrosPedido {
  const hoy = fechaMx(0);
  let desde = esFecha(p.desde) ? p.desde : desdeSugerido;
  let hasta = esFecha(p.hasta) ? p.hasta : hoy;
  if (hasta > hoy) hasta = hoy;
  if (desde > hasta) desde = hasta;
  const modo: ModoPedido = p.modo === "cobertura" ? "cobertura" : "vendido";
  const n = Number(p.diasObjetivo);
  const diasObjetivo = Number.isFinite(n) && n > 0 ? Math.round(n) : DIAS_COBERTURA;
  return { desde, hasta, modo, diasObjetivo };
}

/**
 * Desde cuándo debería contar el siguiente pedido: el día después del
 * último pedido guardado; sin pedidos, la última semana.
 */
export async function desdeSugerido(db: DB, accountId: string): Promise<string> {
  const { data } = await db
    .from("tiktok_pedidos_almacen")
    .select("hasta")
    .eq("account_id", accountId)
    .order("hasta", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.hasta) {
    const siguiente = new Date(Date.parse(String(data.hasta)) + 86_400_000).toISOString().slice(0, 10);
    const hoy = fechaMx(0);
    return siguiente > hoy ? hoy : siguiente;
  }
  return fechaMx(6);
}

/** Arma el pedido con lo que hay en la base, sin guardar nada. */
export async function armarPedidoDeCuenta(
  db: DB,
  accountId: string,
  p: ParametrosPedido,
): Promise<PedidoAlmacenArmado> {
  const [ventas, kardex, inventario] = await Promise.all([
    traerTodo<any>(db, "tiktok_ventas_diarias", "sku, unidades", (q) =>
      q.eq("account_id", accountId).gte("fecha", p.desde).lte("fecha", p.hasta),
    ),
    traerTodo<any>(db, "tiktok_inventario", "sku, saldo, apartado", (q) => q.eq("account_id", accountId)),
    cargarInventario(db, accountId, { sinCrudos: true }),
  ]);

  // La existencia por bodega sale de las cajas de cada pedido: un renglón
  // por (SKU, bodega). Lo que viene de China lo descarta el motor.
  const existencias: ExistenciaBodega[] = [];
  const conInventario = new Set<string>();
  for (const r of inventario.renglones) {
    conInventario.add(r.sku);
    for (const x of r.pedidos ?? []) {
      existencias.push({ sku: r.sku, almacen: x.almacen, pares: x.pares });
    }
  }

  const pedido = armarPedidoAlmacen({
    ventas: (ventas ?? []).map((v: any) => ({ sku: String(v.sku), unidades: Number(v.unidades ?? 0) })),
    existencias,
    kardex: (kardex ?? []).map((k: any) => ({ sku: String(k.sku), saldo: Number(k.saldo ?? 0), apartado: Number(k.apartado ?? 0) })),
    dias: diasEntre(p.desde, p.hasta),
    modo: p.modo,
    diasObjetivo: p.diasObjetivo,
  });

  return {
    ...pedido,
    desde: p.desde,
    hasta: p.hasta,
    sinInventario: pedido.renglones.filter((r) => !conInventario.has(r.sku)).length,
  };
}

/** Arma y guarda el pedido con el siguiente número de la cuenta. */
export async function guardarPedidoAlmacen(
  admin: any,
  accountId: string,
  p: ParametrosPedido,
  creadoPor?: string | null,
): Promise<PedidoAlmacenGuardado> {
  const armado = await armarPedidoDeCuenta(admin, accountId, p);
  if (!armado.renglones.length) throw new Error("No hay ventas en ese periodo: no hay nada que pedir.");

  const { data: ultimo } = await admin
    .from("tiktok_pedidos_almacen")
    .select("numero")
    .eq("account_id", accountId)
    .order("numero", { ascending: false })
    .limit(1)
    .maybeSingle();
  const numero = (ultimo?.numero ?? 0) + 1;

  const { data, error } = await admin
    .from("tiktok_pedidos_almacen")
    .insert({
      account_id: accountId,
      numero,
      creado_por: creadoPor ?? null,
      desde: armado.desde,
      hasta: armado.hasta,
      modo: armado.modo,
      dias_objetivo: armado.diasObjetivo,
      datos: armado,
      skus: armado.totales.skus,
      pares: armado.totales.pedir,
    })
    .select("id, numero, creado_en")
    .single();
  if (error || !data) throw new Error(`No se pudo guardar el pedido: ${error?.message ?? "sin id"}`);
  return { ...armado, id: data.id, numero: data.numero, creadoEn: data.creado_en };
}

export async function listarPedidosAlmacen(db: DB, accountId: string): Promise<ResumenPedidoGuardado[]> {
  const { data, error } = await db
    .from("tiktok_pedidos_almacen")
    .select("id, numero, creado_en, desde, hasta, modo, dias_objetivo, skus, pares")
    .eq("account_id", accountId)
    .order("numero", { ascending: false })
    .limit(30);
  if (error) throw new Error(`No se pudieron leer los pedidos de almacén: ${error.message}`);
  return (data ?? []).map((f: any) => ({
    id: f.id,
    numero: f.numero,
    creadoEn: f.creado_en,
    desde: String(f.desde),
    hasta: String(f.hasta),
    modo: f.modo === "cobertura" ? "cobertura" : "vendido",
    diasObjetivo: f.dias_objetivo ?? null,
    skus: f.skus ?? 0,
    pares: f.pares ?? 0,
  }));
}

export async function cargarPedidoAlmacen(db: DB, accountId: string, id: number): Promise<PedidoAlmacenGuardado> {
  const { data, error } = await db
    .from("tiktok_pedidos_almacen")
    .select("id, numero, creado_en, datos")
    .eq("account_id", accountId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el pedido: ${error.message}`);
  if (!data) throw new Error("Ese pedido no existe.");
  return { ...(data.datos as PedidoAlmacenArmado), id: data.id, numero: data.numero, creadoEn: data.creado_en };
}

const NOMBRE_MODO: Record<ModoPedido, string> = {
  vendido: "reponer lo vendido",
  cobertura: "cobertura a N días",
};

/**
 * El Excel del pedido: la hoja completa por SKU (ventas, kardex, qué pedir
 * y de dónde), una hoja POR BODEGA con solo lo que se le pide a esa bodega
 * (es la que se le manda a Industher o a EnvioPack), y el resumen por
 * modelo. Números como números, para filtrar y sumar.
 */
export async function excelDePedidoAlmacen(p: PedidoAlmacenGuardado): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERP";
  wb.created = new Date(p.creadoEn);

  const encabezado = (hoja: ExcelJS.Worksheet, columnas: { header: string; key: string; width?: number }[]) => {
    hoja.columns = columnas.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 14 }));
    hoja.getRow(1).font = { bold: true };
    hoja.views = [{ state: "frozen", ySplit: 1 }];
    hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };
  };

  const titulo = `Pedido de almacén TikTok #${p.numero} · ${p.desde} a ${p.hasta} (${p.dias} días) · ${NOMBRE_MODO[p.modo]}${p.modo === "cobertura" && p.diasObjetivo ? ` (${p.diasObjetivo} días)` : ""}`;

  // --- Pedido completo -----------------------------------------------------
  const completo = wb.addWorksheet("Pedido");
  encabezado(completo, [
    { header: "SKU", key: "sku", width: 26 },
    { header: "Modelo", key: "modelo", width: 10 },
    { header: "Color", key: "color", width: 14 },
    { header: "Talla", key: "talla", width: 7 },
    { header: "Vendidos", key: "vendidos", width: 10 },
    { header: "Venta diaria", key: "ventaDiaria", width: 12 },
    { header: "Saldo TikTok", key: "saldo", width: 12 },
    { header: "Apartado", key: "apartado", width: 10 },
    { header: "Disponible", key: "disponible", width: 11 },
    { header: "Días de cobertura", key: "diasCobertura", width: 16 },
    { header: "PEDIR", key: "pedir", width: 9 },
    ...ORDEN_BODEGAS.map((b) => ({ header: `Hay en ${b}`, key: `hay_${b}`, width: 14 })),
    ...ORDEN_BODEGAS.map((b) => ({ header: `Pedir a ${b}`, key: `pedir_${b}`, width: 15 })),
    { header: "Faltante", key: "faltante", width: 10 },
  ]);
  for (const r of p.renglones) {
    const fila: Record<string, unknown> = {
      sku: r.sku,
      modelo: r.modelo,
      color: r.color,
      talla: r.talla,
      vendidos: r.vendidos,
      ventaDiaria: Math.round(r.ventaDiaria * 100) / 100,
      saldo: r.saldo,
      apartado: r.apartado,
      disponible: r.disponible,
      diasCobertura: r.diasCobertura == null ? null : Math.round(r.diasCobertura * 10) / 10,
      pedir: r.pedir,
      faltante: r.faltante,
    };
    for (const b of ORDEN_BODEGAS) {
      fila[`hay_${b}`] = r.existencia.find((e) => e.almacen === b)?.pares ?? 0;
      fila[`pedir_${b}`] = r.surtir.find((s) => s.almacen === b)?.pares ?? 0;
    }
    completo.addRow(fila);
  }
  completo.getColumn("pedir").font = { bold: true };

  // --- Una hoja por bodega: lo que se le pide a ESA bodega ------------------
  for (const b of ORDEN_BODEGAS) {
    const renglones = p.renglones.filter((r) => (r.surtir.find((s) => s.almacen === b)?.pares ?? 0) > 0);
    if (!renglones.length) continue;
    const hoja = wb.addWorksheet(`Pedir a ${b}`);
    encabezado(hoja, [
      { header: "SKU", key: "sku", width: 26 },
      { header: "Modelo", key: "modelo", width: 10 },
      { header: "Color", key: "color", width: 14 },
      { header: "Talla", key: "talla", width: 7 },
      { header: "Pares", key: "pares", width: 9 },
      { header: `Hay en ${b}`, key: "hay", width: 14 },
    ]);
    let total = 0;
    for (const r of renglones) {
      const pares = r.surtir.find((s) => s.almacen === b)?.pares ?? 0;
      total += pares;
      hoja.addRow({
        sku: r.sku,
        modelo: r.modelo,
        color: r.color,
        talla: r.talla,
        pares,
        hay: r.existencia.find((e) => e.almacen === b)?.pares ?? 0,
      });
    }
    const fin = hoja.addRow({ sku: "TOTAL", pares: total });
    fin.font = { bold: true };
  }

  // --- Faltantes: lo que ninguna bodega alcanza -----------------------------
  const faltantes = p.renglones.filter((r) => r.faltante > 0);
  if (faltantes.length) {
    const hoja = wb.addWorksheet("Faltantes");
    encabezado(hoja, [
      { header: "SKU", key: "sku", width: 26 },
      { header: "Vendidos", key: "vendidos", width: 10 },
      { header: "PEDIR", key: "pedir", width: 9 },
      { header: "Sin bodega que lo cubra", key: "faltante", width: 22 },
    ]);
    for (const r of faltantes) hoja.addRow({ sku: r.sku, vendidos: r.vendidos, pedir: r.pedir, faltante: r.faltante });
  }

  // --- Por modelo ------------------------------------------------------------
  const modelos = wb.addWorksheet("Por modelo");
  encabezado(modelos, [
    { header: "Modelo", key: "modelo", width: 12 },
    { header: "SKUs", key: "skus", width: 8 },
    { header: "Vendidos", key: "vendidos", width: 10 },
    { header: "Pedir", key: "pedir", width: 9 },
    { header: "Faltante", key: "faltante", width: 10 },
  ]);
  for (const m of p.porModelo) modelos.addRow(m);

  // --- Resumen ---------------------------------------------------------------
  const resumen = wb.addWorksheet("Resumen");
  resumen.columns = [
    { header: "Concepto", key: "concepto", width: 40 },
    { header: "Valor", key: "valor", width: 16 },
  ];
  resumen.getRow(1).font = { bold: true };
  resumen.addRow({ concepto: titulo, valor: null });
  resumen.addRow({ concepto: "SKUs con venta", valor: p.totales.skus });
  resumen.addRow({ concepto: "Pares vendidos", valor: p.totales.vendidos });
  resumen.addRow({ concepto: "Pares a pedir", valor: p.totales.pedir });
  for (const b of p.totales.porBodega) resumen.addRow({ concepto: `Pedir a ${b.almacen}`, valor: b.pares });
  resumen.addRow({ concepto: "Sin bodega que lo cubra", valor: p.totales.faltante });
  if (p.sinInventario) resumen.addRow({ concepto: "SKUs sin existencia en ninguna bodega", valor: p.sinInventario });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
