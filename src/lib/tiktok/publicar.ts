/**
 * Publicar en TikTok Shop los productos de calzado que ya están en Amazon.
 *
 * Motor PURO de la sección «Productos nuevos» de TikTok (pedido del dueño,
 * 30-sep-2026: «toma todos los productos que tengo en Amazon de calzado,
 * los SKUs, las imágenes, las variantes y todo; le pongo el precio y se me
 * publica masivamente en TikTok»). Aquí no hay red ni base: recibe las
 * filas de `amazon_listings`, lo que TikTok ya tiene y una PLANTILLA (un
 * producto que ya vive en la tienda) y devuelve qué se puede publicar y el
 * cuerpo exacto de `POST /product/202309/products`.
 *
 * Decisiones:
 *   · Un producto de TikTok por MODELO, con sus colores y tallas como
 *     variantes (como el padre de Amazon y como los 14 productos que la
 *     tienda ya tiene: «GT134-BLK-25-MX» y «GT134-BLK / RED-24-MX» son el
 *     mismo product_id). El precio es por producto: todas las tallas igual.
 *   · Los colores que TikTok ya vende de ese modelo NO se vuelven a
 *     publicar: se enseñan apagados y el producto nuevo lleva solo los
 *     colores que faltan.
 *   · La categoría, la marca, los atributos del producto, el peso y las
 *     medidas del paquete, y los IDs de los atributos de venta (Color y
 *     Talla) salen de la PLANTILLA: un producto de la tienda del mismo
 *     modelo si lo hay, si no cualquiera de calzado. TikTok exige IDs de
 *     atributo por categoría y no hay dónde inventarlos; copiar lo que la
 *     tienda ya aprobó es lo único que no se equivoca.
 *   · El seller_sku es el nombre con el que el ERP conoce el par
 *     (MODELO-COLOR-TALLA-MX, el SKU de MELI si existe), para que el amarre
 *     y el kardex lo reconozcan desde la primera venta. Amazon a veces
 *     escribe la talla antes del color (GT128-23-BLK-MX): se reordena.
 *   · El inventario con el que nace cada variante es lo que el ERP ya le
 *     PUBLICA a TikTok de ese SKU (`tiktok_inventario.publicado`); sin
 *     renglón en el kardex, cero. La sincronización lo corrige después.
 */

export interface FilaListingAmazon {
  sellerSku: string;
  asin: string | null;
  titulo: string | null;
  /** Active | Inactive | Incomplete | null */
  estado: string | null;
  precio: number | null;
  imagenUrl: string | null;
}

export interface TallaAmazon {
  talla: string;
  sellerSku: string;
  asin: string | null;
  estado: string | null;
  precio: number | null;
  /** El nombre con el que se publica en TikTok (y con el que el ERP lo conoce). */
  skuTikTok: string;
}

export interface ColorAmazon {
  color: string;
  /** Cómo se llama la variante en TikTok: el color en español. */
  nombre: string;
  /** false si el código no está en la lista y se publicaría tal cual. */
  traducido: boolean;
  tallas: TallaAmazon[];
  activas: number;
  imagenUrl: string | null;
  /** Tallas del color que ya se venden en TikTok (seller_sku de la tienda). */
  enTikTok: string[];
}

export interface ProductoAmazonParaTikTok {
  modelo: string;
  titulo: string;
  imagenUrl: string | null;
  colores: ColorAmazon[];
  skus: number;
  activas: number;
  /** El precio de lista más común entre las tallas activas de Amazon, de referencia. */
  precioAmazon: number | null;
  /** Colores que faltan en TikTok: lo que se publicaría. */
  coloresPorPublicar: string[];
  /**
   * De esos, los que tienen alguna talla ACTIVA en Amazon (lo que se publica
   * por omisión). Si NINGÚN color del modelo está activo en Amazon (GT265,
   * GT266: aún no se estrenan allá), van todos: el dueño los quiere en
   * TikTok de todos modos (30-sep-2026).
   */
  coloresActivosPorPublicar: string[];
  /** Colores que la tienda ya vende. */
  coloresEnTikTok: string[];
}

/** Lo que TikTok ya tiene de un seller_sku. */
export interface SkuEnTikTok {
  sellerSku: string | null;
  skuInterno: string | null;
  productId: string;
  estado: string | null;
}

export interface AliasColor {
  modelo: string;
  colorTikTok: string;
  colorAmazon: string;
}

const SUFIJOS_SITIO = new Set(["MX", "MLM", "ME", "MEX", "US", "MX1"]);

/**
 * MODELO, COLOR y TALLA de un SKU de Amazon, conservando cómo está escrito
 * el color ("DK BROWN", "BLK/RED"). Amazon a veces pone la talla antes del
 * color (GT128-23-BLK-MX): la talla es el ÚLTIMO pedazo numérico; si no hay,
 * el primero numérico después del modelo.
 */
export function partirSkuAmazon(sku: string): { modelo: string; color: string; talla: string } | null {
  const partes = String(sku ?? "")
    .split("-")
    .map((p) => p.trim())
    .filter(Boolean);
  while (partes.length > 2 && SUFIJOS_SITIO.has(partes[partes.length - 1].toUpperCase())) partes.pop();
  if (partes.length < 3) return null;
  const esTalla = (p: string) => /^\d{1,2}(\.\d)?$/.test(p);
  let idx = -1;
  for (let i = partes.length - 1; i > 0; i--) {
    if (esTalla(partes[i])) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return null;
  const color = partes
    .filter((_, i) => i > 0 && i !== idx)
    .join("-")
    .trim();
  if (!color) return null;
  return { modelo: partes[0].toUpperCase(), color: color.toUpperCase(), talla: partes[idx] };
}

/**
 * Un modelo de calzado: letras y número (GT134, MY2304, H816). Las fundas
 * de la misma cuenta de Amazon (499-IPAD10-BLK, 462-A9-BLK) no son de aquí.
 */
export function esModeloDeCalzado(modelo: string): boolean {
  return /^[A-Z]{1,5}\d{2,6}$/.test(String(modelo ?? "").trim().toUpperCase());
}

// ---------------------------------------------------------------------------
// Colores en español (pedido del dueño, 30-sep-2026: «los nombres de los
// colores se hagan en español»). El SKU conserva el código (BLK, DK BROWN);
// lo que el comprador ve en la variante de TikTok es el nombre.
// ---------------------------------------------------------------------------

const COLORES: Record<string, string> = {
  BLK: "Negro",
  BLACK: "Negro",
  NEGRO: "Negro",
  WHITE: "Blanco",
  "OFF WHITE": "Blanco hueso",
  BONE: "Hueso",
  IVORY: "Marfil",
  CREAM: "Crema",
  BEIGE: "Beige",
  SAND: "Arena",
  NUDE: "Color piel",
  TAN: "Canela",
  TAUPE: "Taupe",
  TOFFEE: "Toffee",
  CAMEL: "Camel",
  BROWN: "Café",
  COFFEE: "Café",
  MOCHA: "Moka",
  "M BROWN": "Café medio",
  "MEDIUM BROWN": "Café medio",
  // TikTok rechaza «tabaco» en el nombre de una variante (12052153 Policy
  // Violation «prohibited term `tabaco`», 30-sep-2026, GT169 y GT135).
  "TABACO BROWN": "Café tostado",
  TABACO: "Café tostado",
  TOBACCO: "Café tostado",
  "CHOCOLETTE BROWN": "Café chocolate",
  "CHOCOLATTE BROWN": "Café chocolate",
  "CHOCOLATE BROWN": "Café chocolate",
  CHOCOLATE: "Chocolate",
  GREY: "Gris",
  GRAY: "Gris",
  CHARCOAL: "Gris carbón",
  SMOKE: "Humo",
  SILVER: "Plateado",
  GOLD: "Dorado",
  "ROSE GOLD": "Oro rosa",
  BRONZE: "Bronce",
  COPPER: "Cobre",
  RED: "Rojo",
  WINE: "Vino",
  BURGUNDY: "Guinda",
  MAROON: "Granate",
  CORAL: "Coral",
  ORANGE: "Naranja",
  PEACH: "Durazno",
  APRICOT: "Chabacano",
  YELLOW: "Amarillo",
  MUSTARD: "Mostaza",
  CHAMPAGNE: "Champaña",
  GREEN: "Verde",
  "MILITARY GREEN": "Verde militar",
  "MILITARY/GREEN": "Verde militar",
  MILITARY: "Verde militar",
  OLIVE: "Verde olivo",
  KHAKI: "Caqui",
  MINT: "Menta",
  TEAL: "Verde azulado",
  TURQUOISE: "Turquesa",
  TURQOISE: "Turquesa",
  BLUE: "Azul",
  NAVY: "Azul marino",
  "ROYAL BLUE": "Azul rey",
  "STEEL BLUE": "Azul acero",
  "SKY BLUE": "Azul cielo",
  "GREY BLUE": "Gris azulado",
  "GREY/BLUE": "Gris azulado",
  DENIM: "Mezclilla",
  JEANS: "Mezclilla",
  PURPLE: "Morado",
  LILAC: "Lila",
  LAVENDER: "Lavanda",
  VIOLET: "Violeta",
  PINK: "Rosa",
  "HOT PINK": "Rosa fuerte",
  ROSE: "Rosa",
  FUCHSIA: "Fucsia",
  FUCSIA: "Fucsia",
  MAGENTA: "Magenta",
  LEOPARD: "Leopardo",
  ZEBRA: "Cebra",
  CAMO: "Camuflaje",
  "CAMO BLK": "Camuflaje negro",
  FLORAL: "Floral",
  FLOWER: "Floral",
  "ANIMAL PRINT": "Animal print",
  TRANSPARENT: "Transparente",
  CLEAR: "Transparente",
  NATURAL: "Natural",
  MULTICOLOR: "Multicolor",
  MULTI: "Multicolor",
};

const PREFIJOS_TONO: Record<string, string> = {
  DK: "oscuro",
  DARK: "oscuro",
  LT: "claro",
  LIGHT: "claro",
};

function traducirPedazo(pedazo: string): { nombre: string; traducido: boolean } {
  const limpio = pedazo.trim().toUpperCase().replace(/\s+/g, " ");
  if (!limpio) return { nombre: "", traducido: true };
  const directo = COLORES[limpio];
  if (directo) return { nombre: directo, traducido: true };
  const partes = limpio.split(" ");
  // «DK BROWN» → Café oscuro; «LIGHT GREY» → Gris claro.
  if (partes.length >= 2 && PREFIJOS_TONO[partes[0]]) {
    const base = COLORES[partes.slice(1).join(" ")];
    if (base) return { nombre: `${base} ${PREFIJOS_TONO[partes[0]]}`, traducido: true };
  }
  // «DK-BROWN» escrito con guion.
  const conGuion = limpio.replace(/-/g, " ");
  if (conGuion !== limpio) return traducirPedazo(conGuion);
  // Desconocido: se deja como está, en Capital.
  return { nombre: limpio.charAt(0) + limpio.slice(1).toLowerCase(), traducido: false };
}

/**
 * El nombre en español de un color de Amazon: "BLK" → "Negro", "DK BROWN"
 * → "Café oscuro", "BLK/RED" → "Negro / Rojo", "BLK / BLK" → "Negro". Lo
 * que no está en la lista se deja tal cual (en Capital) y `traducido`
 * avisa para que se agregue a la lista.
 */
export function nombreColorEspanol(color: string): { nombre: string; traducido: boolean } {
  const crudo = String(color ?? "").trim();
  if (!crudo) return { nombre: "", traducido: true };
  const directo = COLORES[crudo.toUpperCase().replace(/\s+/g, " ")];
  if (directo) return { nombre: directo, traducido: true };

  // Combinaciones: «BLK/RED», «NAVY / RED», «BLK-RED» (solo si cada pedazo es un color conocido).
  let pedazos = crudo.split(/\s*\/\s*/);
  if (pedazos.length === 1 && crudo.includes("-")) {
    const porGuion = crudo.split("-");
    if (porGuion.every((x) => traducirPedazo(x).traducido)) pedazos = porGuion;
  }
  const traducidos = pedazos.map(traducirPedazo).filter((x) => x.nombre);
  const nombres: string[] = [];
  for (const t of traducidos) if (nombres[nombres.length - 1] !== t.nombre) nombres.push(t.nombre);
  return { nombre: nombres.join(" / "), traducido: traducidos.every((x) => x.traducido) };
}

/** "GT134", "BLK / RED" → "GT134-BLK / RED": la llave de un color, sin importar separadores. */
export function claveColor(modelo: string, color: string): string {
  return `${normalizarPedazo(modelo)}|${normalizarPedazo(color)}`;
}

function normalizarPedazo(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

/** El seller_sku con el que se publica: MODELO-COLOR-TALLA-MX, o el de MELI si ya existe. */
export function skuParaTikTok(
  modelo: string,
  color: string,
  talla: string,
  skusMeli?: Map<string, string>,
): string {
  const propio = `${modelo}-${color}-${talla}-MX`;
  const deMeli = skusMeli?.get(claveVariante(modelo, color, talla));
  return deMeli ?? propio;
}

/** Llave de una variante sin importar orden ni separadores: para encontrar el SKU de MELI. */
export function claveVariante(modelo: string, color: string, talla: string): string {
  return `${normalizarPedazo(modelo)}|${normalizarPedazo(color)}|${String(talla).replace(/\.0$/, "")}`;
}

/** Índice de los SKUs de MELI por variante, para reusar su nombre exacto. */
export function indexarSkusMeli(skus: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of skus) {
    const p = partirSkuAmazon(s);
    if (!p) continue;
    const k = claveVariante(p.modelo, p.color, p.talla);
    if (!m.has(k)) m.set(k, s.trim());
  }
  return m;
}

/**
 * El título de Amazon trae al final la variante entre paréntesis
 * («… Suave al tacto (Fucsia, jp_footwear_size_system, toddler, women,
 * measurement, measurement_10_point_0_centimeters)»): fuera. Un
 * paréntesis legítimo del título («(2 pares)») se queda.
 */
export function tituloLimpio(titulo: string | null | undefined): string {
  let t = String(titulo ?? "").replace(/\s+/g, " ").trim();
  t = t.replace(/\s*\([^()]*(?:size_system|measurement|_point_|, [a-z_]+,)[^()]*\)\s*$/i, "").trim();
  return t;
}

const ORDEN_ESTADO: Record<string, number> = { Active: 0, Inactive: 1, Incomplete: 2 };

function tallaNumerica(t: string): number {
  const n = Number(t);
  return Number.isFinite(n) ? n : 999;
}

/**
 * Agrupa las filas de Amazon en productos (modelo → colores → tallas) y
 * marca lo que TikTok ya vende. Solo entra lo que tiene forma de calzado
 * (MODELO-COLOR-TALLA); el resto de Amazon no es de aquí.
 */
export function agruparProductosAmazon(
  filas: FilaListingAmazon[],
  opciones: {
    /** título limpio y foto del padre por ASIN hijo */
    padres?: Map<string, { titulo: string | null; imagenUrl: string | null }>;
    enTikTok?: SkuEnTikTok[];
    alias?: AliasColor[];
    skusMeli?: Map<string, string>;
  } = {},
): ProductoAmazonParaTikTok[] {
  const padres = opciones.padres ?? new Map();
  const skusMeli = opciones.skusMeli ?? new Map();

  // Colores que TikTok ya vende, por clave modelo|color de AMAZON (el alias
  // traduce el color que TikTok usa al de Amazon: MY2304 CAMEL = BROWN).
  const alias = new Map<string, string>();
  for (const a of opciones.alias ?? []) alias.set(claveColor(a.modelo, a.colorTikTok), a.colorAmazon);
  const vendidosEnTikTok = new Map<string, Set<string>>();
  for (const s of opciones.enTikTok ?? []) {
    // Un borrador o un producto apagado SIGUE existiendo en la tienda:
    // volverlo a publicar lo duplica. Solo lo borrado no cuenta.
    if (s.estado && /DELETED/i.test(s.estado)) continue;
    const nombre = s.skuInterno ?? s.sellerSku;
    const p = nombre ? partirSkuAmazon(nombre) : null;
    if (!p) continue;
    const colorAmazon = alias.get(claveColor(p.modelo, p.color)) ?? p.color;
    const k = claveColor(p.modelo, colorAmazon);
    if (!vendidosEnTikTok.has(k)) vendidosEnTikTok.set(k, new Set());
    vendidosEnTikTok.get(k)!.add(String(s.sellerSku ?? nombre));
  }

  interface Acum {
    modelo: string;
    titulos: Map<string, number>;
    tituloPadre: string | null;
    imagen: string | null;
    imagenActiva: boolean;
    colores: Map<string, { color: string; tallas: Map<string, TallaAmazon>; imagen: string | null; imagenActiva: boolean }>;
  }
  const porModelo = new Map<string, Acum>();

  for (const f of filas) {
    const p = partirSkuAmazon(f.sellerSku);
    if (!p || !esModeloDeCalzado(p.modelo)) continue;
    let m = porModelo.get(p.modelo);
    if (!m) {
      m = { modelo: p.modelo, titulos: new Map(), tituloPadre: null, imagen: null, imagenActiva: false, colores: new Map() };
      porModelo.set(p.modelo, m);
    }
    const padre = f.asin ? padres.get(f.asin) : undefined;
    if (padre?.titulo && !m.tituloPadre) m.tituloPadre = tituloLimpio(padre.titulo);
    const limpio = tituloLimpio(f.titulo);
    if (limpio) m.titulos.set(limpio, (m.titulos.get(limpio) ?? 0) + (f.estado === "Active" ? 10 : 1));
    const imagen = f.imagenUrl ?? padre?.imagenUrl ?? null;
    // La miniatura: la primera foto que aparezca, pero una de talla ACTIVA
    // le gana a una de talla apagada (la publicación viva es la que se ve).
    if (imagen && (!m.imagen || (f.estado === "Active" && !m.imagenActiva))) {
      m.imagen = imagen;
      m.imagenActiva = f.estado === "Active";
    }

    const kc = claveColor(p.modelo, p.color);
    let c = m.colores.get(kc);
    if (!c) {
      c = { color: p.color, tallas: new Map(), imagen: null, imagenActiva: false };
      m.colores.set(kc, c);
    }
    if (imagen && (!c.imagen || (f.estado === "Active" && !c.imagenActiva))) {
      c.imagen = imagen;
      c.imagenActiva = f.estado === "Active";
    }
    const kt = p.talla.replace(/\.0$/, "");
    const existente = c.tallas.get(kt);
    const fila: TallaAmazon = {
      talla: kt,
      sellerSku: f.sellerSku.trim(),
      asin: f.asin,
      estado: f.estado,
      precio: f.precio,
      skuTikTok: skuParaTikTok(p.modelo, p.color, kt, skusMeli),
    };
    // Dos SKUs para la misma talla (uno viejo Inactive, uno Active): gana el activo.
    if (!existente || (ORDEN_ESTADO[fila.estado ?? ""] ?? 9) < (ORDEN_ESTADO[existente.estado ?? ""] ?? 9)) {
      c.tallas.set(kt, fila);
    }
  }

  const salida: ProductoAmazonParaTikTok[] = [];
  for (const m of porModelo.values()) {
    const colores: ColorAmazon[] = [];
    for (const [kc, c] of m.colores) {
      const tallas = [...c.tallas.values()].sort((a, b) => tallaNumerica(a.talla) - tallaNumerica(b.talla));
      const esp = nombreColorEspanol(c.color);
      colores.push({
        color: c.color,
        nombre: esp.nombre,
        traducido: esp.traducido,
        tallas,
        activas: tallas.filter((t) => t.estado === "Active").length,
        imagenUrl: c.imagen,
        enTikTok: [...(vendidosEnTikTok.get(kc) ?? [])].sort(),
      });
    }
    colores.sort((a, b) => a.color.localeCompare(b.color, "es"));

    const precios = new Map<number, number>();
    for (const c of colores) {
      for (const t of c.tallas) {
        if (t.estado === "Active" && t.precio != null && t.precio > 0) precios.set(t.precio, (precios.get(t.precio) ?? 0) + 1);
      }
    }
    const precioAmazon = [...precios.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;

    const titulo = m.tituloPadre || [...m.titulos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || m.modelo;
    const porPublicar = colores.filter((c) => !c.enTikTok.length).map((c) => c.color);
    const activosPorPublicar = colores.filter((c) => !c.enTikTok.length && c.activas > 0).map((c) => c.color);
    const skus = colores.reduce((a, c) => a + c.tallas.length, 0);
    salida.push({
      modelo: m.modelo,
      titulo,
      imagenUrl: m.imagen,
      colores,
      skus,
      activas: colores.reduce((a, c) => a + c.activas, 0),
      precioAmazon,
      coloresPorPublicar: porPublicar,
      coloresActivosPorPublicar: activosPorPublicar.length ? activosPorPublicar : porPublicar,
      coloresEnTikTok: colores.filter((c) => c.enTikTok.length).map((c) => c.color),
    });
  }

  return salida.sort((a, b) => a.modelo.localeCompare(b.modelo, "es", { numeric: true }));
}

// ---------------------------------------------------------------------------
// Plantilla: lo que se copia de un producto que la tienda ya tiene
// ---------------------------------------------------------------------------

export interface AtributoVenta {
  id: string;
  name: string;
}

export interface PlantillaTikTok {
  productoId: string;
  titulo: string | null;
  categoryId: string;
  brandId: string | null;
  productAttributes: { id: string; values: { id: string; name: string }[] }[];
  packageWeight: { value: string; unit: string };
  packageDimensions: { length: string; width: string; height: string; unit: string } | null;
  atributoColor: AtributoVenta | null;
  atributoTalla: AtributoVenta | null;
  isCodAllowed: boolean | null;
}

/** Peso de respaldo cuando la plantilla no trae: un par de sandalias en su caja. */
export const PESO_POR_OMISION = { value: "0.8", unit: "KILOGRAM" };

/**
 * Saca de la respuesta cruda de `GET /product/202309/products/{id}` lo que
 * un producto nuevo tiene que copiar. La Talla es el atributo de venta
 * cuyos valores son números en casi todas las variantes; el Color, el otro.
 */
export function plantillaDesdeProducto(crudo: any): PlantillaTikTok {
  const cadena: any[] = crudo?.category_chains ?? [];
  const hoja = cadena.find((c) => c?.is_leaf) ?? cadena[cadena.length - 1];
  const categoryId = String(hoja?.id ?? crudo?.category_id ?? "");
  if (!categoryId) throw new Error("La plantilla no trae categoría.");

  const conteo = new Map<string, { name: string; total: number; numericos: number }>();
  for (const s of crudo?.skus ?? []) {
    for (const a of s?.sales_attributes ?? []) {
      const id = String(a?.id ?? "");
      if (!id) continue;
      const e = conteo.get(id) ?? { name: String(a?.name ?? ""), total: 0, numericos: 0 };
      e.total++;
      if (/^\d{1,2}(\.\d)?$/.test(String(a?.value_name ?? "").trim())) e.numericos++;
      if (!e.name && a?.name) e.name = String(a.name);
      conteo.set(id, e);
    }
  }
  let atributoTalla: AtributoVenta | null = null;
  let atributoColor: AtributoVenta | null = null;
  for (const [id, e] of conteo) {
    const esTalla = e.numericos >= Math.max(1, e.total / 2) || /talla|size/i.test(e.name);
    if (esTalla && !atributoTalla) atributoTalla = { id, name: e.name || "Talla" };
    else if (!esTalla && !atributoColor) atributoColor = { id, name: e.name || "Color" };
  }

  const peso = crudo?.package_weight;
  const dim = crudo?.package_dimensions;
  return {
    productoId: String(crudo?.id ?? ""),
    titulo: crudo?.title ?? null,
    categoryId,
    brandId: crudo?.brand?.id ? String(crudo.brand.id) : null,
    productAttributes: (crudo?.product_attributes ?? [])
      .filter((a: any) => a?.id && Array.isArray(a?.values) && a.values.length)
      .map((a: any) => ({
        id: String(a.id),
        values: a.values.map((v: any) => ({ id: String(v?.id ?? ""), name: String(v?.name ?? "") })),
      })),
    packageWeight:
      peso?.value != null && Number(peso.value) > 0
        ? { value: String(peso.value), unit: String(peso.unit ?? "KILOGRAM") }
        : PESO_POR_OMISION,
    packageDimensions:
      dim?.length != null && dim?.width != null && dim?.height != null
        ? { length: String(dim.length), width: String(dim.width), height: String(dim.height), unit: String(dim.unit ?? "CENTIMETER") }
        : null,
    atributoColor,
    atributoTalla,
    isCodAllowed: typeof crudo?.is_cod_allowed === "boolean" ? crudo.is_cod_allowed : null,
  };
}

/**
 * Los atributos de venta (Color y Talla) de la lista de atributos de la
 * categoría (`GET /product/202309/categories/{id}/attributes`): respaldo
 * cuando la plantilla no los trae (un producto de una sola talla).
 */
export function atributosDeVentaDeCategoria(atributos: any[]): { color: AtributoVenta | null; talla: AtributoVenta | null } {
  let color: AtributoVenta | null = null;
  let talla: AtributoVenta | null = null;
  for (const a of atributos ?? []) {
    if (String(a?.type ?? "") !== "SALES_PROPERTY") continue;
    const name = String(a?.name ?? "");
    const id = String(a?.id ?? "");
    if (!id) continue;
    if (!talla && /talla|size|tamaño/i.test(name)) talla = { id, name };
    else if (!color && /color/i.test(name)) color = { id, name };
  }
  return { color, talla };
}

// ---------------------------------------------------------------------------
// El cuerpo de la publicación
// ---------------------------------------------------------------------------

/** Lo que se le manda a TikTok por color: sus tallas y la foto de la variante. */
export interface ColorAPublicar {
  color: string;
  /** uri ya subido a TikTok (images/upload), para `sku_img` */
  imagenUri: string | null;
  tallas: { talla: string; sellerSku: string; cantidad: number }[];
}

export interface DatosPublicacion {
  titulo: string;
  descripcionHtml: string;
  precio: number;
  moneda: string;
  warehouseId: string;
  /** uris ya subidos, principal primero (máximo 9) */
  imagenesUri: string[];
  colores: ColorAPublicar[];
  borrador: boolean;
  /** La guía de tallas ya subida (uri), para `size_chart.image`. */
  guiaTallasUri?: string | null;
}

export const MAX_IMAGENES_PRINCIPALES = 9;
export const MAX_SKUS_POR_PRODUCTO = 100;
export const MAX_TITULO = 255;

/** Un título demasiado largo se corta en una palabra; uno vacío no se publica. */
export function tituloParaTikTok(titulo: string): string {
  const t = titulo.replace(/\s+/g, " ").trim();
  if (t.length <= MAX_TITULO) return t;
  const corte = t.lastIndexOf(" ", MAX_TITULO);
  return t.slice(0, corte > 40 ? corte : MAX_TITULO).trim();
}

function escaparHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * La descripción de TikTok desde la ficha de Amazon: los puntos clave como
 * párrafos y la descripción larga después. Sin nada, el título (TikTok no
 * acepta una descripción vacía).
 */
export function descripcionDesdeAmazon(datos: {
  bullets: string[];
  descripcion: string | null;
  titulo: string;
  /** El párrafo de la guía de tallas (`textoGuiaTallas`), al final. */
  guiaTallas?: string;
}): string {
  const partes: string[] = [];
  for (const b of datos.bullets) {
    const t = String(b ?? "").replace(/\s+/g, " ").trim();
    if (t) partes.push(`<p>${escaparHtml(t)}</p>`);
  }
  const d = String(datos.descripcion ?? "").replace(/\s+/g, " ").trim();
  if (d) partes.push(`<p>${escaparHtml(d)}</p>`);
  if (!partes.length) partes.push(`<p>${escaparHtml(datos.titulo)}</p>`);
  const g = String(datos.guiaTallas ?? "").trim();
  if (g) partes.push(`<p>${escaparHtml(g)}</p>`);
  return partes.join("");
}

/**
 * El cuerpo de `POST /product/202309/products`. Lanza si falta algo sin lo
 * que TikTok lo va a rechazar de todos modos (sin imágenes, sin tallas, sin
 * atributo de talla, más de 100 variantes).
 */
export function armarCuerpoProducto(datos: DatosPublicacion, plantilla: PlantillaTikTok): Record<string, unknown> {
  const titulo = tituloParaTikTok(datos.titulo);
  if (!titulo) throw new Error("El producto no tiene título.");
  if (!datos.imagenesUri.length) throw new Error("No se pudo subir ninguna imagen del producto.");
  if (!plantilla.atributoTalla) throw new Error("La plantilla no tiene atributo de talla: no hay cómo armar las variantes.");
  if (!(datos.precio > 0)) throw new Error("El precio tiene que ser mayor a cero.");
  if (!datos.warehouseId) throw new Error("La tienda no tiene bodega configurada en TikTok.");

  const variosColores = datos.colores.length > 1;
  if (variosColores && !plantilla.atributoColor) {
    throw new Error("La plantilla no tiene atributo de color y el producto lleva varios colores.");
  }

  const skus: Record<string, unknown>[] = [];
  for (const c of datos.colores) {
    for (const t of c.tallas) {
      const sales: Record<string, unknown>[] = [];
      if (plantilla.atributoColor) {
        const attr: Record<string, unknown> = {
          id: plantilla.atributoColor.id,
          name: plantilla.atributoColor.name,
          value_name: nombreColorEspanol(c.color).nombre || c.color,
        };
        if (c.imagenUri) attr.sku_img = { uri: c.imagenUri };
        sales.push(attr);
      }
      sales.push({ id: plantilla.atributoTalla.id, name: plantilla.atributoTalla.name, value_name: t.talla });
      skus.push({
        sales_attributes: sales,
        seller_sku: t.sellerSku,
        price: { amount: datos.precio.toFixed(2), currency: datos.moneda },
        inventory: [{ warehouse_id: datos.warehouseId, quantity: Math.max(0, Math.floor(t.cantidad)) }],
      });
    }
  }
  if (!skus.length) throw new Error("El producto no tiene tallas que publicar.");
  if (skus.length > MAX_SKUS_POR_PRODUCTO) {
    throw new Error(`TikTok acepta hasta ${MAX_SKUS_POR_PRODUCTO} variantes por producto y este lleva ${skus.length}: publícalo por colores.`);
  }

  const cuerpo: Record<string, unknown> = {
    title: titulo,
    description: datos.descripcionHtml,
    category_id: plantilla.categoryId,
    main_images: datos.imagenesUri.slice(0, MAX_IMAGENES_PRINCIPALES).map((uri) => ({ uri })),
    skus,
    package_weight: plantilla.packageWeight,
    // TikTok: «SaveMode is invalid, allowed values: LISTING,AS_DRAFT»
    // (30-sep-2026; el SDK decía DRAFT).
    save_mode: datos.borrador ? "AS_DRAFT" : "LISTING",
  };
  if (plantilla.brandId) cuerpo.brand_id = plantilla.brandId;
  if (plantilla.productAttributes.length) cuerpo.product_attributes = plantilla.productAttributes;
  if (plantilla.packageDimensions) cuerpo.package_dimensions = plantilla.packageDimensions;
  if (plantilla.isCodAllowed != null) cuerpo.is_cod_allowed = plantilla.isCodAllowed;
  if (datos.guiaTallasUri) cuerpo.size_chart = { image: { uri: datos.guiaTallasUri } };
  return cuerpo;
}

/**
 * Las fotos principales del producto: la primera de cada color (para que
 * se vean todos) y luego las demás del primer color, hasta 9, sin repetir.
 */
export function elegirImagenesPrincipales(porColor: string[][]): string[] {
  const salida: string[] = [];
  const meter = (u: string) => {
    if (u && !salida.includes(u) && salida.length < MAX_IMAGENES_PRINCIPALES) salida.push(u);
  };
  for (const fotos of porColor) if (fotos[0]) meter(fotos[0]);
  for (const fotos of porColor) for (const u of fotos.slice(1)) meter(u);
  return salida;
}

/** Lo que contestó TikTok al crear: product_id y los sku_id por seller_sku. */
export function interpretarRespuestaCreacion(d: any): { productId: string; skus: { skuId: string; sellerSku: string | null }[]; avisos: string[] } {
  const productId = String(d?.product_id ?? "");
  if (!productId) throw new Error("TikTok no devolvió product_id.");
  return {
    productId,
    skus: (d?.skus ?? []).map((s: any) => ({ skuId: String(s?.id ?? ""), sellerSku: s?.seller_sku ? String(s.seller_sku) : null })),
    avisos: (d?.warnings ?? []).map((w: any) => String(w?.message ?? "")).filter(Boolean),
  };
}
