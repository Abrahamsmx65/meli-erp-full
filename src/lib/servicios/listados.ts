/**
 * Listados: las publicaciones de un agrupador vistas juntas, con sus variantes
 * y las diferencias de atributos entre ellas.
 *
 * El problema que resuelve: en el agrupador de variantes de MELI cada color es
 * su propio MLM, y cuando las publicaciones hermanas traen valores distintos
 * de un atributo (el caso real: "Materiales"), el picker de la página del
 * producto se parte en opciones que no deberían existir — el comprador ve
 * "Piel real", "Piel (cuero) y textil", etc. como si fueran productos
 * distintos. Desde el Seller Center es casi imposible ver DÓNDE está la
 * diferencia; aquí se leen todas las publicaciones del agrupador en vivo, se
 * comparan atributo por atributo y se puede unificar el valor con un clic.
 *
 * Nada se guarda en Supabase: la foto es siempre la de MELI en este momento.
 * De la base solo sale el amarre agrupador (modelo) -> item_ids, que la
 * sincronización ya mantiene en `skus`.
 */
import { MeliClient, MeliError, enLotes, trozos } from "../meli/client";
import { claveItem } from "../meli/sync";
import { traerTodo, type DB } from "../datos/repos";

// ---------------------------------------------------------------------------
// Tipos crudos de MELI (solo lo que se usa)
// ---------------------------------------------------------------------------
export interface AtributoCrudo {
  id?: string;
  name?: string;
  value_id?: string | null;
  value_name?: string | null;
  /** los atributos multivalor (p. ej. materiales) vienen aquí */
  values?: { id?: string | null; name?: string | null }[];
}

export interface VariacionCruda {
  id?: number | string;
  price?: number;
  available_quantity?: number;
  /** los ejes del picker DENTRO de la publicación (talla, color…) */
  attribute_combinations?: AtributoCrudo[];
  /** atributos propios de la variante (aquí puede vivir el material) */
  attributes?: AtributoCrudo[];
  user_product_id?: string | null;
}

export interface ItemCrudo {
  id: string;
  title?: string;
  status?: string;
  permalink?: string;
  price?: number;
  category_id?: string | null;
  attributes?: AtributoCrudo[];
  variations?: VariacionCruda[];
}

// ---------------------------------------------------------------------------
// Tipos del grupo que ve la pantalla
// ---------------------------------------------------------------------------
export interface ValorAtributo {
  id: string;
  nombre: string;
  valor: string;
  valueId: string | null;
}

export interface VarianteListado {
  variationId: string;
  /** SKU según el catálogo sincronizado; null si esa variante no está amarrada */
  sku: string | null;
  talla: string | null;
  /** resumen legible de attribute_combinations: "Café | 27" */
  combinacion: string;
  precio: number | null;
  stock: number | null;
  atributos: ValorAtributo[];
}

export interface ItemListado {
  itemId: string;
  titulo: string;
  estado: string | null;
  permalink: string | null;
  precio: number | null;
  /** color según el catálogo sincronizado (cada color es su propio MLM) */
  color: string | null;
  atributos: ValorAtributo[];
  variantes: VarianteListado[];
}

export interface ValorDiferencia {
  valor: string;
  valueId: string | null;
  veces: number;
  /** dónde está este valor: itemId, o "itemId · combinación" si es por variante */
  donde: string[];
}

export interface Diferencia {
  atributoId: string;
  nombre: string;
  nivel: "publicacion" | "variante";
  /** talla, color, GTIN…: atributos que SE ESPERA que difieran entre variantes */
  esperada: boolean;
  /** el caso que motivó la pantalla: cualquier atributo de material */
  esMaterial: boolean;
  valores: ValorDiferencia[];
}

export interface GrupoListados {
  agrupador: string;
  items: ItemListado[];
  diferencias: Diferencia[];
  /** lotes de /items que MELI no contestó: la foto puede estar incompleta */
  lotesFallidos: number;
}

// ---------------------------------------------------------------------------
// Lectura de atributos (funciones puras, probadas en listados.test.ts)
// ---------------------------------------------------------------------------

/** El valor legible de un atributo; los multivalor se juntan con ", ". */
export function valorDeAtributo(a: AtributoCrudo): string | null {
  const v = a.value_name?.trim();
  if (v) return v;
  const nombres = (a.values ?? [])
    .map((x) => x?.name?.trim())
    .filter((x): x is string => !!x);
  return nombres.length ? nombres.join(", ") : null;
}

/** El SKU no es un atributo comparable: se excluye de todo. */
const EXCLUIDOS = new Set(["SELLER_SKU"]);

/** Atributos que difieren por diseño entre variantes/publicaciones hermanas. */
export function esDiferenciaEsperada(atributoId: string): boolean {
  return /SIZE|COLOR|GTIN|EAN|UPC/.test(atributoId);
}

export function esAtributoDeMaterial(atributoId: string): boolean {
  return atributoId.includes("MATERIAL");
}

function aValores(attrs: AtributoCrudo[] | undefined): ValorAtributo[] {
  const out: ValorAtributo[] = [];
  for (const a of attrs ?? []) {
    if (!a.id || EXCLUIDOS.has(a.id)) continue;
    const valor = valorDeAtributo(a);
    if (valor == null) continue;
    out.push({ id: a.id, nombre: a.name?.trim() || a.id, valor, valueId: a.value_id ?? null });
  }
  return out;
}

function resumenCombinacion(v: VariacionCruda): string {
  const partes = (v.attribute_combinations ?? [])
    .map((a) => valorDeAtributo(a))
    .filter((x): x is string => !!x);
  return partes.join(" | ");
}

/** Aplana una publicación cruda de MELI a lo que la pantalla necesita. */
export function aplanarItem(
  item: ItemCrudo,
  catalogo?: Map<string, { sku: string; talla: string | null; color: string | null }>,
): ItemListado {
  const variantes: VarianteListado[] = (item.variations ?? []).map((v) => {
    const variationId = v.id != null ? String(v.id) : "";
    const fila = catalogo?.get(claveItem(item.id, variationId));
    const combos = aValores(v.attribute_combinations);
    return {
      variationId,
      sku: fila?.sku ?? null,
      talla: fila?.talla ?? combos.find((c) => /SIZE/.test(c.id))?.valor ?? null,
      combinacion: resumenCombinacion(v),
      precio: v.price ?? null,
      stock: v.available_quantity ?? null,
      // Los ejes del picker también son atributos de la variante: se juntan
      // para poder comparar sin importar en cuál de los dos arreglos vengan.
      atributos: [...combos, ...aValores(v.attributes)],
    };
  });

  // La talla numérica ordena; "CORRIDA" u otras van al final.
  variantes.sort((a, b) => {
    const na = Number(a.talla);
    const nb = Number(b.talla);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    if (Number.isFinite(na)) return -1;
    if (Number.isFinite(nb)) return 1;
    return (a.talla ?? "").localeCompare(b.talla ?? "");
  });

  const filaItem = catalogo?.get(item.id);
  const colores = new Set(
    (item.variations ?? [])
      .map((v) => catalogo?.get(claveItem(item.id, v.id != null ? String(v.id) : ""))?.color)
      .filter((c): c is string => !!c),
  );

  return {
    itemId: item.id,
    titulo: item.title ?? "",
    estado: item.status ?? null,
    permalink: item.permalink ?? null,
    precio: item.price ?? null,
    color: filaItem?.color ?? (colores.size === 1 ? [...colores][0] : null),
    atributos: aValores(item.attributes),
    variantes,
  };
}

/**
 * Compara los items de un grupo atributo por atributo y devuelve SOLO los que
 * tienen más de un valor (o que a unos les faltan y a otros no).
 *
 *   - nivel "publicacion": el atributo difiere entre los MLM hermanos.
 *   - nivel "variante": difiere entre variantes, juntando las de TODAS las
 *     publicaciones — así es como lo ve el picker del agrupador de MELI.
 */
export function calcularDiferencias(items: ItemListado[]): Diferencia[] {
  const SIN_DATO = "(sin dato)";
  const diferencias: Diferencia[] = [];

  const acumular = (
    nivel: "publicacion" | "variante",
    portadores: { donde: string; atributos: ValorAtributo[] }[],
  ) => {
    if (portadores.length < 2) return;

    const ids = new Map<string, string>(); // atributoId -> nombre
    for (const p of portadores) {
      for (const a of p.atributos) if (!ids.has(a.id)) ids.set(a.id, a.nombre);
    }

    for (const [atributoId, nombre] of ids) {
      const valores = new Map<string, ValorDiferencia>();
      for (const p of portadores) {
        const a = p.atributos.find((x) => x.id === atributoId);
        const valor = a?.valor ?? SIN_DATO;
        const previo = valores.get(valor);
        if (previo) {
          previo.veces++;
          previo.donde.push(p.donde);
        } else {
          valores.set(valor, {
            valor,
            valueId: a?.valueId ?? null,
            veces: 1,
            donde: [p.donde],
          });
        }
      }
      if (valores.size < 2) continue;

      diferencias.push({
        atributoId,
        nombre,
        nivel,
        esperada: esDiferenciaEsperada(atributoId),
        esMaterial: esAtributoDeMaterial(atributoId),
        valores: [...valores.values()].sort((a, b) => b.veces - a.veces),
      });
    }
  };

  acumular(
    "publicacion",
    items.map((i) => ({ donde: i.color ? `${i.itemId} (${i.color})` : i.itemId, atributos: i.atributos })),
  );
  acumular(
    "variante",
    items.flatMap((i) =>
      i.variantes.map((v) => ({
        donde: `${i.itemId} · ${v.combinacion || v.talla || v.variationId}`,
        atributos: v.atributos,
      })),
    ),
  );

  // El material —el motivo de la pantalla— primero; luego lo demás raro;
  // las diferencias esperadas (talla, color, GTIN) al final.
  diferencias.sort((a, b) => {
    const peso = (d: Diferencia) => (d.esMaterial ? 0 : d.esperada ? 2 : 1);
    return peso(a) - peso(b) || a.nombre.localeCompare(b.nombre);
  });

  return diferencias;
}

// ---------------------------------------------------------------------------
// Unificación: armar el PUT a /items/{id} (puro, probado)
// ---------------------------------------------------------------------------

export interface PlanUnificacion {
  itemId: string;
  /** null cuando la publicación ya trae el valor objetivo en todos lados */
  cuerpo: Record<string, unknown> | null;
  niveles: ("publicacion" | "variantes")[];
}

/** Reenvía un atributo tal cual vino: en el PUT de variantes hay que mandar
 *  el arreglo completo, y lo que no cambia debe regresar idéntico. */
export function pasarAtributo(a: AtributoCrudo): Record<string, unknown> {
  const out: Record<string, unknown> = { id: a.id };
  if (a.value_id != null) out.value_id = a.value_id;
  if (a.value_name != null) out.value_name = a.value_name;
  if (a.values?.length && a.value_id == null && a.value_name == null) {
    out.values = a.values.map((v) => ({
      ...(v.id != null ? { id: v.id } : {}),
      ...(v.name != null ? { name: v.name } : {}),
    }));
  }
  return out;
}

/**
 * Construye el cuerpo del PUT que deja `atributoId` con un solo valor en toda
 * la publicación, tocando lo MÍNIMO:
 *
 *   - Si el atributo vive en las variantes (attributes o attribute_combinations),
 *     se manda `variations` con TODAS las variantes — MELI BORRA las que no se
 *     incluyen — pero las que no cambian van solo con su `id`, y en las que sí,
 *     el arreglo va completo con el atributo reemplazado (quitar el resto lo
 *     borraría, incluido el SELLER_SKU).
 *   - Si vive a nivel publicación, `attributes` con solo ese atributo (el PUT
 *     de attributes es un upsert por id: no toca los demás).
 *   - Si no existe en ningún lado, se agrega a nivel publicación.
 */
export function armarPlanUnificacion(
  item: ItemCrudo,
  atributoId: string,
  valor: string,
): PlanUnificacion {
  // SIEMPRE por nombre, nunca por value_id: mandar solo el id truena con
  // "Value name of attribute MATERIALS was not provided and couldn't be
  // resolved from attributes database" (visto en producción con MATERIALS,
  // que es multivalor). El nombre MELI sí lo resuelve contra su catálogo, y
  // si es un valor custom que las hermanas ya traen, lo acepta igual.
  const objetivo: Record<string, unknown> = { id: atributoId, value_name: valor };

  const coincide = (a: AtributoCrudo): boolean =>
    (valorDeAtributo(a) ?? "").trim() === valor.trim();

  const variaciones = item.variations ?? [];
  const enCombos = variaciones.some((v) =>
    (v.attribute_combinations ?? []).some((a) => a.id === atributoId),
  );
  const enAtributosVar = variaciones.some((v) =>
    (v.attributes ?? []).some((a) => a.id === atributoId),
  );

  const cuerpo: Record<string, unknown> = {};
  const niveles: ("publicacion" | "variantes")[] = [];

  if (enCombos || enAtributosVar) {
    let algunaCambia = false;

    const vs = variaciones.map((v) => {
      let cambia = false;

      const combos = (v.attribute_combinations ?? []).map((a) => {
        if (a.id === atributoId && !coincide(a)) {
          cambia = true;
          return objetivo;
        }
        return pasarAtributo(a);
      });

      const attrs = (v.attributes ?? []).map((a) => {
        if (a.id === atributoId && !coincide(a)) {
          cambia = true;
          return objetivo;
        }
        return pasarAtributo(a);
      });
      // Una hermana sin el atributo también parte el picker: se le agrega.
      if (enAtributosVar && !(v.attributes ?? []).some((a) => a.id === atributoId)) {
        attrs.push(objetivo);
        cambia = true;
      }

      if (!cambia) return { id: v.id };
      algunaCambia = true;
      const salida: Record<string, unknown> = { id: v.id };
      if ((v.attribute_combinations ?? []).some((a) => a.id === atributoId)) {
        salida.attribute_combinations = combos;
      }
      if (attrs.length) salida.attributes = attrs;
      return salida;
    });

    if (algunaCambia) {
      cuerpo.variations = vs;
      niveles.push("variantes");
    }
  }

  const attrItem = (item.attributes ?? []).find((a) => a.id === atributoId);
  if (attrItem ? !coincide(attrItem) : !enCombos && !enAtributosVar) {
    cuerpo.attributes = [objetivo];
    niveles.push("publicacion");
  }

  return { itemId: item.id, cuerpo: niveles.length ? cuerpo : null, niveles };
}

// ---------------------------------------------------------------------------
// IO: leer el grupo y aplicar la unificación contra MELI
// ---------------------------------------------------------------------------

/** Baja publicaciones COMPLETAS (sin proyección: recortaría los atributos
 *  de las variantes, la misma trampa documentada en meli/sync.ts). */
export async function traerItemsCrudos(
  c: MeliClient,
  ids: string[],
): Promise<{ items: Map<string, ItemCrudo>; lotesFallidos: number }> {
  const items = new Map<string, ItemCrudo>();
  let lotesFallidos = 0;
  if (!ids.length) return { items, lotesFallidos };

  const respuestas = await enLotes(trozos(ids, 20), 5, async (grupo) => {
    try {
      return await c.get<{ code: number; body: ItemCrudo }[]>("/items", {
        ids: grupo.join(","),
      });
    } catch {
      lotesFallidos++;
      return [] as { code: number; body: ItemCrudo }[];
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

interface FilaCatalogo {
  item_id: string | null;
  variation_id: string | null;
  sku: string;
  talla: string | null;
  color: string | null;
}

/** item_ids del agrupador según el catálogo sincronizado, con su amarre SKU. */
async function catalogoDelAgrupador(
  db: DB,
  accountId: string,
  agrupador: string,
): Promise<{ itemIds: string[]; porClave: Map<string, { sku: string; talla: string | null; color: string | null }> }> {
  // ilike sin comodines = igualdad sin distinguir mayúsculas; el índice
  // skus_modelo_idx hace el resto. Se incluyen también los SKUs apagados:
  // una publicación pausada del agrupador sigue partiendo el picker.
  const filas = await traerTodo<FilaCatalogo>(
    db,
    "skus",
    "item_id, variation_id, sku, talla, color",
    (q) => q.eq("account_id", accountId).ilike("modelo", agrupador).not("item_id", "is", null),
  );

  const itemIds = new Set<string>();
  const porClave = new Map<string, { sku: string; talla: string | null; color: string | null }>();
  for (const f of filas ?? []) {
    if (!f.item_id) continue;
    itemIds.add(f.item_id);
    const dato = { sku: f.sku, talla: f.talla, color: f.color };
    porClave.set(claveItem(f.item_id, f.variation_id), dato);
    if (!f.variation_id) porClave.set(f.item_id, dato);
  }
  return { itemIds: [...itemIds], porClave };
}

/** Lee en vivo todas las publicaciones del agrupador y calcula sus diferencias. */
export async function leerGrupoListados(
  cliente: MeliClient,
  db: DB,
  accountId: string,
  agrupador: string,
): Promise<GrupoListados | null> {
  const { itemIds, porClave } = await catalogoDelAgrupador(db, accountId, agrupador);
  if (!itemIds.length) return null;

  const { items, lotesFallidos } = await traerItemsCrudos(cliente, itemIds);

  const aplanados = [...items.values()].map((i) => aplanarItem(i, porClave));
  aplanados.sort(
    (a, b) => (a.color ?? "").localeCompare(b.color ?? "") || a.itemId.localeCompare(b.itemId),
  );

  return {
    agrupador: agrupador.toUpperCase(),
    items: aplanados,
    diferencias: calcularDiferencias(aplanados),
    lotesFallidos,
  };
}

export interface ResultadoUnificacion {
  itemId: string;
  estado: "actualizado" | "sin_cambio" | "error";
  niveles: ("publicacion" | "variantes")[];
  detalle: string | null;
}

/** El mensaje real de MELI, no el "HTTP 400" genérico: sin él no se puede
 *  saber si rechazó el valor, el atributo o la publicación entera. */
export function mensajeMeli(err: unknown): string {
  if (err instanceof MeliError) {
    const c = err.cuerpo as { message?: string; cause?: { code?: string; message?: string }[] } | undefined;
    const causas = Array.isArray(c?.cause)
      ? c.cause.map((x) => x?.message ?? x?.code).filter(Boolean).join("; ")
      : "";
    return [c?.message ?? err.message, causas].filter(Boolean).join(" — ");
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Deja `atributoId` con un solo valor en todas las publicaciones indicadas.
 * Cada publicación se relee JUSTO antes de escribir: el cuerpo del PUT lleva
 * las variantes completas y armarlo sobre una foto vieja pisaría cambios.
 */
export async function unificarAtributo(
  cliente: MeliClient,
  itemIds: string[],
  atributoId: string,
  valor: string,
): Promise<ResultadoUnificacion[]> {
  const { items } = await traerItemsCrudos(cliente, itemIds);
  const resultados: ResultadoUnificacion[] = [];

  // En serie a propósito: son pocas publicaciones por agrupador y los PUT de
  // items comparten cuota; en paralelo MELI contesta 429.
  for (const itemId of itemIds) {
    const item = items.get(itemId);
    if (!item) {
      resultados.push({
        itemId,
        estado: "error",
        niveles: [],
        detalle: "MELI no devolvió la publicación.",
      });
      continue;
    }

    const plan = armarPlanUnificacion(item, atributoId, valor);
    if (!plan.cuerpo) {
      resultados.push({ itemId, estado: "sin_cambio", niveles: [], detalle: null });
      continue;
    }

    try {
      await cliente.put(`/items/${itemId}`, plan.cuerpo, { reintentos: 1 });
      resultados.push({ itemId, estado: "actualizado", niveles: plan.niveles, detalle: null });
    } catch (err) {
      resultados.push({ itemId, estado: "error", niveles: plan.niveles, detalle: mensajeMeli(err) });
    }
  }

  return resultados;
}

// ---------------------------------------------------------------------------
// Agrupadores conocidos (para el buscador de la página)
// ---------------------------------------------------------------------------
export interface AgrupadorConocido {
  modelo: string;
  publicaciones: number;
  variantes: number;
}

export async function cargarAgrupadores(db: DB, accountId: string): Promise<AgrupadorConocido[]> {
  const filas = await traerTodo<{ modelo: string | null; item_id: string | null }>(
    db,
    "skus",
    "modelo, item_id",
    (q) => q.eq("account_id", accountId).eq("activo", true).not("modelo", "is", null),
  );

  const porModelo = new Map<string, { items: Set<string>; variantes: number }>();
  for (const f of filas ?? []) {
    if (!f.modelo) continue;
    const g = porModelo.get(f.modelo) ?? { items: new Set<string>(), variantes: 0 };
    if (f.item_id) g.items.add(f.item_id);
    g.variantes++;
    porModelo.set(f.modelo, g);
  }

  return [...porModelo.entries()]
    .map(([modelo, g]) => ({ modelo, publicaciones: g.items.size, variantes: g.variantes }))
    .sort((a, b) => a.modelo.localeCompare(b.modelo));
}
