/**
 * Productos NUEVOS en camino: lo que ya se le pidió a China y NUNCA ha
 * tenido stock en ningún lado.
 *
 * Son los que hay que preparar antes de que llegue el contenedor: la
 * publicación en MELI y en Amazon, y sobre todo las FOTOS. Muchas veces se
 * sube una sola foto para poder crear el listado, y con una no se vende:
 * aquí se marca cuando hay menos de `FOTOS_MINIMAS`.
 *
 * "Nunca tuvo stock" se decide por SKU contra todo lo que el ERP sabe: el
 * stock actual y las fotos diarias de Full, los movimientos de MELI, las
 * ventas diarias, y en Amazon el inventario FBA y sus ventas. La bodega NO
 * cuenta: un producto que acaba de llegar de China y ya está en cajas en
 * Industher sigue siendo nuevo mientras no haya subido a Full.
 *
 * El amarre SKU → producto (modelo + color) va por el SKU completo, no por
 * las columnas modelo/color de `skus`: un modelo con guion (GT104-1) se
 * parte mal ahí. Se quita el sufijo de sitio y la talla, y lo que queda se
 * compara aplastado: "GT104-1-BLK-25-MX" y "GT128-23-BLK" caen los dos en
 * su producto aunque Amazon ponga la talla antes del color.
 */
import { canonizar, claveAplastada, claveComparacion } from "../importar/sku";
import { traerTodo, type DB } from "../datos/repos";
import { cuentaAmazon } from "./amazon";

/** Con una sola foto no se vende: es la que se sube para crear el listado. */
export const FOTOS_MINIMAS = 2;

/** Un pedido recibido hace más de esto ya no es "en camino" para esta lista. */
const DIAS_RECIBIDO_VISIBLE = 120;

export interface PublicacionMeli {
  sku: string;
  itemId: string | null;
  variationId: string | null;
}

export interface ProductoNuevo {
  /** clave estable del producto: MODELO|COLORAPLASTADO */
  clave: string;
  modelo: string;
  color: string;
  pedidos: { pedido: string; estado: string; cajas: number; pares: number }[];
  cajas: number;
  pares: number;
  /** cajas ya en bodega (Industher); el producto sigue siendo nuevo */
  enBodega: number;
  meli: { publicaciones: PublicacionMeli[] };
  amazon: { skus: string[]; asins: string[] };
}

export interface ResumenProductosNuevos {
  productos: ProductoNuevo[];
  /** hubo cuenta de Amazon contra la cual mirar */
  amazonConectado: boolean;
}

/** MODELO|COLOR aplastado, sin talla ni sufijo de sitio. */
export function claveProducto(modelo: string, color: string): string {
  return `${canonizar(modelo)}|${claveAplastada(color || "")}`;
}

/**
 * Los pedazos del color, sin la anotación entre paréntesis de la proforma
 * ("BLK/BLK/BLK (NEGRO)") y con los repetidos seguidos colapsados. La
 * fábrica escribe el color por partes (corte/forro/suela: "BLK/BLK/RED") y
 * en MELI y Amazon el mismo producto quedó como "BLK / RED", "BLK-BLK" o
 * "BLK" según la época: colapsando repetidos, todos caen en el mismo lugar.
 */
function tokensLaxos(tokens: string[]): string[] {
  const salida: string[] = [];
  for (const t of tokens) {
    if (t && salida[salida.length - 1] !== t) salida.push(t);
  }
  return salida;
}

/** Como `claveProducto`, pero con el color laxo: segundo nivel de amarre. */
export function claveProductoLaxa(modelo: string, color: string): string {
  const sinNota = (color || "").replace(/\([^)]*\)/g, " ");
  const tokens = claveComparacion(sinNota).split("-").filter(Boolean);
  return `${canonizar(modelo)}|${tokensLaxos(tokens).join("")}`;
}

/**
 * De un SKU (de MELI, Amazon o bodega) a la clave de su producto: se quita
 * el sufijo de sitio, se quita el token de talla esté donde esté, y el resto
 * es modelo + color. Devuelve null si no tiene forma de SKU de calzado.
 */
export function claveProductoDeSku(sku: string): string | null {
  const tokens = claveComparacion(sku).split("-").filter(Boolean);
  if (tokens.length < 2) return null;
  const esTalla = (t: string) => {
    if (!/^\d{1,2}(\.\d)?$/.test(t)) return false;
    const n = Number(t);
    return n >= 14 && n <= 50;
  };
  // La talla nunca es el primer token (ese es el modelo).
  const sinTalla = tokens.filter((t, i) => i === 0 || !esTalla(t));
  if (sinTalla.length < 2) return null;
  return `${sinTalla[0]}|${sinTalla.slice(1).join("")}`;
}

/** Como `claveProductoDeSku`, con el color laxo (repetidos colapsados). */
export function claveProductoLaxaDeSku(sku: string): string | null {
  const estricta = claveProductoDeSku(sku);
  if (!estricta) return null;
  const tokens = claveComparacion(sku).split("-").filter(Boolean);
  const esTalla = (t: string) => /^\d{1,2}(\.\d)?$/.test(t) && Number(t) >= 14 && Number(t) <= 50;
  const color = tokens.filter((t, i) => i > 0 && !esTalla(t));
  return `${tokens[0]}|${tokensLaxos(color).join("")}`;
}

interface PedidoCrudo {
  id: string;
  pedido: string;
  estado: string;
  actualizado_en: string | null;
}

interface LineaCruda {
  pedido_id: string;
  modelo: string;
  color: string | null;
  cajas: number | null;
  pares: number | null;
}

/** Agrupa los renglones de los pedidos por producto. Puro, para probarse. */
export function agruparProductosDePedidos(
  pedidos: PedidoCrudo[],
  lineas: LineaCruda[],
): Map<string, ProductoNuevo> {
  const porId = new Map(pedidos.map((p) => [p.id, p]));
  const salida = new Map<string, ProductoNuevo>();

  for (const l of lineas) {
    const p = porId.get(l.pedido_id);
    if (!p) continue;
    const clave = claveProducto(l.modelo, l.color ?? "");
    const prod = salida.get(clave) ?? {
      clave,
      modelo: canonizar(l.modelo),
      color: (l.color ?? "").trim().toUpperCase(),
      pedidos: [],
      cajas: 0,
      pares: 0,
      enBodega: 0,
      meli: { publicaciones: [] },
      amazon: { skus: [], asins: [] },
    };
    const cajas = l.cajas ?? 0;
    const pares = l.pares ?? 0;
    const previo = prod.pedidos.find((x) => x.pedido === p.pedido);
    if (previo) {
      previo.cajas += cajas;
      previo.pares += pares;
    } else {
      prod.pedidos.push({ pedido: p.pedido, estado: p.estado, cajas, pares });
    }
    prod.cajas += cajas;
    prod.pares += pares;
    salida.set(clave, prod);
  }
  return salida;
}

/** Corre `fn` sobre los elementos con a lo más `paralelo` en vuelo. */
async function enParalelo<T>(items: T[], paralelo: number, fn: (x: T) => Promise<void>) {
  let cursor = 0;
  const trabajador = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(paralelo, items.length) }, trabajador));
}

/** ¿Alguna fila cumple? Una sola consulta con límite 1. */
async function existe(
  db: DB,
  tabla: string,
  filtros: (q: any) => any,
): Promise<boolean> {
  const { data, error } = await filtros(db.from(tabla).select("*")).limit(1);
  if (error) return false;
  return Boolean(data?.length);
}

function trozos<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function productosNuevos(db: DB, accountId: string): Promise<ResumenProductosNuevos> {
  const corte = new Date(Date.now() - DIAS_RECIBIDO_VISIBLE * 86_400_000).toISOString();

  const { data: pedidosRaw } = await db
    .from("pedidos")
    .select("id, pedido, estado, actualizado_en")
    .eq("account_id", accountId)
    .neq("estado", "cancelado");

  const pedidos = ((pedidosRaw ?? []) as PedidoCrudo[]).filter(
    (p) => p.estado !== "recibido" || !p.actualizado_en || p.actualizado_en >= corte,
  );
  if (!pedidos.length) return { productos: [], amazonConectado: false };

  const { data: lineasRaw } = await db
    .from("pedido_lineas")
    .select("pedido_id, modelo, color, cajas, pares")
    .in(
      "pedido_id",
      pedidos.map((p) => p.id),
    );

  const productos = agruparProductosDePedidos(pedidos, (lineasRaw ?? []) as LineaCruda[]);
  if (!productos.size) return { productos: [], amazonConectado: false };

  // Dos niveles de amarre SKU → producto: exacto y, si no hay, laxo (color
  // sin anotación y sin repetidos). Un SKU puede caer en varios productos
  // laxos; se le da a todos, que para esto son el mismo zapato.
  const porLaxa = new Map<string, ProductoNuevo[]>();
  for (const p of productos.values()) {
    const k = claveProductoLaxa(p.modelo, p.color);
    porLaxa.set(k, [...(porLaxa.get(k) ?? []), p]);
  }
  const productosDeSku = (sku: string): ProductoNuevo[] => {
    const estricta = claveProductoDeSku(sku);
    if (!estricta) return [];
    const exacto = productos.get(estricta);
    if (exacto) return [exacto];
    const laxa = claveProductoLaxaDeSku(sku);
    return laxa ? (porLaxa.get(laxa) ?? []) : [];
  };

  // --- Publicaciones de MELI, por producto --------------------------------
  const skus = await traerTodo<{
    sku: string;
    item_id: string | null;
    variation_id: string | null;
  }>(db, "skus", "sku, item_id, variation_id", (q) => q.eq("account_id", accountId));

  const skusPorProducto = new Map<string, string[]>();
  for (const s of skus) {
    for (const prod of productosDeSku(s.sku)) {
      prod.meli.publicaciones.push({
        sku: s.sku,
        itemId: s.item_id ?? null,
        variationId: s.variation_id == null ? null : String(s.variation_id),
      });
      skusPorProducto.set(prod.clave, [...(skusPorProducto.get(prod.clave) ?? []), s.sku]);
    }
  }

  // --- Publicaciones de Amazon, por producto ------------------------------
  let amazonConectado = false;
  try {
    const cuentaAmz = await cuentaAmazon(db);
    if (cuentaAmz) {
      amazonConectado = true;
      const listings = await traerTodo<{ seller_sku: string; asin: string | null }>(
        db,
        "amazon_listings",
        "seller_sku, asin",
        (q) => q.eq("account_id", cuentaAmz.id),
      ).catch(() => [] as { seller_sku: string; asin: string | null }[]);
      const vendidos = await traerTodo<{ seller_sku: string; asin: string | null }>(
        db,
        "amazon_skus",
        "seller_sku, asin",
        (q) => q.eq("account_id", cuentaAmz.id),
      ).catch(() => [] as { seller_sku: string; asin: string | null }[]);
      for (const f of [...listings, ...vendidos]) {
        for (const prod of productosDeSku(f.seller_sku)) {
          if (!prod.amazon.skus.includes(f.seller_sku)) prod.amazon.skus.push(f.seller_sku);
          if (f.asin && !prod.amazon.asins.includes(f.asin)) prod.amazon.asins.push(f.asin);
        }
      }
    }
  } catch {
    amazonConectado = false;
  }

  // --- ¿Alguna vez tuvo stock? --------------------------------------------
  // Primero lo barato y masivo: el stock actual de Full y de FBA de TODOS
  // los SKUs de los candidatos. Lo que ya tiene stock hoy sale de la lista
  // sin más preguntas; para el resto se pregunta historia, producto por
  // producto, con consultas de límite 1.
  const conStock = new Set<string>();

  const todosSkus = [...skusPorProducto.values()].flat();
  for (const grupo of trozos(todosSkus, 300)) {
    const { data } = await db
      .from("stock_full")
      .select("sku, total, disponible, en_transferencia")
      .eq("account_id", accountId)
      .in("sku", grupo);
    for (const s of data ?? []) {
      if ((s.total ?? 0) > 0 || (s.disponible ?? 0) > 0 || (s.en_transferencia ?? 0) > 0) {
        for (const prod of productosDeSku(s.sku)) conStock.add(prod.clave);
      }
    }
  }

  const todosAmz = [...productos.values()].flatMap((p) => p.amazon.skus);
  if (amazonConectado && todosAmz.length) {
    for (const grupo of trozos(todosAmz, 300)) {
      const { data } = await db
        .from("amazon_inventario")
        .select("seller_sku, total, disponible")
        .in("seller_sku", grupo);
      for (const s of data ?? []) {
        if ((s.total ?? 0) > 0 || (s.disponible ?? 0) > 0) {
          for (const prod of productosDeSku(s.seller_sku)) conStock.add(prod.clave);
        }
      }
    }
  }

  const candidatos = [...productos.values()].filter((p) => !conStock.has(p.clave));

  await enParalelo(candidatos, 6, async (p) => {
    const skusP = skusPorProducto.get(p.clave) ?? [];
    const porSku = (q: any) => q.eq("account_id", accountId).in("sku", skusP);
    if (skusP.length) {
      const [vendio, fotoConStock, movio] = await Promise.all([
        existe(db, "ventas_diarias", (q) => porSku(q).gt("unidades", 0)),
        existe(db, "stock_snapshots", (q) => porSku(q).gt("disponible", 0)),
        existe(db, "stock_operaciones", (q) => porSku(q).gt("resultado_disponible", 0)),
      ]);
      if (vendio || fotoConStock || movio) {
        conStock.add(p.clave);
        return;
      }
    }
    if (amazonConectado && p.amazon.skus.length) {
      const vendioAmz = await existe(db, "amazon_ventas_diarias", (q) =>
        q.in("seller_sku", p.amazon.skus).gt("unidades", 0),
      );
      if (vendioAmz) conStock.add(p.clave);
    }
  });

  const nuevos = [...productos.values()].filter((p) => !conStock.has(p.clave));

  // --- Cajas ya en bodega, para saber si "en camino" o "ya llegó" --------
  if (nuevos.length) {
    const existencias = await traerTodo<{ sku_caja: string; cajas_fisicas: number | null }>(
      db,
      "existencias",
      "sku_caja, cajas_fisicas",
      (q) => q.eq("account_id", accountId).gt("cajas_fisicas", 0),
    ).catch(() => [] as { sku_caja: string; cajas_fisicas: number | null }[]);
    const nuevosSet = new Set(nuevos.map((p) => p.clave));
    for (const e of existencias) {
      for (const prod of productosDeSku(e.sku_caja)) {
        if (nuevosSet.has(prod.clave)) prod.enBodega += e.cajas_fisicas ?? 0;
      }
    }
  }

  nuevos.sort((a, b) => a.modelo.localeCompare(b.modelo) || a.color.localeCompare(b.color));
  return { productos: nuevos, amazonConectado };
}
