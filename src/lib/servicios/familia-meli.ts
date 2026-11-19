/**
 * AGRUPAR publicaciones ya creadas en una FAMILIA de MELI (user products).
 *
 * En el modelo de user products cada color + talla es una publicación y MELI
 * las junta en una página por FAMILIA. La familia no se asigna: MELI la
 * calcula con el `family_name` de la publicación (y su categoría). Así que
 * «meter un MLM a la familia X» es escribirle el `family_name` de X y volver
 * a leer en qué familia lo dejó MELI. Nada se da por hecho: si MELI contesta
 * que sí y el MLM queda en otra familia, se dice, con los atributos que
 * difieren contra la familia destino (lo que suele partirla).
 *
 * La parte de arriba es pura (con pruebas); la de abajo habla con MELI.
 */
import type { MeliClient } from "@/lib/meli/client";
import {
  esDiferenciaEsperada,
  esMedidaDePaquete,
  mensajeMeli,
  valorDeAtributo,
  type ItemCrudo,
} from "./listados";

// ---------------------------------------------------------------------------
// Puro
// ---------------------------------------------------------------------------

export type DestinoFamilia =
  | { tipo: "publicacion"; id: string }
  | { tipo: "familia"; id: string };

/** «MLM2745026941» / «mlm-2745026941» = una publicación de la familia;
 *  puros dígitos = el id de la familia. */
export function leerDestino(texto: string): DestinoFamilia | null {
  const t = texto.trim().toUpperCase().replace(/[\s-]/g, "");
  if (/^ML[A-Z]\d{6,}$/.test(t)) return { tipo: "publicacion", id: t };
  if (/^\d{6,}$/.test(t)) return { tipo: "familia", id: t };
  return null;
}

/** Los MLM de un texto libre (comas, espacios, saltos de línea, enlaces). */
export function leerPublicaciones(texto: string): string[] {
  const ids = texto.toUpperCase().match(/ML[A-Z]-?\d{6,}/g) ?? [];
  return [...new Set(ids.map((x) => x.replace("-", "")))];
}

/** Los user products de la respuesta de /user-products-families/{id}. MELI
 *  la ha entregado como lista de ids y como lista de objetos. */
export function userProductsDeFamilia(resp: unknown): string[] {
  const r = (resp ?? {}) as Record<string, unknown>;
  const lista = [r.user_products_ids, r.user_products, r.results].find(Array.isArray) as unknown[] | undefined;
  const ids = (lista ?? []).map((x) =>
    typeof x === "string" ? x : String((x as { id?: unknown; user_product_id?: unknown })?.id ?? (x as { user_product_id?: unknown })?.user_product_id ?? ""),
  );
  return [...new Set(ids.filter((x) => /^ML[A-Z]U\d+$/.test(x)))];
}

/** El id de familia de un user product (o de un item, si MELI lo trae). */
export function familiaDe(recurso: unknown): string | null {
  const v = (recurso as { family_id?: unknown } | null)?.family_id;
  return v == null || v === "" ? null : String(v);
}

export interface DiferenciaFamilia {
  atributoId: string;
  nombre: string;
  enPublicacion: string | null;
  enFamilia: string | null;
}

/**
 * Atributos de producto que la publicación trae distintos a la de referencia
 * de la familia. Color, talla, GTIN y demás diferencias esperadas no cuentan,
 * ni las medidas del paquete (las mide Full por variante).
 */
export function diferenciasContraFamilia(item: ItemCrudo, referencia: ItemCrudo): DiferenciaFamilia[] {
  const mapa = (i: ItemCrudo) =>
    new Map((i.attributes ?? []).flatMap((a) => (a.id ? [[a.id, a] as const] : [])));
  const a = mapa(item);
  const b = mapa(referencia);
  const salida: DiferenciaFamilia[] = [];
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    if (id === "SELLER_SKU" || esDiferenciaEsperada(id) || esMedidaDePaquete(id)) continue;
    const va = a.get(id) ? valorDeAtributo(a.get(id)!) : null;
    const vb = b.get(id) ? valorDeAtributo(b.get(id)!) : null;
    if ((va ?? "").trim().toLowerCase() === (vb ?? "").trim().toLowerCase()) continue;
    salida.push({ atributoId: id, nombre: (a.get(id) ?? b.get(id))?.name ?? id, enPublicacion: va, enFamilia: vb });
  }
  return salida.sort((x, y) => x.nombre.localeCompare(y.nombre));
}

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

export interface FamiliaDestino {
  familyId: string | null;
  familyName: string;
  /** publicación de la familia que se usó de referencia */
  itemId: string;
  categoria: string | null;
  referencia: ItemCrudo;
}

export interface ResultadoAgrupar {
  itemId: string;
  estado: "agrupado" | "ya_estaba" | "otra_familia" | "error";
  familiaAntes: string | null;
  familiaDespues: string | null;
  nombreAntes: string | null;
  detalle: string | null;
  diferencias: DiferenciaFamilia[];
}

async function familiaDelItem(cliente: MeliClient, item: ItemCrudo): Promise<string | null> {
  const propia = familiaDe(item);
  if (propia) return propia;
  if (!item.user_product_id) return null;
  try {
    return familiaDe(await cliente.get(`/user-products/${item.user_product_id}`, undefined, { reintentos: 1 }));
  } catch {
    return null;
  }
}

/**
 * Resuelve la familia destino a una publicación de referencia.
 * `itemDeUserProducts` traduce user products a una publicación del catálogo
 * PROPIO (tabla `skus`): una familia sin ninguna publicación nuestra no sirve
 * de destino.
 */
export async function resolverFamilia(
  cliente: MeliClient,
  destino: DestinoFamilia,
  itemDeUserProducts: (ups: string[]) => Promise<string | null>,
  sitio = "MLM",
): Promise<FamiliaDestino> {
  let itemId = destino.tipo === "publicacion" ? destino.id : null;
  if (destino.tipo === "familia") {
    let resp: unknown;
    try {
      resp = await cliente.get(`/sites/${sitio}/user-products-families/${destino.id}`, undefined, { reintentos: 1 });
    } catch (err) {
      throw new Error(`MELI no entregó la familia ${destino.id}: ${mensajeMeli(err)}`);
    }
    const ups = userProductsDeFamilia(resp);
    if (!ups.length) throw new Error(`La familia ${destino.id} no trae productos en MELI.`);
    itemId = await itemDeUserProducts(ups);
    if (!itemId) {
      throw new Error(
        `Ninguna publicación del catálogo es de la familia ${destino.id}. Pon mejor un MLM que ya esté en esa familia.`,
      );
    }
  }

  let referencia: ItemCrudo;
  try {
    referencia = await cliente.get<ItemCrudo>(`/items/${itemId}`);
  } catch (err) {
    throw new Error(`No se pudo leer ${itemId}: ${mensajeMeli(err)}`);
  }
  const familyName = (referencia.family_name ?? "").trim();
  if (!familyName) {
    throw new Error(`${itemId} no trae nombre de familia: no es una publicación de user products.`);
  }
  const familyId = (await familiaDelItem(cliente, referencia)) ?? (destino.tipo === "familia" ? destino.id : null);
  return { familyId, familyName, itemId: itemId!, categoria: referencia.category_id ?? null, referencia };
}

const ESPERA_MS = 2000;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Escribe el nombre de la familia destino en cada publicación y CONFIRMA
 *  releyendo en qué familia la dejó MELI. En serie: los PUT comparten cuota. */
export async function agruparEnFamilia(
  cliente: MeliClient,
  itemIds: string[],
  familia: FamiliaDestino,
): Promise<ResultadoAgrupar[]> {
  const resultados: ResultadoAgrupar[] = [];
  for (const itemId of itemIds) {
    const base: ResultadoAgrupar = {
      itemId,
      estado: "error",
      familiaAntes: null,
      familiaDespues: null,
      nombreAntes: null,
      detalle: null,
      diferencias: [],
    };
    let item: ItemCrudo;
    try {
      item = await cliente.get<ItemCrudo>(`/items/${itemId}`);
    } catch (err) {
      resultados.push({ ...base, detalle: `No se pudo leer: ${mensajeMeli(err)}` });
      continue;
    }
    base.nombreAntes = item.family_name ?? null;
    base.familiaAntes = await familiaDelItem(cliente, item);
    base.diferencias = diferenciasContraFamilia(item, familia.referencia);

    if (!item.family_name) {
      resultados.push({
        ...base,
        detalle: "No es una publicación de user products (no trae nombre de familia): MELI no la puede agrupar así.",
      });
      continue;
    }
    if (familia.familyId && base.familiaAntes === familia.familyId) {
      resultados.push({ ...base, estado: "ya_estaba", familiaDespues: base.familiaAntes, diferencias: [] });
      continue;
    }
    if (familia.categoria && item.category_id && item.category_id !== familia.categoria) {
      resultados.push({
        ...base,
        detalle: `Es de otra categoría (${item.category_id}; la familia es ${familia.categoria}): MELI no junta categorías distintas.`,
      });
      continue;
    }

    if (item.family_name.trim() !== familia.familyName) {
      try {
        await cliente.put(`/items/${itemId}`, { family_name: familia.familyName }, { reintentos: 1 });
      } catch (err) {
        // MELI solo deja cambiar el nombre de familia mientras el producto no
        // tenga ventas (GT251-BLK-25, 19-nov-2026: 1 venta, BODY_INVALID_FIELDS).
        const vendidas = Number((item as { sold_quantity?: unknown }).sold_quantity ?? 0);
        const porVentas =
          vendidas > 0
            ? ` Esta publicación ya tiene ${vendidas} venta${vendidas === 1 ? "" : "s"}: MELI solo deja cambiar el nombre de familia a un producto sin ventas.`
            : "";
        resultados.push({ ...base, detalle: `MELI rechazó el cambio: ${mensajeMeli(err)}.${porVentas}` });
        continue;
      }
    }

    // MELI recalcula la familia unos instantes después: dos lecturas.
    let despues: string | null = null;
    let nombre: string | null = null;
    for (let i = 0; i < 2; i++) {
      await espera(ESPERA_MS);
      try {
        const releido = await cliente.get<ItemCrudo>(`/items/${itemId}`);
        nombre = releido.family_name ?? null;
        despues = await familiaDelItem(cliente, releido);
      } catch {
        /* se reintenta */
      }
      if (familia.familyId && despues === familia.familyId) break;
    }
    base.familiaDespues = despues;

    if ((nombre ?? "").trim() !== familia.familyName) {
      resultados.push({ ...base, detalle: "MELI contestó OK pero no guardó el nombre de familia." });
    } else if (familia.familyId && despues === familia.familyId) {
      resultados.push({ ...base, estado: "agrupado", diferencias: [] });
    } else if (!familia.familyId || !despues) {
      resultados.push({
        ...base,
        estado: "agrupado",
        detalle: "El nombre de familia ya es el mismo; MELI no dijo el id de familia para confirmarlo. Revisa la página del producto.",
      });
    } else {
      resultados.push({
        ...base,
        estado: "otra_familia",
        detalle: `Ya lleva el mismo nombre, pero MELI la dejó en la familia ${despues}, no en la ${familia.familyId}. Puede tardar unos minutos; si no cambia, lo que la separa suele ser un atributo distinto.`,
      });
    }
  }
  return resultados;
}
