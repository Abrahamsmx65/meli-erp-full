/**
 * ¿Cada renglón del pedido (modelo + color) existe como SKU en MELI?
 *
 * Un pedido con el color escrito distinto a como está publicado ("CHOCOLATE
 * BROWN" contra "CHOCOLATTE BROWN", "BLK (NEGRO)" contra "BLK") cae en un
 * COLOR FANTASMA: su inventario en camino no descuenta del color real en
 * Planificación China y Productos nuevos lo enseña como «sin publicar».
 * Pedido del dueño (6-oct-2026): «si el sistema ve que un pedido no está
 * ligado a un SKU, que me alerte en la sección de cargar pedidos».
 *
 * Tres veredictos por renglón:
 *   - ligado:          hay SKU de MELI (con los cinco amarres de siempre).
 *   - color_fantasma:  el MODELO sí está en MELI pero con otros colores →
 *                      casi seguro es el mismo zapato mal escrito; se
 *                      enseñan los colores que MELI sí tiene para corregir.
 *   - modelo_nuevo:    el modelo no existe en MELI → producto nuevo de
 *                      verdad, no hay nada que corregir.
 */
import { buscarVariante, indexarCatalogo, type IndiceCatalogo } from "../etiquetas/resolver";
import { canonizar } from "../importar/sku";
import { catalogoBodega } from "./inventario";
import type { DB } from "../datos/repos";

export type EstadoAmarre = "ligado" | "color_fantasma" | "modelo_nuevo";

export interface AmarreLinea {
  estado: EstadoAmarre;
  /** el SKU de MELI con el que amarró (de la primera talla que encontró) */
  skuMeli: string | null;
  /** los colores que MELI SÍ tiene para ese modelo, para corregir el pedido */
  coloresMeli: string[];
}

export interface LineaParaAmarre {
  modelo: string;
  color: string | null;
  /** la talla de una caja unitalla; vacía o nula en corrida */
  talla?: string | null;
  /** talla → pares, en renglones de corrida */
  tallas?: Record<string, unknown> | null;
}

/** Los colores publicados de un modelo, sin repetir, en orden alfabético. */
export function coloresDelModelo(ix: IndiceCatalogo, modelo: string): string[] {
  const variantes = ix.porModelo.get(canonizar(modelo)) ?? [];
  return [...new Set(variantes.map((v) => v.color.trim().toUpperCase()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "es"),
  );
}

export function evaluarAmarre(ix: IndiceCatalogo, linea: LineaParaAmarre): AmarreLinea {
  const modelo = (linea.modelo || "").trim();
  const color = (linea.color || "").trim();
  const variantes = ix.porModelo.get(canonizar(modelo)) ?? [];
  const coloresMeli = coloresDelModelo(ix, modelo);
  if (!variantes.length) return { estado: "modelo_nuevo", skuMeli: null, coloresMeli: [] };

  // Las tallas que probar: la de la caja, las de la corrida o, si el
  // renglón no trae ninguna, las que MELI publica del modelo.
  const propias = linea.talla
    ? [String(linea.talla)]
    : Object.keys(linea.tallas ?? {}).filter(Boolean);
  const tallas = propias.length ? propias : [...new Set(variantes.map((v) => v.talla).filter(Boolean))];

  for (const t of tallas) {
    const { encontrado } = buscarVariante(ix, modelo, color, t);
    if (encontrado) return { estado: "ligado", skuMeli: String(encontrado.sku), coloresMeli };
  }
  return { estado: "color_fantasma", skuMeli: null, coloresMeli };
}

/** El veredicto de cada renglón, en el mismo orden, con el catálogo de MELI de la cuenta. */
export async function amarreDeLineas(db: DB, accountId: string, lineas: LineaParaAmarre[]): Promise<AmarreLinea[]> {
  if (!lineas.length) return [];
  const { skus } = await catalogoBodega(db, accountId);
  const ix = indexarCatalogo(skus as { sku: string }[]);
  return lineas.map((l) => evaluarAmarre(ix, l));
}

/** Resumen por pedido: los colores fantasma, sin repetir. */
export function coloresFantasma(
  lineas: LineaParaAmarre[],
  amarres: AmarreLinea[],
): { modelo: string; color: string; coloresMeli: string[] }[] {
  const vistos = new Map<string, { modelo: string; color: string; coloresMeli: string[] }>();
  lineas.forEach((l, i) => {
    const a = amarres[i];
    if (!a || a.estado !== "color_fantasma") return;
    const modelo = (l.modelo || "").trim().toUpperCase();
    const color = (l.color || "").trim().toUpperCase();
    const k = `${modelo}|${color}`;
    if (!vistos.has(k)) vistos.set(k, { modelo, color, coloresMeli: a.coloresMeli });
  });
  return [...vistos.values()].sort((a, b) => a.modelo.localeCompare(b.modelo) || a.color.localeCompare(b.color));
}
