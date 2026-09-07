/**
 * Listados de YAPANIZCEL: las publicaciones de un diseño vistas juntas, con
 * sus variantes y atributos, y la posibilidad de cambiar un valor desde aquí.
 *
 * El caso que motivó la pantalla: en el 499 el color/patrón dice
 * "Transparente" y ese texto se come el espacio del selector; ya no se ve el
 * modelo del celular. Desde el Seller Center hay que entrar publicación por
 * publicación; aquí se ven todas las del diseño y se cambia el valor en
 * todas de un jalón, o en una sola variante.
 *
 * Reutiliza el lector y el armado del PUT del ERP de calzado
 * (`servicios/listados.ts`): leer en vivo, aplanar, armar el cuerpo mínimo.
 * Lo propio de fundas es de dónde salen los item_ids (por diseño, no por
 * modelo de zapato) y la edición por variante.
 */
import type { MeliClient } from "../meli/client";
import { claveItem } from "../meli/sync";
import {
  aplanarItem,
  armarPlanUnificacion,
  mensajeMeli,
  pasarAtributo,
  traerItemsCrudos,
  type ItemCrudo,
  type ItemListado,
  type ResultadoUnificacion,
} from "../servicios/listados";
import type { DB } from "../datos/repos";
import { todo } from "./db";
import { desglosar, esCalzado } from "./sku";

export interface GrupoDiseno {
  diseno: string;
  items: ItemListado[];
  /** atributos vistos en el grupo, para el selector: id -> nombre */
  atributos: { id: string; nombre: string; nivel: "publicacion" | "variante"; valores: string[] }[];
  lotesFallidos: number;
}

/** Los item_ids de un diseño según el catálogo sincronizado. */
async function itemsDelDiseno(db: DB, accountId: string, diseno: string) {
  const filas = await todo<{ item_id: string | null; variation_id: string | null; sku: string }>(
    db,
    "yz_skus",
    "item_id, variation_id, sku",
    (q) => q.eq("account_id", accountId).not("item_id", "is", null),
  );
  const clave = diseno.trim().toUpperCase();
  const itemIds = new Set<string>();
  const porClave = new Map<string, { sku: string; talla: string | null; color: string | null }>();
  for (const f of filas) {
    if (!f.item_id) continue;
    const d = desglosar(f.sku);
    if (d.diseno !== clave) continue;
    itemIds.add(f.item_id);
    const dato = { sku: f.sku, talla: null, color: d.color || null };
    porClave.set(claveItem(f.item_id, f.variation_id), dato);
    if (!f.variation_id) porClave.set(f.item_id, dato);
  }
  return { itemIds: [...itemIds], porClave };
}

export async function leerDiseno(cliente: MeliClient, db: DB, accountId: string, diseno: string): Promise<GrupoDiseno | null> {
  const { itemIds, porClave } = await itemsDelDiseno(db, accountId, diseno);
  if (!itemIds.length) return null;

  const { items, lotesFallidos } = await traerItemsCrudos(cliente, itemIds);
  const aplanados = [...items.values()].map((i) => aplanarItem(i, porClave));
  aplanados.sort((a, b) => (a.estado === "active" ? 0 : 1) - (b.estado === "active" ? 0 : 1) || a.titulo.localeCompare(b.titulo));

  // Selector de atributos: todos los que aparecen, con los valores que traen.
  const vistos = new Map<string, { id: string; nombre: string; nivel: "publicacion" | "variante"; valores: Set<string> }>();
  const anotar = (nivel: "publicacion" | "variante", a: { id: string; nombre: string; valor: string }) => {
    const k = `${nivel}:${a.id}`;
    const v = vistos.get(k) ?? { id: a.id, nombre: a.nombre, nivel, valores: new Set<string>() };
    v.valores.add(a.valor);
    vistos.set(k, v);
  };
  for (const it of aplanados) {
    for (const a of it.atributos) anotar("publicacion", a);
    for (const v of it.variantes) for (const a of v.atributos) anotar("variante", a);
  }

  return {
    diseno: diseno.trim().toUpperCase(),
    items: aplanados,
    atributos: [...vistos.values()]
      .map((v) => ({ id: v.id, nombre: v.nombre, nivel: v.nivel, valores: [...v.valores].sort() }))
      .sort((a, b) => a.nivel.localeCompare(b.nivel) || a.nombre.localeCompare(b.nombre)),
    lotesFallidos,
  };
}

/** Diseños del catálogo con cuántas publicaciones tiene cada uno (sin calzado). */
export async function listarDisenos(db: DB, accountId: string): Promise<{ diseno: string; publicaciones: number; activas: number }[]> {
  const filas = await todo<{ item_id: string | null; sku: string; estado: string | null }>(
    db,
    "yz_skus",
    "item_id, sku, estado",
    (q) => q.eq("account_id", accountId).not("item_id", "is", null),
  );
  const por = new Map<string, { items: Set<string>; activas: Set<string> }>();
  for (const f of filas) {
    if (!f.item_id) continue;
    const d = desglosar(f.sku).diseno;
    if (!d || esCalzado(d)) continue;
    const g = por.get(d) ?? { items: new Set<string>(), activas: new Set<string>() };
    g.items.add(f.item_id);
    if (f.estado === "active") g.activas.add(f.item_id);
    por.set(d, g);
  }
  return [...por]
    .map(([diseno, g]) => ({ diseno, publicaciones: g.items.size, activas: g.activas.size }))
    .sort((a, b) => a.diseno.localeCompare(b.diseno, "es", { numeric: true }));
}

/**
 * Cuerpo del PUT que cambia UN atributo en UNA variante, tocando lo mínimo:
 * `variations` con todas (las que no cambian solo con su id; MELI borra las
 * que no se incluyen) y la editada con sus arreglos completos.
 */
export function armarPlanVariante(item: ItemCrudo, variationId: string, atributoId: string, valor: string): Record<string, unknown> | null {
  const objetivo: Record<string, unknown> = { id: atributoId, value_name: valor };
  let tocada = false;
  const variations = (item.variations ?? []).map((v) => {
    if (String(v.id) !== String(variationId)) return { id: v.id };
    tocada = true;
    const salida: Record<string, unknown> = { id: v.id };
    const enCombos = (v.attribute_combinations ?? []).some((a) => a.id === atributoId);
    const enAttrs = (v.attributes ?? []).some((a) => a.id === atributoId);
    if (enCombos) {
      salida.attribute_combinations = (v.attribute_combinations ?? []).map((a) => (a.id === atributoId ? objetivo : pasarAtributo(a)));
    }
    const attrs = (v.attributes ?? []).map((a) => (a.id === atributoId ? objetivo : pasarAtributo(a)));
    if (!enCombos && !enAttrs) attrs.push(objetivo);
    if (attrs.length) salida.attributes = attrs;
    return salida;
  });
  return tocada ? { variations } : null;
}

export async function cambiarAtributoVariante(
  cliente: MeliClient,
  itemId: string,
  variationId: string,
  atributoId: string,
  valor: string,
): Promise<ResultadoUnificacion> {
  const { items } = await traerItemsCrudos(cliente, [itemId]);
  const item = items.get(itemId);
  if (!item) return { itemId, estado: "error", niveles: [], detalle: "MELI no devolvió la publicación." };
  const cuerpo = armarPlanVariante(item, variationId, atributoId, valor);
  if (!cuerpo) return { itemId, estado: "error", niveles: [], detalle: "La variante no existe en la publicación." };
  try {
    await cliente.put(`/items/${itemId}`, cuerpo, { reintentos: 1 });
    return { itemId, estado: "actualizado", niveles: ["variantes"], detalle: null };
  } catch (err) {
    return { itemId, estado: "error", niveles: ["variantes"], detalle: mensajeMeli(err) };
  }
}

/** Cambia un atributo a nivel PUBLICACIÓN (título incluido si `atributoId` es "TITLE"). */
export async function cambiarTitulo(cliente: MeliClient, itemId: string, titulo: string): Promise<ResultadoUnificacion> {
  try {
    await cliente.put(`/items/${itemId}`, { title: titulo }, { reintentos: 1 });
    return { itemId, estado: "actualizado", niveles: ["publicacion"], detalle: null };
  } catch (err) {
    return { itemId, estado: "error", niveles: ["publicacion"], detalle: mensajeMeli(err) };
  }
}

export { armarPlanUnificacion };
