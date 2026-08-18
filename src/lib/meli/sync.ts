/**
 * ETL: baja de Mercado Libre todo lo que el motor necesita.
 *
 *   catálogo  -> qué SKUs existen y cuál es su inventory_id en Full
 *   stock     -> qué hay disponible y qué viene en camino AHORA
 *   ventas    -> unidades por SKU y por día de los últimos N días
 *   movimientos -> el historial que permite saber qué días estuvo agotado
 */
import { MeliClient, enLotes, trozos } from "./client";
import type { OperacionStock, StockFull, VentaDiaria } from "../engine/types";

// ---------------------------------------------------------------------------
// Tipos crudos (solo lo que usamos de cada respuesta)
// ---------------------------------------------------------------------------
interface AtributoMeli {
  id?: string;
  value_name?: string | null;
}

interface VariacionMeli {
  id?: number | string;
  inventory_id?: string | null;
  seller_custom_field?: string | null;
  attributes?: AtributoMeli[];
  available_quantity?: number;
  price?: number;
}

interface ItemMeli {
  id: string;
  title?: string;
  status?: string;
  price?: number;
  inventory_id?: string | null;
  seller_custom_field?: string | null;
  attributes?: AtributoMeli[];
  variations?: VariacionMeli[];
  shipping?: { logistic_type?: string };
}

export interface FilaSku {
  sku: string;
  itemId: string;
  variationId: string | null;
  inventoryId: string | null;
  titulo: string;
  logistica: string | null;
  estado: string | null;
  precio: number | null;
}

export interface UsuarioMeli {
  id: number;
  nickname: string;
  siteId: string;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** El SKU del vendedor puede venir en dos lugares según la antigüedad de la publicación. */
function extraerSku(
  fuente: { seller_custom_field?: string | null; attributes?: AtributoMeli[] } | undefined,
): string | null {
  if (!fuente) return null;
  const attr = fuente.attributes?.find((a) => a.id === "SELLER_SKU");
  const v = attr?.value_name?.trim();
  if (v) return v;
  const scf = fuente.seller_custom_field?.trim();
  return scf || null;
}

/**
 * MELI regresa las fechas ya en la zona del sitio (con offset explícito),
 * así que los primeros 10 caracteres son el día local del vendedor.
 */
function diaLocal(iso: string): string {
  return iso.slice(0, 10);
}

// ---------------------------------------------------------------------------
// 1. Usuario
// ---------------------------------------------------------------------------
export async function obtenerUsuario(c: MeliClient): Promise<UsuarioMeli> {
  const u = await c.get<{ id: number; nickname: string; site_id: string }>("/users/me");
  return { id: u.id, nickname: u.nickname, siteId: u.site_id };
}

// ---------------------------------------------------------------------------
// 2. Catálogo
// ---------------------------------------------------------------------------

/**
 * Estados de publicación que hay que recorrer.
 *
 * El scan sin filtro no devuelve todo: se queda corto justo con las
 * publicaciones pausadas y cerradas, que son las de los productos agotados
 * en Full — o sea, precisamente las que urge reponer. Se recorre estado por
 * estado y se unen los resultados.
 */
const ESTADOS_PUBLICACION = ["active", "paused", "closed", "under_review"];

/** Recorre TODAS las publicaciones del vendedor, en todos sus estados. */
export async function listarIdsDeItems(c: MeliClient, userId: number): Promise<string[]> {
  const ids = new Set<string>();

  for (const status of ESTADOS_PUBLICACION) {
    let scrollId: string | undefined;

    for (let vuelta = 0; vuelta < 500; vuelta++) {
      let r: { results?: string[]; scroll_id?: string };
      try {
        r = await c.get<{ results: string[]; scroll_id?: string }>(
          `/users/${userId}/items/search`,
          { search_type: "scan", limit: 100, status, scroll_id: scrollId },
        );
      } catch {
        // Un estado que el sitio no soporte no debe tumbar el recorrido.
        break;
      }
      if (!r.results?.length) break;
      for (const id of r.results) ids.add(id);
      scrollId = r.scroll_id;
      if (!scrollId) break;
    }
  }

  return [...ids];
}

const CAMPOS_ITEM = [
  "id", "title", "status", "price", "inventory_id",
  "seller_custom_field", "attributes", "variations", "shipping",
].join(",");

/** Descarga cruda de publicaciones por id, sin interpretar nada. */
export async function traerItems(
  c: MeliClient,
  ids: string[],
): Promise<{ items: Map<string, ItemMeli>; lotesFallidos: number }> {
  const items = new Map<string, ItemMeli>();
  let lotesFallidos = 0;
  if (!ids.length) return { items, lotesFallidos };

  const grupos = trozos(ids, 20);   // /items?ids= acepta 20 por llamada

  const respuestas = await enLotes(grupos, 5, async (grupo) => {
    try {
      return await c.get<{ code: number; body: ItemMeli }[]>("/items", {
        ids: grupo.join(","),
        attributes: CAMPOS_ITEM,
      });
    } catch {
      // Un lote que truena no tumba el catálogo entero, pero sí se cuenta.
      lotesFallidos++;
      return [] as { code: number; body: ItemMeli }[];
    }
  });

  for (const lote of respuestas) {
    for (const envoltura of lote ?? []) {
      if (envoltura?.code === 200 && envoltura.body?.id) {
        items.set(envoltura.body.id, envoltura.body);
      }
    }
  }

  return { items, lotesFallidos };
}

/** Trae el detalle de un conjunto de publicaciones y lo aplana a un renglón por SKU. */
export async function detallarItems(
  c: MeliClient,
  ids: string[],
  opts?: { soloFulfillment?: boolean },
): Promise<FilaSku[]> {
  if (!ids.length) return [];

  const { items } = await traerItems(c, ids);
  const respuestas = [[...items.values()].map((body) => ({ code: 200, body }))];

  const filas: FilaSku[] = [];

  for (const lote of respuestas) {
    for (const envoltura of lote ?? []) {
      if (envoltura?.code !== 200 || !envoltura.body) continue;
      const item = envoltura.body;
      const logistica = item.shipping?.logistic_type ?? null;

      if (opts?.soloFulfillment && logistica !== "fulfillment") continue;

      if (item.variations?.length) {
        for (const v of item.variations) {
          const sku = extraerSku(v) ?? extraerSku(item);
          if (!sku) continue;
          filas.push({
            sku,
            itemId: item.id,
            variationId: v.id != null ? String(v.id) : null,
            inventoryId: v.inventory_id ?? null,
            titulo: item.title ?? "",
            logistica,
            estado: item.status ?? null,
            precio: v.price ?? item.price ?? null,
          });
        }
      } else {
        const sku = extraerSku(item);
        if (!sku) continue;
        filas.push({
          sku,
          itemId: item.id,
          variationId: null,
          inventoryId: item.inventory_id ?? null,
          titulo: item.title ?? "",
          logistica,
          estado: item.status ?? null,
          precio: item.price ?? null,
        });
      }
    }
  }

  return filas;
}

/**
 * Un mismo SKU puede estar en varias publicaciones. Se conserva la que sí
 * tiene inventory_id de Full y está activa.
 */
export function dedupePorSku(filas: FilaSku[]): FilaSku[] {
  const porSku = new Map<string, FilaSku>();
  for (const f of filas) {
    const previa = porSku.get(f.sku);
    if (!previa) {
      porSku.set(f.sku, f);
      continue;
    }
    const puntaje = (x: FilaSku) =>
      (x.inventoryId ? 4 : 0) +
      (x.logistica === "fulfillment" ? 2 : 0) +
      (x.estado === "active" ? 1 : 0);
    if (puntaje(f) > puntaje(previa)) porSku.set(f.sku, f);
  }
  return [...porSku.values()];
}

export async function obtenerCatalogo(
  c: MeliClient,
  userId: number,
  opts?: { soloFulfillment?: boolean },
): Promise<FilaSku[]> {
  const ids = await listarIdsDeItems(c, userId);
  return dedupePorSku(await detallarItems(c, ids, opts));
}

// ---------------------------------------------------------------------------
// 3. Stock en Full
// ---------------------------------------------------------------------------
interface RespuestaStock {
  inventory_id?: string;
  total?: number;
  available_quantity?: number;
  not_available_quantity?: number;
  not_available_detail?: { status?: string; quantity?: number }[];
}

/**
 * Estados de `not_available_detail` que significan "viene en camino".
 * Ese inventario ya es tuyo y hay que contarlo: si no, el sistema te haría
 * mandar de nuevo algo que ya va en la carretera.
 */
const ESTADOS_EN_TRANSITO = ["transfer", "inbound", "in_transit", "receiving", "pending"];

function esEnTransito(estado?: string): boolean {
  if (!estado) return false;
  const e = estado.toLowerCase();
  return ESTADOS_EN_TRANSITO.some((t) => e.includes(t));
}

export async function obtenerStockFull(
  c: MeliClient,
  sellerId: number,
  skus: { sku: string; inventoryId: string | null }[],
): Promise<{ stock: StockFull[]; errores: string[] }> {
  const conInventario = skus.filter((s) => s.inventoryId);
  const errores: string[] = [];

  const resultados = await enLotes(conInventario, 5, async (s) => {
    try {
      const r = await c.get<RespuestaStock>(
        `/inventories/${s.inventoryId}/stock/fulfillment`,
        { seller_id: sellerId },
      );

      let enTransferencia = 0;
      let noDisponible = 0;
      for (const d of r.not_available_detail ?? []) {
        const q = d.quantity ?? 0;
        if (esEnTransito(d.status)) enTransferencia += q;
        else noDisponible += q;
      }

      const fila: StockFull = {
        sku: s.sku,
        disponible: r.available_quantity ?? 0,
        enTransferencia,
        noDisponible,
        total: r.total ?? (r.available_quantity ?? 0) + (r.not_available_quantity ?? 0),
      };
      return fila;
    } catch (err) {
      errores.push(`${s.sku}: ${(err as Error).message}`);
      return null;
    }
  });

  return {
    stock: resultados.filter((x): x is StockFull => x !== null),
    errores,
  };
}

// ---------------------------------------------------------------------------
// 4. Ventas
// ---------------------------------------------------------------------------
interface OrdenMeli {
  id: number;
  status?: string;
  date_created: string;
  order_items?: {
    quantity?: number;
    unit_price?: number;
    item?: {
      id?: string;
      seller_sku?: string | null;
      seller_custom_field?: string | null;
      variation_id?: number | string | null;
    };
  }[];
}

/**
 * Baja las órdenes pagadas del periodo y las agrega a unidades por SKU y día.
 *
 * Se recorre en ventanas de 7 días porque `offset` topa en 10 000: con un
 * catálogo grande una sola ventana de 90 días se queda corta y perderías
 * ventas sin darte cuenta.
 */
export async function obtenerVentas(
  c: MeliClient,
  sellerId: number,
  desde: string,
  hasta: string,
  mapaItemSku?: Map<string, string>,
): Promise<{
  ventas: VentaDiaria[];
  ordenesLeidas: number;
  sinSku: number;
  /**
   * SKU -> id de publicación, sacado de las órdenes.
   *
   * Es la red de seguridad del catálogo: si el recorrido de publicaciones se
   * saltó una, la orden sí trae su id y con eso se puede recuperar. Vender
   * es prueba irrefutable de que la publicación existe.
   */
  itemsPorSku: Map<string, RefOrden>;
}> {
  const acumulado = new Map<string, VentaDiaria>();
  const itemsPorSku = new Map<string, RefOrden>();
  let ordenesLeidas = 0;
  let sinSku = 0;
  const vistas = new Set<number>();

  const ventanas: [string, string][] = [];
  let cursor = new Date(`${desde}T00:00:00.000Z`);
  const fin = new Date(`${hasta}T23:59:59.999Z`);
  while (cursor < fin) {
    const sig = new Date(cursor);
    sig.setUTCDate(sig.getUTCDate() + 7);
    ventanas.push([cursor.toISOString(), new Date(Math.min(+sig, +fin)).toISOString()]);
    cursor = sig;
  }

  for (const [ini, fin2] of ventanas) {
    let offset = 0;
    for (let pagina = 0; pagina < 200; pagina++) {
      const r = await c.get<{ results: OrdenMeli[]; paging?: { total?: number } }>(
        "/orders/search",
        {
          seller: sellerId,
          "order.date_created.from": ini,
          "order.date_created.to": fin2,
          "order.status": "paid",
          sort: "date_asc",
          limit: 51,
          offset,
        },
      );

      const lote = r.results ?? [];
      if (!lote.length) break;

      for (const o of lote) {
        if (vistas.has(o.id)) continue;
        vistas.add(o.id);
        if (o.status && o.status !== "paid") continue;
        ordenesLeidas++;

        const fecha = diaLocal(o.date_created);

        for (const oi of o.order_items ?? []) {
          const sku =
            oi.item?.seller_sku?.trim() ||
            oi.item?.seller_custom_field?.trim() ||
            (oi.item?.id ? mapaItemSku?.get(claveItem(oi.item.id, oi.item.variation_id)) : undefined) ||
            (oi.item?.id ? mapaItemSku?.get(oi.item.id) : undefined);

          if (!sku) {
            sinSku++;
            continue;
          }

          if (oi.item?.id && !itemsPorSku.has(sku)) {
            itemsPorSku.set(sku, {
              sku,
              itemId: oi.item.id,
              variationId: oi.item.variation_id != null ? String(oi.item.variation_id) : null,
            });
          }

          const clave = `${sku}|${fecha}`;
          const prev = acumulado.get(clave);
          const unidades = oi.quantity ?? 0;
          const importe = unidades * (oi.unit_price ?? 0);

          if (prev) {
            prev.unidades += unidades;
            prev.ordenes = (prev.ordenes ?? 0) + 1;
            prev.importe = (prev.importe ?? 0) + importe;
          } else {
            acumulado.set(clave, { sku, fecha, unidades, ordenes: 1, importe });
          }
        }
      }

      offset += lote.length;
      if (lote.length < 51 || offset >= 9_950) break;
    }
  }

  return { ventas: [...acumulado.values()], ordenesLeidas, sinSku, itemsPorSku };
}

/** Lo que una orden nos dice de una publicación. */
export interface RefOrden {
  sku: string;
  itemId: string;
  variationId: string | null;
}

export interface ResultadoRecuperacion {
  filas: FilaSku[];
  intentados: number;
  recuperados: number;
  sinPublicacion: number;
  lotesFallidos: number;
}

/**
 * Reconstruye del catálogo lo que el recorrido de publicaciones se saltó.
 *
 * La diferencia con `detallarItems` es de dónde sale el SKU: aquí NO se
 * intenta deducir de la publicación —las viejas no siempre lo traen donde
 * uno espera— sino que se usa el que la propia orden ya reportó. De la
 * publicación solo se toma lo que la orden no sabe: el inventory_id de Full,
 * la modalidad de envío y el estado.
 */
export async function recuperarDesdeOrdenes(
  c: MeliClient,
  refs: RefOrden[],
): Promise<ResultadoRecuperacion> {
  const ids = [...new Set(refs.map((r) => r.itemId))];
  const { items, lotesFallidos } = await traerItems(c, ids);

  const filas: FilaSku[] = [];
  let sinPublicacion = 0;

  for (const r of refs) {
    const item = items.get(r.itemId);
    if (!item) {
      sinPublicacion++;
      continue;
    }

    const variacion = r.variationId
      ? item.variations?.find((v) => String(v.id) === String(r.variationId))
      : undefined;

    filas.push({
      sku: r.sku,
      itemId: item.id,
      variationId: r.variationId,
      inventoryId: variacion?.inventory_id ?? item.inventory_id ?? null,
      titulo: item.title ?? "",
      logistica: item.shipping?.logistic_type ?? null,
      estado: item.status ?? null,
      precio: variacion?.price ?? item.price ?? null,
    });
  }

  return {
    filas,
    intentados: refs.length,
    recuperados: filas.length,
    sinPublicacion,
    lotesFallidos,
  };
}

export function claveItem(itemId: string, variationId?: number | string | null): string {
  return variationId ? `${itemId}#${variationId}` : itemId;
}

// ---------------------------------------------------------------------------
// 5. Movimientos de inventario
// ---------------------------------------------------------------------------
interface OperacionMeli {
  id?: string;
  inventory_id?: string;
  date_created?: string;
  type?: string;
  detail?: { available_quantity?: number };
  result?: { available_quantity?: number; total?: number };
}

/**
 * Historial de movimientos en Full. De aquí sale la reconstrucción del stock
 * día por día, que es lo que permite saber qué días estuvo agotado cada SKU.
 *
 * La API topa cada consulta en 60 días, así que el periodo se parte en tramos.
 */
export interface ResultadoOperaciones {
  operaciones: OperacionStock[];
  errores: string[];
  lotesTotales: number;
  lotesFallidos: number;
}

export async function obtenerOperaciones(
  c: MeliClient,
  sellerId: number,
  desde: string,
  hasta: string,
  mapaInventarioSku: Map<string, string>,
): Promise<ResultadoOperaciones> {
  // `inventory_id` es OBLIGATORIO en este endpoint: sin él, MELI responde
  // 400 missing_parameter. Como acepta una lista separada por comas pero la
  // URL no puede crecer sin límite, los inventarios se piden por tandas.
  const inventarios = [...mapaInventarioSku.keys()];
  if (!inventarios.length) {
    return { operaciones: [], errores: [], lotesTotales: 0, lotesFallidos: 0 };
  }

  const tramos: [string, string][] = [];
  let cursor = new Date(`${desde}T00:00:00.000Z`);
  const fin = new Date(`${hasta}T23:59:59.999Z`);
  while (cursor < fin) {
    const sig = new Date(cursor);
    sig.setUTCDate(sig.getUTCDate() + 55);   // margen bajo el tope de 60 días
    tramos.push([cursor.toISOString(), new Date(Math.min(+sig, +fin)).toISOString()]);
    cursor = sig;
  }

  // Cada tarea es una combinación de (tanda de inventarios × tramo de fechas).
  const tareas: { ids: string[]; ini: string; fin: string }[] = [];
  for (const grupo of trozos(inventarios, 20)) {
    for (const [ini, fin2] of tramos) tareas.push({ ids: grupo, ini, fin: fin2 });
  }

  const errores: string[] = [];
  let lotesFallidos = 0;

  // Concurrencia 3 (no 5): este endpoint tiene cuota propia y con 5 en vuelo
  // MELI responde 429 "over_quota" a media sincronización.
  const porTarea = await enLotes(tareas, 3, async (t) => {
    const acumulado: OperacionStock[] = [];
    let scroll: string | undefined;

    try {
      for (let pagina = 0; pagina < 200; pagina++) {
        const r = await c.get<{
          results: OperacionMeli[];
          paging?: { scroll?: string; total?: number };
        }>("/stock/fulfillment/operations/search", {
          seller_id: sellerId,
          inventory_id: t.ids.join(","),
          date_from: t.ini,
          date_to: t.fin,
          limit: 1000,
          scroll,
        });

        const lote = r.results ?? [];
        if (!lote.length) break;

        for (const op of lote) {
          const sku = op.inventory_id ? mapaInventarioSku.get(op.inventory_id) : undefined;
          if (!sku || !op.date_created) continue;
          acumulado.push({
            id: op.id ?? null,
            sku,
            fecha: op.date_created,
            tipo: op.type ?? null,
            deltaDisponible: op.detail?.available_quantity ?? null,
            resultadoDisponible: op.result?.available_quantity ?? null,
          });
        }

        scroll = r.paging?.scroll;
        if (!scroll || lote.length < 1000) break;
      }
    } catch (err) {
      // Un lote que truena NO tira la sincronización entera. Lo que ya se
      // bajó se guarda; lo que faltó se reporta y se recupera en la
      // siguiente corrida, que además ya arranca desde donde quedó.
      lotesFallidos++;
      if (errores.length < 5) errores.push((err as Error).message);
    }

    return acumulado;
  });

  const operaciones = porTarea.flat();
  operaciones.sort((a, b) => a.fecha.localeCompare(b.fecha));

  return { operaciones, errores, lotesTotales: tareas.length, lotesFallidos };
}
