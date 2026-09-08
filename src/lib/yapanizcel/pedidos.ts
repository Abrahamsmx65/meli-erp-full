/**
 * Pedidos a China ya hechos o en camino.
 *
 * Se cargan de un Excel (una línea por SKU con cantidad y, si viene, costo)
 * o se capturan a mano. Un pedido pasa por creado → en camino → recibido.
 * Mientras no esté recibido cuenta como "en camino desde China" en la
 * pantalla de compras. Recibirlo NO crea existencias: el inventario lo
 * dice el sheet.
 */
import type { DB } from "../datos/repos";
import { leerHoja as leerCeldas } from "../importar/leer-hoja";
import { conCacheYz, recalcularCacheYz } from "./cache";
import { canonizar, claveCanonica, desglosar } from "./sku";
import { todo } from "./db";

export interface LineaPedido {
  skuBodega: string;
  diseno: string;
  modelo: string;
  color: string;
  cantidad: number;
  costoUnitario: number | null;
}

export interface PedidoLeido {
  folio: string | null;
  /** El diseño del pedido, si el archivo lo dice arriba ("款號 #499"). */
  diseno: string | null;
  fechaPedido: string | null;
  lineas: LineaPedido[];
  avisos: string[];
  unidades: number;
}

/**
 * Encabezados que se reconocen. El pedido real de la fábrica (fixture
 * `yz-pedido.xls`) viene bilingüe: "款號 #499" arriba (el diseño), "Model",
 * "Total" (la cantidad), "壳Case RMB" (el costo de la funda sola), "一套 Set"
 * (funda + caja: el costo que cuenta) y "Amount" (el importe, que no se lee).
 * Lo chino se canoniza fuera y quedan "CASE-RMB" y "SET".
 */
const ENC = {
  sku: ["SKU", "CLAVE", "CODIGO", "CODE", "ITEM", "ITEM NO", "MODEL NO", "REF"],
  diseno: ["DISENO", "DISEÑO", "DESIGN"],
  modelo: ["MODELO", "MODEL", "PHONE MODEL", "CELULAR"],
  color: ["COLOR", "COLOUR"],
  cantidad: ["CANTIDAD", "CANT", "QTY", "QUANTITY", "PCS", "PIEZAS", "PZAS", "UNIDADES", "TOTAL"],
  // Primero el costo del conjunto; el de la funda sola solo si no hay otro.
  costo: ["SET", "COSTO", "COSTO UNITARIO", "PRECIO", "UNIT PRICE", "PRICE", "USD", "COSTO USD", "PRECIO UNITARIO", "CASE RMB", "CASE"],
  folio: ["PEDIDO", "FOLIO", "ORDER", "ORDER NO", "ORDER NUMBER", "PO", "INVOICE", "INVOICE NO"],
};

/** "款號 #499", "#499", "DISEÑO 499", "Design: 499N" -> "499" / "499N". */
function disenoEnTexto(texto: string): string | null {
  const m = texto.match(/(?:#|款號|DISE[ÑN]O|DESIGN|MODELO)\s*#?\s*:?\s*(\d{2,}[A-Z]?)\b/i);
  return m ? m[1].toUpperCase() : null;
}

/** "Order number 訂單號 : 821", "PEDIDO: IN10151" -> "821" / "IN10151". */
function folioEnTexto(texto: string): string | null {
  const m = texto.match(/(?:ORDER\s*(?:NUMBER|NO\.?|#)?|PEDIDO|FOLIO|PO|INVOICE(?:\s*NO\.?)?)[^A-Z0-9]*([A-Z0-9][A-Z0-9\-\/]{1,})/i);
  return m ? m[1].toUpperCase() : null;
}

/** "Date : 20/7/2026" -> "2026-07-20". Día/mes/año, como escribe la fábrica. */
function fechaEnTexto(texto: string): string | null {
  const m = texto.match(/(?:DATE|FECHA)\s*:?\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/i);
  if (!m) return null;
  const [, d, mes, y] = m;
  return `${y}-${mes.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function es(celda: string, opciones: string[]): boolean {
  const c = canonizar(celda);
  return opciones.some((o) => c === canonizar(o));
}

function numero(s: string): number | null {
  const limpio = String(s ?? "").replace(/[$,\s]/g, "").replace(/^USD|MXN$/i, "");
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/** Lee el Excel del pedido por nombre de columna. */
export function leerPedidoDeCeldas(celdas: string[][]): PedidoLeido {
  let cols: Record<keyof typeof ENC, number> | null = null;
  let filaEnc = -1;
  let folio: string | null = null;
  let disenoArchivo: string | null = null;
  let fechaPedido: string | null = null;

  // Lo que va suelto en las celdas de arriba y a la derecha: diseño, folio
  // y fecha. Se busca en TODO el archivo porque la fábrica los pone al lado
  // de la tabla, no encima.
  for (const f of celdas) {
    const texto = f.filter(Boolean).join("  ");
    if (!texto) continue;
    disenoArchivo ??= disenoEnTexto(texto);
    folio ??= folioEnTexto(texto);
    fechaPedido ??= fechaEnTexto(texto);
  }

  for (let r = 0; r < Math.min(celdas.length, 25); r++) {
    const f = celdas[r] ?? [];
    const c = { sku: -1, diseno: -1, modelo: -1, color: -1, cantidad: -1, costo: -1, folio: -1 };
    f.forEach((celda, i) => {
      if (!celda) return;
      for (const k of Object.keys(ENC) as (keyof typeof ENC)[]) {
        if (c[k] >= 0 || !es(celda, ENC[k])) continue;
        // Para el costo gana el encabezado que aparece PRIMERO en la lista
        // (SET antes que CASE), no el que aparece primero en el archivo.
        if (k === "costo" && c.costo >= 0) continue;
        c[k] = i;
        return;
      }
    });
    // Si hay varias columnas de costo, prefiere la mejor de la lista.
    if (c.cantidad >= 0 && (c.sku >= 0 || c.modelo >= 0)) {
      let mejor = -1;
      let mejorPos = Infinity;
      f.forEach((celda, i) => {
        if (!celda) return;
        const pos = ENC.costo.findIndex((e) => es(celda, [e]));
        if (pos >= 0 && pos < mejorPos) {
          mejorPos = pos;
          mejor = i;
        }
      });
      c.costo = mejor;
      cols = c;
      filaEnc = r;
      break;
    }
  }

  if (!cols) {
    throw new Error("No se encontró el renglón de encabezados. Se esperan columnas como SKU (o MODELO / Model) y CANTIDAD (o Total / Qty).");
  }

  const lineas: LineaPedido[] = [];
  const avisos: string[] = [];
  const vistos = new Map<string, number>();

  for (let r = filaEnc + 1; r < celdas.length; r++) {
    const f = celdas[r] ?? [];
    const sku = cols.sku >= 0 ? (f[cols.sku] ?? "").trim() : "";
    const modelo = cols.modelo >= 0 ? (f[cols.modelo] ?? "").trim() : "";
    const color = cols.color >= 0 ? (f[cols.color] ?? "").trim() : "";
    const disenoCol = cols.diseno >= 0 ? (f[cols.diseno] ?? "").trim() : "";
    const cantTxt = f[cols.cantidad] ?? "";
    if (!sku && !modelo) continue;
    if (/^total/i.test(sku) || /^total/i.test(modelo) || /^total/i.test((f[0] ?? "").trim())) continue;

    const cantidad = numero(cantTxt);
    if (cantidad == null) {
      if (cantTxt.trim()) avisos.push(`Fila ${r + 1}: cantidad no numérica "${cantTxt}".`);
      continue;
    }
    if (cols.folio >= 0 && !folio && (f[cols.folio] ?? "").trim()) folio = (f[cols.folio] ?? "").trim().toUpperCase();

    // El modelo se pega sin espacios ni guiones ("I17 Pro Max" -> I17PROMAX),
    // que es como lo escriben en bodega y en MELI (499-i17promax).
    const modeloPegado = canonizar(modelo).replace(/-/g, "");
    const diseno = canonizar(disenoCol) || disenoArchivo || "";
    const skuBodega = sku
      ? claveCanonica(sku)
      : [diseno, modeloPegado, canonizar(color)].filter(Boolean).join("-");
    if (!skuBodega) continue;
    const d = desglosar(skuBodega);
    const costo = cols.costo >= 0 ? numero(f[cols.costo] ?? "") : null;

    const i = vistos.get(skuBodega);
    if (i != null) {
      lineas[i].cantidad += Math.round(cantidad);
      avisos.push(`Fila ${r + 1}: ${skuBodega} repetido; se sumó.`);
      continue;
    }
    vistos.set(skuBodega, lineas.length);
    lineas.push({
      skuBodega,
      diseno: diseno || d.diseno,
      modelo: modeloPegado || d.modelo,
      color: canonizar(color) || d.color,
      cantidad: Math.max(0, Math.round(cantidad)),
      costoUnitario: costo,
    });
  }

  if (!lineas.length) throw new Error("El archivo se leyó pero no traía ninguna línea con modelo y cantidad.");
  if (!disenoArchivo && lineas.some((l) => !l.diseno)) {
    avisos.push("El archivo no dice de qué diseño es (se esperaba algo como \"#499\" arriba): revisa los SKUs antes de confirmar.");
  }
  return { folio, diseno: disenoArchivo, fechaPedido, lineas, avisos, unidades: lineas.reduce((a, l) => a + l.cantidad, 0) };
}

export async function leerPedido(buffer: ArrayBuffer | Buffer, nombre?: string): Promise<PedidoLeido> {
  const celdas = await leerCeldas(buffer, { nombre });
  return leerPedidoDeCeldas(celdas);
}

export interface PedidoResumen {
  id: string;
  folio: string;
  proveedor: string | null;
  estado: string;
  fecha_pedido: string | null;
  fecha_estimada: string | null;
  nota: string | null;
  creado_en: string;
  unidades: number;
  recibidas: number;
  lineas: number;
  disenos: string[];
}

async function calcularListaPedidos(db: DB, accountId: string): Promise<PedidoResumen[]> {
  const { data: cab } = await db
    .from("yz_pedidos")
    .select("id, folio, proveedor, estado, fecha_pedido, fecha_estimada, nota, creado_en")
    .eq("account_id", accountId)
    .order("creado_en", { ascending: false })
    .limit(200);
  const ids = (cab ?? []).map((c) => c.id);
  const lineas = ids.length
    ? await todo<{ pedido_id: string; cantidad: number; recibido: number; diseno: string | null }>(db, "yz_pedido_lineas", "pedido_id, cantidad, recibido, diseno", (q) => q.in("pedido_id", ids))
    : [];

  const porPedido = new Map<string, { pedido_id: string; cantidad: number; recibido: number; diseno: string | null }[]>();
  for (const l of lineas) porPedido.set(l.pedido_id, [...(porPedido.get(l.pedido_id) ?? []), l]);

  return (cab ?? []).map((c) => {
    const suyas = porPedido.get(c.id) ?? [];
    return {
      ...c,
      unidades: suyas.reduce((a, l) => a + l.cantidad, 0),
      recibidas: suyas.reduce((a, l) => a + (l.recibido ?? 0), 0),
      lineas: suyas.length,
      disenos: [...new Set(suyas.map((l) => l.diseno).filter(Boolean) as string[])].sort(),
    };
  });
}

/**
 * La lista masticada desde `yz_cache` ("pedidos"), aunque esté vieja; la
 * invalidan las rutas que escriben pedidos y el cron la refresca.
 */
export async function listarPedidos(db: DB, accountId: string): Promise<PedidoResumen[]> {
  return conCacheYz(db, accountId, "pedidos", () => calcularListaPedidos(db, accountId));
}

/** Recalcula y guarda la lista (lo llama el cron de netos). */
export async function recalcularListaPedidos(db: DB, accountId: string): Promise<PedidoResumen[]> {
  return recalcularCacheYz(db, accountId, "pedidos", () => calcularListaPedidos(db, accountId));
}

export async function crearPedido(
  db: DB,
  accountId: string,
  pedido: { folio: string; proveedor?: string; fechaPedido?: string; fechaEstimada?: string; nota?: string; estado?: string },
  lineas: LineaPedido[],
): Promise<{ id: string }> {
  const folio = pedido.folio.trim().toUpperCase();
  if (!folio) throw new Error("El pedido necesita un folio.");
  const limpias = lineas.filter((l) => l.skuBodega && l.cantidad > 0);
  if (!limpias.length) throw new Error("El pedido no trae líneas con cantidad.");

  const { data: cab, error } = await db
    .from("yz_pedidos")
    .insert({
      account_id: accountId,
      folio,
      proveedor: pedido.proveedor?.trim() || null,
      estado: pedido.estado ?? "creado",
      fecha_pedido: pedido.fechaPedido || null,
      fecha_estimada: pedido.fechaEstimada || null,
      nota: pedido.nota?.trim() || null,
    })
    .select("id")
    .single();
  if (error || !cab) {
    if (error?.code === "23505") throw new Error(`Ya existe un pedido con el folio ${folio}.`);
    throw new Error(error?.message ?? "No se pudo crear el pedido.");
  }

  const { error: e2 } = await db.from("yz_pedido_lineas").insert(
    limpias.map((l) => ({
      pedido_id: cab.id,
      sku_bodega: l.skuBodega,
      diseno: l.diseno || null,
      modelo: l.modelo || null,
      color: l.color || null,
      cantidad: l.cantidad,
      costo_unitario: l.costoUnitario,
    })),
  );
  if (e2) throw new Error(e2.message);
  return { id: cab.id };
}

export async function cambiarEstadoPedido(db: DB, accountId: string, id: string, estado: "creado" | "en_camino" | "recibido" | "cancelado"): Promise<void> {
  const { error } = await db
    .from("yz_pedidos")
    .update({ estado, actualizado_en: new Date().toISOString() })
    .eq("account_id", accountId)
    .eq("id", id);
  if (error) throw new Error(error.message);
  // Recibido = todas las líneas recibidas completas.
  if (estado === "recibido") {
    const lineas = await todo<{ id: string; cantidad: number }>(db, "yz_pedido_lineas", "id, cantidad", (q) => q.eq("pedido_id", id));
    for (const l of lineas) await db.from("yz_pedido_lineas").update({ recibido: l.cantidad }).eq("id", l.id);
  }
}

export async function eliminarPedido(db: DB, accountId: string, id: string): Promise<void> {
  const { error } = await db.from("yz_pedidos").delete().eq("account_id", accountId).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function lineasDePedido(db: DB, id: string) {
  return todo<{ id: string; sku_bodega: string; diseno: string | null; modelo: string | null; color: string | null; cantidad: number; recibido: number; costo_unitario: number | null }>(
    db, "yz_pedido_lineas", "id, sku_bodega, diseno, modelo, color, cantidad, recibido, costo_unitario", (q) => q.eq("pedido_id", id).order("sku_bodega"),
  );
}
