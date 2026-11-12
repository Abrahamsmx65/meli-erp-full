/**
 * Crear productos NUEVOS de calzado en Amazon (motor puro).
 *
 * Pedido del dueño, 12-nov-2026: «revisa lo de Amazon para que podamos
 * crear también en Amazon». Calcado de publicaciones reales leídas ese día
 * con una sonda (GT303, GT312, GT330, GT337):
 *
 *  - tipo de producto SHOES, SANDAL o BOOT; un PADRE (sin oferta) y un HIJO
 *    por color + talla, con tema de variación SIZE/COLOR;
 *  - la talla va en centímetros: `footwear_size.size =
 *    measurement_26_point_0_centimeters` (sistema «JP», que es la talla MX);
 *  - el color lleva nombre y color base (`standardized_values`);
 *  - la marca tiene EXENCIÓN de código de barras
 *    (`supplier_declared_has_product_identifier_exemption`): no hay UPC;
 *  - van por FBA (`fulfillment_availability: AMAZON_NA`) y se crean SIN
 *    fotos (Amazon las deja suprimidas de la búsqueda hasta tenerlas).
 *
 * Igual que en MELI, lo que el dueño no teclea se COPIA de una publicación
 * ya hecha (la «ficha»): los atributos del hijo y del padre de un modelo
 * parecido, quitando lo que es de cada variante. Probado contra Amazon en
 * modo VALIDATION_PREVIEW (no crea nada): padre e hijo salieron VALID.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Atributos = Record<string, any[]>;

/** Lo que es de cada publicación y NO se copia de la ficha. */
export const NO_COPIABLES = [
  "merchant_suggested_asin",
  "externally_assigned_product_identifier",
  "product_site_launch_date",
  "item_name",
  "model_name",
  "model_number",
  "color",
  "footwear_size",
  "child_parent_sku_relationship",
  "parentage_level",
  "list_price",
  "purchasable_offer",
  "bullet_point",
  "product_description",
  "generic_keyword",
  "fulfillment_availability",
];

/** Solo del hijo: el padre no lleva oferta ni medidas de variante. */
const SOLO_DEL_HIJO = ["size", "item_weight", "item_package_weight", "item_package_dimensions"];

export interface AtributoSimple {
  clave: string;
  /** Un valor por renglón del atributo («Trabajo», «Uso diario»…). */
  valores: string[];
}

export interface FichaAmazon {
  modelo: string;
  /** SKU del hijo y del padre de donde se copió. */
  skuHijo: string;
  skuPadre: string | null;
  productType: string;
  marketplaceId: string;
  titulo: string;
  precio: number | null;
  vinetas: string[];
  descripcion: string;
  palabras: string;
  /** Género y grupo de edad de la talla, tal como los trae la ficha. */
  talla: { gender?: string; age_group?: string; size_class?: string; size_system?: string };
  /** Atributos copiables del hijo y del padre, ya sin lo de la variante. */
  hijo: Atributos;
  padre: Atributos;
  /** Los atributos de texto sencillo del hijo, para corregirlos en pantalla. */
  simples: AtributoSimple[];
}

export interface ColorAmazon {
  codigo: string;
  nombre: string;
}

export interface PedidoAmazon {
  modelo: string;
  titulo: string;
  precio: number;
  colores: ColorAmazon[];
  tallas: string[];
  vinetas: string[];
  descripcion: string;
  palabras: string;
  simples: AtributoSimple[];
  ficha: Pick<FichaAmazon, "productType" | "marketplaceId" | "talla" | "hijo" | "padre">;
}

export interface VarianteAmazon {
  sku: string;
  color: string;
  nombreColor: string;
  talla: string;
  /** El padre va primero en la lista, sin color ni talla. */
  esPadre: boolean;
}

const limpio = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function normalizarModelo(modelo: string): string {
  return limpio(modelo).toUpperCase().replace(/\s+/g, "");
}

export function normalizarTalla(talla: string): string {
  const m = limpio(talla).replace(",", ".").match(/\d+(?:\.\d+)?/);
  return m ? String(Number(m[0])) : "";
}

/** El SKU del padre: Seller Central los genera al azar («N7-1OOE-UVDP»); aquí se llama por su modelo. */
export function skuPadre(modelo: string): string {
  return `${normalizarModelo(modelo)}-PADRE`;
}

export function skuHijo(modelo: string, color: string, talla: string): string {
  return `${normalizarModelo(modelo)}-${limpio(color).toUpperCase()}-${normalizarTalla(talla)}-MX`;
}

/** «24.5» → «measurement_24_point_5_centimeters». */
export function tallaAmazon(talla: string): string {
  const n = Number(normalizarTalla(talla));
  const entero = Math.floor(n);
  const decimal = Math.round((n - entero) * 10);
  return `measurement_${entero}_point_${decimal}_centimeters`;
}

const COLORES_BASE: [RegExp, string][] = [
  [/negro/, "Negro"],
  [/cafe|marron|chocolate|camel|camello|tabaco|cognac|miel|tostado|canela/, "Marrón"],
  [/beige|crema|arena|nude|piel|hueso|marfil|caqui|kaki/, "Beige"],
  [/blanco/, "Blanco"],
  [/azul|marino|mezclilla/, "Azul"],
  [/rojo|vino|tinto|guinda/, "Rojo"],
  [/rosa|fucsia/, "Rosado"],
  [/verde|olivo|militar/, "Verde"],
  [/gris|plomo/, "Gris"],
  [/morado|lila|violeta/, "Morado"],
  [/amarillo|mostaza/, "Amarillo"],
  [/naranja/, "Naranja"],
  [/dorado|oro/, "Dorado"],
  [/plateado|plata/, "Plateado"],
  [/turquesa/, "Turquesa"],
];

/** El color base de Amazon («Mapa de color») para un nombre: «Café oscuro» → «Marrón». */
export function colorBase(nombre: string): string {
  const n = sinAcentos(limpio(nombre));
  if (n.includes("/")) return "Multicolor";
  for (const [re, base] of COLORES_BASE) if (re.test(n)) return base;
  return limpio(nombre);
}

/**
 * Un atributo es «sencillo» si cada renglón es solo un texto CON su idioma:
 * los que no llevan idioma (`target_gender: male`) son listas cerradas de
 * Amazon y no se tocan.
 */
function esSimple(valor: unknown): boolean {
  if (!Array.isArray(valor) || !valor.length) return false;
  return valor.every((x) => {
    if (!x || typeof x !== "object" || !("language_tag" in x)) return false;
    const claves = Object.keys(x).filter((k) => k !== "language_tag" && k !== "marketplace_id");
    return claves.length === 1 && claves[0] === "value" && typeof (x as { value: unknown }).value === "string";
  });
}

const textos = (valor: unknown): string[] =>
  Array.isArray(valor) ? valor.map((x) => limpio((x as { value?: unknown })?.value)).filter(Boolean) : [];

function copiables(attrs: Atributos, quitar: string[]): Atributos {
  const salida: Atributos = {};
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (quitar.includes(k) || /image_locator/.test(k)) continue;
    if (Array.isArray(v)) salida[k] = v;
  }
  return salida;
}

/** Arma la ficha copiable a partir del hijo y el padre leídos de Amazon. */
export function fichaDeAmazon(
  modelo: string,
  skuDelHijo: string,
  hijo: { attributes?: Atributos; summaries?: { productType?: string }[] },
  padre: { sku: string; attributes?: Atributos } | null,
  marketplaceId: string,
): FichaAmazon {
  const a = hijo.attributes ?? {};
  const talla = (a.footwear_size?.[0] ?? {}) as Record<string, string>;
  const precio = a.purchasable_offer?.[0]?.our_price?.[0]?.schedule?.[0]?.value_with_tax ?? a.list_price?.[0]?.value_with_tax;
  const copiaHijo = copiables(a, NO_COPIABLES);
  return {
    modelo: normalizarModelo(modelo),
    skuHijo: skuDelHijo,
    skuPadre: padre?.sku ?? null,
    productType: hijo.summaries?.[0]?.productType ?? "SHOES",
    marketplaceId,
    titulo: textos(a.item_name)[0] ?? "",
    precio: typeof precio === "number" ? precio : null,
    vinetas: textos(a.bullet_point),
    descripcion: textos(a.product_description)[0] ?? "",
    palabras: textos(a.generic_keyword).join(" "),
    talla: { gender: talla.gender, age_group: talla.age_group, size_class: talla.size_class, size_system: talla.size_system },
    hijo: copiaHijo,
    // Sin padre legible, el padre nuevo se arma con lo del hijo.
    padre: copiables(padre?.attributes ?? a, [...NO_COPIABLES, ...SOLO_DEL_HIJO]),
    simples: Object.entries(copiaHijo)
      .filter(([, v]) => esSimple(v))
      .map(([clave, v]) => ({ clave, valores: textos(v) })),
  };
}

/** El padre y luego color × talla. */
export function variantesDeAmazon(p: PedidoAmazon): VarianteAmazon[] {
  const salida: VarianteAmazon[] = [{ sku: skuPadre(p.modelo), color: "", nombreColor: "", talla: "", esPadre: true }];
  const vistos = new Set<string>();
  for (const c of p.colores) {
    const color = limpio(c.codigo).toUpperCase();
    if (!color) continue;
    for (const t of p.tallas) {
      const talla = normalizarTalla(t);
      if (!talla) continue;
      const sku = skuHijo(p.modelo, color, talla);
      if (vistos.has(sku)) continue;
      vistos.add(sku);
      salida.push({ sku, color, nombreColor: limpio(c.nombre), talla, esPadre: false });
    }
  }
  return salida;
}

export function faltantesDeAmazon(p: PedidoAmazon): string[] {
  const f: string[] = [];
  if (!/^[A-Z]{1,4}\d{2,5}[A-Z]?(-\d+)?$/.test(normalizarModelo(p.modelo))) f.push("El modelo no parece un modelo (GT331).");
  const titulo = limpio(p.titulo);
  if (titulo.length < 20) f.push("Falta el título de Amazon.");
  if (titulo.length > 200) f.push(`El título pasa de 200 caracteres (lleva ${titulo.length}).`);
  if (!(p.precio > 0)) f.push("Falta el precio.");
  if (!p.ficha.productType || !Object.keys(p.ficha.hijo ?? {}).length) f.push("Falta la ficha (elige de qué modelo se copia).");
  if (!p.colores.length) f.push("Falta al menos un color.");
  if (!p.tallas.length) f.push("Falta al menos una talla.");
  const codigos = new Set<string>();
  for (const c of p.colores) {
    const codigo = limpio(c.codigo).toUpperCase();
    if (!codigo) f.push("Hay un color sin código.");
    else if (codigos.has(codigo)) f.push(`El color ${codigo} está repetido.`);
    codigos.add(codigo);
    if (!limpio(c.nombre)) f.push(`Falta el nombre en español del color ${codigo}.`);
    if (skuHijo(p.modelo, codigo, "23.5").length > 40) f.push(`El SKU del color ${codigo} pasa de 40 caracteres.`);
  }
  if (!p.vinetas.filter((v) => limpio(v)).length) f.push("Falta al menos una viñeta (Amazon la exige).");
  return [...new Set(f)];
}

function comunes(p: PedidoAmazon): Atributos {
  const mk = p.ficha.marketplaceId;
  const idioma = { language_tag: "es_MX", marketplace_id: mk };
  const modelo = normalizarModelo(p.modelo);
  const salida: Atributos = {
    item_name: [{ value: limpio(p.titulo), ...idioma }],
    model_name: [{ value: modelo, ...idioma }],
    model_number: [{ value: modelo, marketplace_id: mk }],
    bullet_point: p.vinetas.map(limpio).filter(Boolean).slice(0, 5).map((value) => ({ value, ...idioma })),
    // Amazon exige descripción; las hechas a mano llevan «.» cuando no hay.
    product_description: [{ value: p.descripcion.trim() || ".", ...idioma }],
  };
  if (limpio(p.palabras)) salida.generic_keyword = [{ value: limpio(p.palabras), ...idioma }];
  return salida;
}

/** Lo que el dueño corrigió de los atributos sencillos, encima de la ficha. */
function conSimples(attrs: Atributos, simples: AtributoSimple[], mk: string): Atributos {
  const salida = { ...attrs };
  for (const s of simples) {
    if (!(s.clave in attrs)) continue;
    const valores = s.valores.map(limpio).filter(Boolean);
    if (!valores.length) delete salida[s.clave];
    else salida[s.clave] = valores.map((value) => ({ value, language_tag: "es_MX", marketplace_id: mk }));
  }
  return salida;
}

/** El cuerpo de `PUT /listings/.../items/{vendedor}/{sku}` del PADRE. */
export function cuerpoPadre(p: PedidoAmazon): Record<string, unknown> {
  const mk = p.ficha.marketplaceId;
  return {
    productType: p.ficha.productType,
    requirements: "LISTING",
    attributes: {
      ...conSimples(p.ficha.padre, p.simples, mk),
      ...comunes(p),
      parentage_level: [{ value: "parent", marketplace_id: mk }],
      child_parent_sku_relationship: [{ child_relationship_type: "variation", marketplace_id: mk }],
      variation_theme: [{ name: "SIZE/COLOR" }],
    },
  };
}

/** El cuerpo del HIJO de un color y una talla. */
export function cuerpoHijo(p: PedidoAmazon, v: VarianteAmazon): Record<string, unknown> {
  const mk = p.ficha.marketplaceId;
  const t = p.ficha.talla ?? {};
  const talla: Record<string, string> = {
    size: tallaAmazon(v.talla),
    size_class: t.size_class || "measurement",
    size_system: t.size_system || "jp_footwear_size_system",
    age_group: t.age_group || "adult",
    marketplace_id: mk,
  };
  // Una sandalia unisex no trae género en la talla: no se inventa.
  if (t.gender) talla.gender = t.gender;
  return {
    productType: p.ficha.productType,
    requirements: "LISTING",
    attributes: {
      ...conSimples(p.ficha.hijo, p.simples, mk),
      ...comunes(p),
      parentage_level: [{ value: "child", marketplace_id: mk }],
      child_parent_sku_relationship: [{ parent_sku: skuPadre(p.modelo), child_relationship_type: "variation", marketplace_id: mk }],
      variation_theme: [{ name: "SIZE/COLOR" }],
      color: [{ value: v.nombreColor, language_tag: "es_MX", marketplace_id: mk, standardized_values: [colorBase(v.nombreColor)] }],
      footwear_size: [talla],
      list_price: [{ currency: "MXN", marketplace_id: mk, value_with_tax: p.precio }],
      purchasable_offer: [{ audience: "ALL", currency: "MXN", marketplace_id: mk, our_price: [{ schedule: [{ value_with_tax: p.precio }] }] }],
      fulfillment_availability: [{ fulfillment_channel_code: "AMAZON_NA" }],
    },
  };
}

export interface RespuestaAmazon {
  status?: string;
  issues?: { message?: string; severity?: string; code?: string; attributeNames?: string[] }[];
}

/** Los ERRORES de una respuesta de Amazon; las advertencias no cuentan. */
export function erroresDeAmazon(r: RespuestaAmazon | null | undefined): string[] {
  if (!r) return ["Amazon no contestó a tiempo."];
  const errores = (r.issues ?? [])
    .filter((i) => (i.severity ?? "").toUpperCase() === "ERROR")
    .map((i) => [limpio(i.message), i.attributeNames?.length ? `(${i.attributeNames.join(", ")})` : ""].filter(Boolean).join(" "));
  if (errores.length) return [...new Set(errores)];
  const estado = (r.status ?? "").toUpperCase();
  return estado === "ACCEPTED" || estado === "VALID" ? [] : [`Amazon contestó ${r.status ?? "sin estado"}.`];
}
