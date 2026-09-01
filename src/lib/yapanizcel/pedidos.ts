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
  lineas: LineaPedido[];
  avisos: string[];
  unidades: number;
}

const ENC = {
  sku: ["SKU", "CLAVE", "CODIGO", "CODE", "ITEM", "ITEM NO", "MODEL NO", "REF"],
  diseno: ["DISENO", "DISEÑO", "DESIGN"],
  modelo: ["MODELO", "MODEL", "PHONE MODEL", "CELULAR"],
  color: ["COLOR", "COLOUR"],
  cantidad: ["CANTIDAD", "CANT", "QTY", "QUANTITY", "PCS", "PIEZAS", "PZAS", "UNIDADES"],
  costo: ["COSTO", "COSTO UNITARIO", "PRECIO", "UNIT PRICE", "PRICE", "USD", "COSTO USD", "PRECIO UNITARIO"],
  folio: ["PEDIDO", "FOLIO", "ORDER", "ORDER NO", "PO", "INVOICE", "INVOICE NO"],
};

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

  for (let r = 0; r < Math.min(celdas.length, 25); r++) {
    const f = celdas[r] ?? [];
    const c = { sku: -1, diseno: -1, modelo: -1, color: -1, cantidad: -1, costo: -1, folio: -1 };
    f.forEach((celda, i) => {
      if (!celda) return;
      for (const k of Object.keys(ENC) as (keyof typeof ENC)[]) {
        if (c[k] < 0 && es(celda, ENC[k])) {
          c[k] = i;
          return;
        }
      }
    });
    if (c.cantidad >= 0 && (c.sku >= 0 || c.modelo >= 0)) {
      cols = c;
      filaEnc = r;
      break;
    }
    // "PEDIDO: IN10151" o "Folio IN10151" en algún renglón de arriba.
    const texto = f.join(" ");
    const m = texto.match(/(?:PEDIDO|FOLIO|ORDER|PO|INVOICE)\s*(?:NO\.?|#|:)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i);
    if (m && !folio) folio = m[1].toUpperCase();
  }

  if (!cols) {
    throw new Error("No se encontró el renglón de encabezados. Se esperan columnas como SKU (o MODELO) y CANTIDAD.");
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
    if (/^total/i.test(sku) || /^total/i.test(modelo)) continue;

    const cantidad = numero(cantTxt);
    if (cantidad == null) {
      if (cantTxt.trim()) avisos.push(`Fila ${r + 1}: cantidad no numérica "${cantTxt}".`);
      continue;
    }
    if (cols.folio >= 0 && !folio && (f[cols.folio] ?? "").trim()) folio = (f[cols.folio] ?? "").trim().toUpperCase();

    const skuBodega = sku ? claveCanonica(sku) : [canonizar(disenoCol), canonizar(modelo), canonizar(color)].filter(Boolean).join("-");
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
      diseno: canonizar(disenoCol) || d.diseno,
      modelo: canonizar(modelo) || d.modelo,
      color: canonizar(color) || d.color,
      cantidad: Math.max(0, Math.round(cantidad)),
      costoUnitario: costo,
    });
  }

  if (!lineas.length) throw new Error("El archivo se leyó pero no traía ninguna línea con SKU y cantidad.");
  return { folio, lineas, avisos, unidades: lineas.reduce((a, l) => a + l.cantidad, 0) };
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

export async function listarPedidos(db: DB, accountId: string): Promise<PedidoResumen[]> {
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

  return (cab ?? []).map((c) => {
    const suyas = lineas.filter((l) => l.pedido_id === c.id);
    return {
      ...c,
      unidades: suyas.reduce((a, l) => a + l.cantidad, 0),
      recibidas: suyas.reduce((a, l) => a + (l.recibido ?? 0), 0),
      lineas: suyas.length,
      disenos: [...new Set(suyas.map((l) => l.diseno).filter(Boolean) as string[])].sort(),
    };
  });
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
