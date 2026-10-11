/**
 * La foto de cada producto (modelo + color) para enseñarla junto al SKU en
 * Contenedores y Catálogo y costos (pedido del dueño, 11-oct-2026: «que al
 * lado de cada SKU salga su foto de producto»).
 *
 * Motor puro. Las fotos salen de lo que el ERP ya guardó del catálogo de
 * Amazon (`catalogo-amazon:asins`, la primera foto de cada ASIN), de la
 * imagen del padre (`amazon_padres`) y, como respaldo del modelo, de la
 * primera foto del producto de TikTok (`tienda_productos`). El color se
 * compara laxo —sin la anotación entre paréntesis de la proforma, con los
 * sinónimos de `claveComparacion` y los repetidos colapsados— para que
 * "BLK/BLK/RED (NEGRO)" del pedido caiga en el "BLK-RED" de Amazon. Lo que
 * no amarra por color usa la foto del modelo; nada se inventa.
 */
import { canonizar, claveComparacion } from "../importar/sku";

export interface MapaFotos {
  /** MODELO → foto */
  modelos: Record<string, string>;
  /** MODELO|COLOR laxo → foto */
  colores: Record<string, string>;
}

export interface FotoDeColor {
  modelo: string;
  color: string;
  url: string | null | undefined;
  /** publicación activa en Amazon: su foto gana */
  activo?: boolean;
}

export function claveModelo(modelo: string): string {
  return canonizar(String(modelo ?? ""));
}

/** Modelo + color laxo: «BLK/BLK/RED (NEGRO)» = «BLK-RED» = «BLK / RED». */
export function claveColor(modelo: string, color: string): string {
  const sinNota = String(color ?? "").replace(/\([^)]*\)/g, " ");
  const tokens = claveComparacion(sinNota).split("-").filter(Boolean);
  const laxos: string[] = [];
  for (const t of tokens) if (laxos[laxos.length - 1] !== t) laxos.push(t);
  return `${claveModelo(modelo)}|${laxos.join("")}`;
}

const esUrl = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//.test(u);

/**
 * Arma el mapa. Por color gana la foto de una publicación ACTIVA; el modelo
 * se queda con la foto de su primer color (activo primero) y, si no tiene
 * ninguno, con la de respaldo (TikTok).
 */
export function armarMapaFotos(colores: FotoDeColor[], respaldoModelo: { modelo: string; url: string | null | undefined }[] = []): MapaFotos {
  const porColor = new Map<string, { url: string; activo: boolean }>();
  const porModelo = new Map<string, { url: string; activo: boolean }>();
  for (const c of colores) {
    if (!esUrl(c.url) || !c.modelo) continue;
    const activo = Boolean(c.activo);
    const k = claveColor(c.modelo, c.color);
    const previo = porColor.get(k);
    if (!previo || (activo && !previo.activo)) porColor.set(k, { url: c.url, activo });
    const m = claveModelo(c.modelo);
    const pm = porModelo.get(m);
    if (!pm || (activo && !pm.activo)) porModelo.set(m, { url: c.url, activo });
  }
  for (const r of respaldoModelo) {
    const m = claveModelo(r.modelo);
    if (m && esUrl(r.url) && !porModelo.has(m)) porModelo.set(m, { url: r.url, activo: false });
  }
  return {
    modelos: Object.fromEntries([...porModelo].map(([k, v]) => [k, v.url])),
    colores: Object.fromEntries([...porColor].map(([k, v]) => [k, v.url])),
  };
}

/**
 * La foto de un producto: primero el color como viene, luego el color de
 * MELI con que amarra (si se sabe), y al final la foto del modelo.
 */
export function fotoDeProducto(mapa: MapaFotos | null | undefined, modelo: string, ...colores: (string | null | undefined)[]): string | null {
  if (!mapa || !modelo) return null;
  for (const c of colores) {
    if (!c) continue;
    const url = mapa.colores[claveColor(modelo, c)];
    if (url) return url;
  }
  return mapa.modelos[claveModelo(modelo)] ?? null;
}
