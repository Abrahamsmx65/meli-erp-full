/**
 * Publicar productos NUEVOS de calzado en Mercado Libre (motor puro).
 *
 * Pedido del dueño, 12-nov-2026: «te pongo título, SKU, colores, tallas,
 * categoría, precio de lista y me lo publicas». Calcado de las últimas
 * publicaciones hechas a mano (GT304…GT330, revisadas ese día contra
 * /items/{id}): la cuenta publica con el modelo de USER PRODUCTS, así que
 *
 *  - cada color + talla es UNA publicación (sin `variations`), y MELI las
 *    junta en la misma página por `family_name` (el título SIN color ni
 *    talla; MELI arma «… Negro 25 Mx» solo);
 *  - la talla exige la GUÍA DE TALLAS: `SIZE_GRID_ID` y la fila de esa talla
 *    (`SIZE_GRID_ROW_ID`, «260076:3» = 25 MX), que dependen de la categoría
 *    y el género;
 *  - la categoría pide atributos propios (género, materiales, estilo, tipo
 *    de caña…), la marca, la garantía y las medidas del paquete.
 *
 * Todo eso NO se le pregunta al dueño: se COPIA de una publicación reciente
 * de la misma categoría (la «ficha»), y él solo corrige lo que cambie. Las
 * fotos sí son nuevas: por color.
 */

/** Atributo de una publicación tal como lo entrega MELI. */
export interface AtributoMeli {
  id?: string;
  name?: string;
  value_id?: string | null;
  value_name?: string | null;
  value_type?: string;
  values?: { id?: string | null; name?: string | null }[];
  tags?: Record<string, unknown>;
}

export interface ItemMeli {
  id?: string;
  title?: string;
  family_name?: string | null;
  category_id?: string;
  price?: number;
  listing_type_id?: string;
  official_store_id?: number | null;
  attributes?: AtributoMeli[];
  sale_terms?: AtributoMeli[];
  pictures?: { id?: string; secure_url?: string }[];
}

export interface GuiaMeli {
  id?: string;
  names?: Record<string, string>;
  rows?: { id?: string; attributes?: { id?: string; values?: { name?: string; struct?: { number?: number } | null }[] }[] }[];
}

export interface AtributoFicha {
  id: string;
  nombre: string;
  /** id del valor en MELI; null = texto libre. */
  valorId: string | null;
  valor: string;
  /** Valores que MELI ofrece para este atributo (si los tiene). */
  opciones: { id: string; nombre: string }[];
  requerido: boolean;
}

export interface FilaGuia {
  rowId: string;
  /** «25», «24.5»: como va en el SKU. */
  talla: string;
  /** «25 MX»: como lo escribe MELI. */
  nombre: string;
}

/** Lo que se copia de una publicación ya hecha. */
export interface FichaPlantilla {
  modelo: string;
  itemId: string;
  categoriaId: string;
  categoriaNombre: string;
  titulo: string;
  precio: number | null;
  listingTypeId: string;
  officialStoreId: number | null;
  gridId: string | null;
  guiaNombre: string;
  filas: FilaGuia[];
  atributos: AtributoFicha[];
  saleTerms: { id: string; value_name: string }[];
  descripcion: string;
  maxTitulo: number;
  /**
   * Fotos de la publicación copiada: van «de mientras» en los colores que
   * no traen fotos propias (así se hicieron a mano GT305–GT311: con las
   * fotos de otro modelo hasta tener las suyas). Dueño, 12-nov-2026.
   */
  fotos: { id: string; url: string }[];
}

export interface ColorPedido {
  /** Código del SKU: BLK, DK BROWN. */
  codigo: string;
  /** Como lo ve el cliente: Negro, Café oscuro. */
  nombre: string;
  /** Ids de fotos ya subidas a MELI. */
  fotos: string[];
}

export interface PedidoPublicacion {
  modelo: string;
  titulo: string;
  precio: number;
  descripcion: string;
  /** Dejarlas pausadas al crearlas (así están las hechas a mano: se activan al llegar a Full). */
  pausar: boolean;
  colores: ColorPedido[];
  tallas: string[];
  ficha: Pick<
    FichaPlantilla,
    "categoriaId" | "listingTypeId" | "officialStoreId" | "gridId" | "filas" | "atributos" | "saleTerms" | "maxTitulo" | "fotos"
  >;
}

export interface VariantePorPublicar {
  sku: string;
  color: string;
  nombreColor: string;
  talla: string;
  nombreTalla: string;
  rowId: string | null;
}

/**
 * Atributos que NO se copian de la ficha: son de cada variante (color,
 * talla, SKU), los pone MELI solo (medidas que mide Full, filtros) o MELI
 * los rechaza por no modificables (visto en /items/validate).
 */
export const ATRIBUTOS_NO_COPIABLES = new Set([
  "COLOR",
  "MAIN_COLOR",
  "SIZE",
  "SIZE_GRID_ID",
  "SIZE_GRID_ROW_ID",
  "SELLER_SKU",
  "MODEL",
  "DETAILED_MODEL",
  "GTIN",
  "EMPTY_GTIN_REASON",
  "PACKAGE_HEIGHT",
  "PACKAGE_WIDTH",
  "PACKAGE_LENGTH",
  "PACKAGE_WEIGHT",
  "PACKAGE_DATA_SOURCE",
  "FILTRABLE_GENDER",
  "FILTRABLE_SIZE",
  "ITEM_CONDITION",
  "PRODUCT_FEATURES",
  "SHIPMENT_PACKING",
  "WITH_VIRTUAL_TRY_ON",
  "IMPORT_DECLARATION_NUMBER",
  "AGE_GROUP",
  "AGID",
  "MPN",
  "FOOT_WIDTH",
]);

const limpio = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

/** «gt 331» → «GT331». */
export function normalizarModelo(modelo: string): string {
  return limpio(modelo).toUpperCase().replace(/\s+/g, "");
}

/** «dk  brown» → «DK BROWN». */
export function normalizarColor(color: string): string {
  return limpio(color).toUpperCase();
}

/** «25 MX», «24,5» → «25», «24.5». */
export function normalizarTalla(talla: string): string {
  const m = limpio(talla).replace(",", ".").match(/\d+(?:\.\d+)?/);
  return m ? String(Number(m[0])) : "";
}

/** El SKU con que el ERP y la bodega conocen el par: GT312-BLK-25-MX. */
export function skuDeVariante(modelo: string, color: string, talla: string): string {
  return `${normalizarModelo(modelo)}-${normalizarColor(color)}-${normalizarTalla(talla)}-MX`;
}

/** «23-28», «23 24 25», «23,24» → tallas sueltas (los rangos, de una en una). */
export function tallasDeTexto(texto: string): string[] {
  const salida: string[] = [];
  for (const pedazo of limpio(texto).split(/[\s,;]+/)) {
    if (!pedazo) continue;
    const rango = pedazo.match(/^(\d+)\s*[-–a]\s*(\d+)$/i);
    if (rango) {
      const [a, b] = [Number(rango[1]), Number(rango[2])];
      if (b >= a && b - a <= 30) for (let t = a; t <= b; t++) salida.push(String(t));
      continue;
    }
    const t = normalizarTalla(pedazo);
    if (t) salida.push(t);
  }
  return [...new Set(salida)];
}

/** Las filas de la guía de tallas: «260076:3» ↔ 25 MX. */
export function filasDeGuia(guia: GuiaMeli | null | undefined): FilaGuia[] {
  const filas: FilaGuia[] = [];
  for (const r of guia?.rows ?? []) {
    const v = (r.attributes ?? []).find((a) => a.id === "SIZE")?.values?.[0];
    const nombre = limpio(v?.name);
    const talla = v?.struct?.number != null ? String(v.struct.number) : normalizarTalla(nombre);
    if (r.id && talla && nombre) filas.push({ rowId: r.id, talla, nombre });
  }
  return filas;
}

function valorDe(a: AtributoMeli): { id: string | null; nombre: string } {
  const v = a.values?.[0];
  const id = a.value_id ?? v?.id ?? null;
  const nombre = limpio(a.value_name ?? v?.name);
  return { id: id != null && id !== "" ? String(id) : null, nombre };
}

/**
 * Arma la ficha copiable de una publicación ya hecha: sus atributos (sin
 * los de la variante), la garantía, el tipo de publicación y la guía de
 * tallas. Los atributos obligatorios de la categoría que la publicación no
 * trae se agregan vacíos, para que se llenen.
 */
export function fichaDeItem(
  modelo: string,
  item: ItemMeli,
  atributosCategoria: AtributoMeli[],
  guia: GuiaMeli | null,
  extra: { categoriaNombre: string; descripcion: string; maxTitulo: number },
): FichaPlantilla {
  const porId = new Map(atributosCategoria.filter((a) => a.id).map((a) => [a.id as string, a]));
  const noVa = (id: string) => {
    if (ATRIBUTOS_NO_COPIABLES.has(id)) return true;
    const tags = porId.get(id)?.tags ?? {};
    return tags.read_only === true;
  };
  const opcionesDe = (id: string) =>
    (porId.get(id)?.values ?? [])
      .filter((v) => v.id != null && v.name)
      .map((v) => ({ id: String(v.id), nombre: String(v.name) }));
  const requerido = (id: string) => {
    const tags = porId.get(id)?.tags ?? {};
    return tags.required === true || tags.catalog_required === true;
  };

  const atributos: AtributoFicha[] = [];
  const vistos = new Set<string>();
  for (const a of item.attributes ?? []) {
    if (!a.id || noVa(a.id) || vistos.has(a.id)) continue;
    const v = valorDe(a);
    // «No aplica» (-1) sí se copia: MELI lo cuenta como ficha completa.
    if (!v.nombre && v.id !== "-1") continue;
    vistos.add(a.id);
    atributos.push({
      id: a.id,
      nombre: limpio(a.name) || a.id,
      valorId: v.id,
      valor: v.id === "-1" ? "No aplica" : v.nombre,
      opciones: opcionesDe(a.id),
      requerido: requerido(a.id),
    });
  }
  for (const a of atributosCategoria) {
    if (!a.id || vistos.has(a.id) || noVa(a.id) || !requerido(a.id)) continue;
    atributos.push({ id: a.id, nombre: limpio(a.name) || a.id, valorId: null, valor: "", opciones: opcionesDe(a.id), requerido: true });
  }

  const grid = (item.attributes ?? []).find((a) => a.id === "SIZE_GRID_ID");
  return {
    modelo: normalizarModelo(modelo),
    itemId: item.id ?? "",
    categoriaId: item.category_id ?? "",
    categoriaNombre: extra.categoriaNombre,
    titulo: limpio(item.family_name) || limpio(item.title),
    precio: typeof item.price === "number" ? item.price : null,
    listingTypeId: item.listing_type_id || "gold_special",
    officialStoreId: item.official_store_id ?? null,
    gridId: grid ? valorDe(grid).nombre || null : null,
    guiaNombre: limpio(guia?.names?.MLM) || "",
    filas: filasDeGuia(guia),
    atributos,
    saleTerms: (item.sale_terms ?? [])
      .map((s) => ({ id: s.id ?? "", value_name: valorDe(s).nombre }))
      .filter((s) => s.id && s.value_name),
    descripcion: extra.descripcion,
    maxTitulo: extra.maxTitulo,
    fotos: (item.pictures ?? [])
      .filter((f) => f.id)
      .map((f) => ({ id: f.id as string, url: f.secure_url ?? "" })),
  };
}

/** Color × talla, con su SKU y su fila de la guía. */
export function variantesDePedido(p: PedidoPublicacion): VariantePorPublicar[] {
  const filas = new Map(p.ficha.filas.map((f) => [f.talla, f]));
  const salida: VariantePorPublicar[] = [];
  const vistos = new Set<string>();
  for (const c of p.colores) {
    const color = normalizarColor(c.codigo);
    if (!color) continue;
    for (const t of p.tallas) {
      const talla = normalizarTalla(t);
      if (!talla) continue;
      const sku = skuDeVariante(p.modelo, color, talla);
      if (vistos.has(sku)) continue;
      vistos.add(sku);
      const fila = filas.get(talla);
      salida.push({
        sku,
        color,
        nombreColor: limpio(c.nombre),
        talla,
        nombreTalla: fila?.nombre ?? `${talla} MX`,
        rowId: fila?.rowId ?? null,
      });
    }
  }
  return salida;
}

/** Lo que falta para poder publicar; vacío = listo. */
export function faltantesDePedido(p: PedidoPublicacion): string[] {
  const f: string[] = [];
  const modelo = normalizarModelo(p.modelo);
  if (!/^[A-Z]{1,4}\d{2,5}[A-Z]?(-\d+)?$/.test(modelo)) f.push("El modelo no parece un modelo (GT331).");
  const titulo = limpio(p.titulo);
  if (titulo.length < 10) f.push("Falta el título.");
  if (titulo.length > (p.ficha.maxTitulo || 60)) f.push(`El título pasa de ${p.ficha.maxTitulo || 60} caracteres (lleva ${titulo.length}).`);
  if (!(p.precio > 0)) f.push("Falta el precio.");
  if (!p.ficha.categoriaId) f.push("Falta la categoría (elige de qué modelo se copia la ficha).");
  if (!p.colores.length) f.push("Falta al menos un color.");
  if (!p.tallas.length) f.push("Falta al menos una talla.");
  const codigos = new Set<string>();
  for (const c of p.colores) {
    const codigo = normalizarColor(c.codigo);
    if (!codigo) f.push("Hay un color sin código.");
    else if (codigos.has(codigo)) f.push(`El color ${codigo} está repetido.`);
    codigos.add(codigo);
    if (codigo.includes("-")) f.push(`El color ${codigo} lleva guion: el SKU se parte por guiones, usa espacio.`);
    if (!limpio(c.nombre)) f.push(`Falta el nombre en español del color ${codigo}.`);
    if (!c.fotos.length && !p.ficha.fotos.length) f.push(`El color ${codigo || "?"} no tiene fotos y la ficha copiada tampoco.`);
  }
  if (!p.ficha.gridId) f.push("La ficha no trae guía de tallas: copia de otro modelo de la misma categoría.");
  else {
    const filas = new Set(p.ficha.filas.map((x) => x.talla));
    const fuera = [...new Set(p.tallas.map(normalizarTalla))].filter((t) => t && !filas.has(t));
    if (fuera.length) f.push(`La guía de tallas no tiene: ${fuera.join(", ")}.`);
  }
  for (const a of p.ficha.atributos) {
    if (a.requerido && !limpio(a.valor)) f.push(`Falta «${a.nombre}» (MELI lo exige en esta categoría).`);
  }
  return [...new Set(f)];
}

function atributoParaMeli(a: AtributoFicha): Record<string, unknown> | null {
  const valor = limpio(a.valor);
  if (a.valorId === "-1") return { id: a.id, value_id: "-1" };
  if (!valor) return null;
  // Con id y nombre: solo el id no basta en algunos (MATERIALS, visto en /items/validate).
  return a.valorId ? { id: a.id, value_id: a.valorId, value_name: valor } : { id: a.id, value_name: valor };
}

/** El cuerpo de `POST /items` de UNA variante (una publicación por color + talla). */
export function cuerpoDeVariante(p: PedidoPublicacion, v: VariantePorPublicar): Record<string, unknown> {
  const color = p.colores.find((c) => normalizarColor(c.codigo) === v.color);
  const atributos: Record<string, unknown>[] = [];
  for (const a of p.ficha.atributos) {
    const x = atributoParaMeli(a);
    if (x) atributos.push(x);
  }
  atributos.push(
    { id: "MODEL", value_name: normalizarModelo(p.modelo) },
    { id: "COLOR", value_name: v.nombreColor },
    { id: "SIZE", value_name: v.nombreTalla },
    { id: "SELLER_SKU", value_name: v.sku },
  );
  if (p.ficha.gridId) atributos.push({ id: "SIZE_GRID_ID", value_name: p.ficha.gridId });
  if (v.rowId) atributos.push({ id: "SIZE_GRID_ROW_ID", value_name: v.rowId });

  const cuerpo: Record<string, unknown> = {
    family_name: limpio(p.titulo),
    category_id: p.ficha.categoriaId,
    price: p.precio,
    currency_id: "MXN",
    available_quantity: 1,
    buying_mode: "buy_it_now",
    condition: "new",
    listing_type_id: p.ficha.listingTypeId || "gold_special",
    // Sin fotos propias del color, las de la ficha copiada (de mientras).
    pictures: (color?.fotos.length ? color.fotos : p.ficha.fotos.map((f) => f.id)).map((id) => ({ id })),
    sale_terms: p.ficha.saleTerms,
    shipping: { mode: "me2", free_shipping: true, local_pick_up: false },
    attributes: atributos,
  };
  if (p.ficha.officialStoreId) cuerpo.official_store_id = p.ficha.officialStoreId;
  // Nace pausada si MELI lo respeta (el validador no lo objeta); si no, el servicio la pausa en seguida.
  if (p.pausar) cuerpo.status = "paused";
  return cuerpo;
}

/**
 * Los ERRORES de una respuesta de MELI (`cause[]` con type error), en
 * limpio. Las advertencias (envío gratis obligatorio, atributo ignorado)
 * no cuentan.
 */
export function erroresDeMeli(cuerpo: unknown): string[] {
  if (!cuerpo || typeof cuerpo !== "object") return [];
  const c = cuerpo as { cause?: unknown; message?: unknown; error?: unknown };
  const causas = Array.isArray(c.cause) ? (c.cause as Record<string, unknown>[]) : [];
  const errores = causas
    .filter((x) => x && x.type !== "warning")
    .map((x) => limpio(x.message) || limpio(x.code))
    .filter(Boolean);
  if (errores.length) return [...new Set(errores)];
  // Solo advertencias: no hay error (el validador igual contesta 400 «Validation error»).
  if (causas.length) return [];
  const general = limpio(c.message) || limpio(c.error);
  return general ? [general] : [];
}

/**
 * El validador de MELI contesta 400 aunque solo traiga ADVERTENCIAS (envío
 * gratis obligatorio, «User has not mode me1»; visto el 12-nov-2026 con un
 * cuerpo que sí se puede publicar): eso cuenta como aceptado.
 */
export function soloAdvertencias(cuerpo: unknown): boolean {
  const causas = (cuerpo as { cause?: unknown } | null)?.cause;
  return Array.isArray(causas) && causas.length > 0 && causas.every((x) => (x as { type?: string })?.type === "warning");
}

export type EstadoVariante = "pendiente" | "publicada" | "ya_existe" | "error";

export interface VarianteGuardada extends VariantePorPublicar {
  estado: EstadoVariante;
  itemId: string | null;
  error: string | null;
  /** Avisos que no impiden la publicación (no se pudo pausar, la descripción no entró). */
  aviso: string | null;
}

export function resumenDeVariantes(vs: VarianteGuardada[]): { total: number; publicadas: number; errores: number; pendientes: number; yaExisten: number } {
  return {
    total: vs.length,
    publicadas: vs.filter((v) => v.estado === "publicada").length,
    errores: vs.filter((v) => v.estado === "error").length,
    pendientes: vs.filter((v) => v.estado === "pendiente").length,
    yaExisten: vs.filter((v) => v.estado === "ya_existe").length,
  };
}
