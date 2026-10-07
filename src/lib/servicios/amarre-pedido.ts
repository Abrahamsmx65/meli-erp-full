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
 *   - color_nuevo:     el dueño CONFIRMÓ a mano que ese color no está en
 *                      MELI y es nuevo (`pedido_color_amarres` con
 *                      `color_meli` null): no se grita más.
 *
 * El dueño también puede LIGAR a mano un color del pedido con una variante
 * de MELI (`alias-color.ts`, 7-oct-2026): entonces el renglón se evalúa con
 * el color de MELI y queda `ligado` con `ligadoA`.
 */
import { buscarVariante, indexarCatalogo, type IndiceCatalogo } from "../etiquetas/resolver";
import { canonizar } from "../importar/sku";
import { catalogoBodega } from "./inventario";
import type { DB } from "../datos/repos";
import { aliasDe, cargarAliasColores, type MapaAlias } from "./alias-color";

export type EstadoAmarre = "ligado" | "color_fantasma" | "modelo_nuevo" | "color_nuevo";

export interface AmarreLinea {
  estado: EstadoAmarre;
  /** el SKU de MELI con el que amarró (de la primera talla que encontró) */
  skuMeli: string | null;
  /** los colores que MELI SÍ tiene para ese modelo, para corregir el pedido */
  coloresMeli: string[];
  /** el color de MELI al que el dueño ligó este color a mano, si fue así */
  ligadoA?: string | null;
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

export function evaluarAmarre(ix: IndiceCatalogo, linea: LineaParaAmarre, alias?: MapaAlias | null): AmarreLinea {
  const modelo = (linea.modelo || "").trim();
  const propio = (linea.color || "").trim();
  const variantes = ix.porModelo.get(canonizar(modelo)) ?? [];
  const coloresMeli = coloresDelModelo(ix, modelo);
  if (!variantes.length) return { estado: "modelo_nuevo", skuMeli: null, coloresMeli: [] };

  // Lo que el dueño decidió a mano manda: ligado a una variante, o
  // confirmado como color nuevo.
  const a = aliasDe(alias, modelo, propio);
  if (a && !a.colorMeli) return { estado: "color_nuevo", skuMeli: null, coloresMeli, ligadoA: null };
  const color = a?.colorMeli ?? propio;

  // Las tallas que probar: la de la caja, las de la corrida o, si el
  // renglón no trae ninguna, las que MELI publica del modelo.
  const propias = linea.talla
    ? [String(linea.talla)]
    : Object.keys(linea.tallas ?? {}).filter(Boolean);
  const tallas = propias.length ? propias : [...new Set(variantes.map((v) => v.talla).filter(Boolean))];

  for (const t of tallas) {
    const { encontrado } = buscarVariante(ix, modelo, color, t);
    if (encontrado) {
      return { estado: "ligado", skuMeli: String(encontrado.sku), coloresMeli, ligadoA: a?.colorMeli ?? undefined };
    }
  }
  // Un amarre a mano a un color que MELI ya no tiene se declara como
  // fantasma otra vez (la publicación se renombró o se cerró).
  return { estado: "color_fantasma", skuMeli: null, coloresMeli, ligadoA: a?.colorMeli ?? undefined };
}

/** El veredicto de cada renglón, en el mismo orden, con el catálogo de MELI de la cuenta. */
export async function amarreDeLineas(db: DB, accountId: string, lineas: LineaParaAmarre[]): Promise<AmarreLinea[]> {
  if (!lineas.length) return [];
  const [{ skus }, alias] = await Promise.all([catalogoBodega(db, accountId), cargarAliasColores(db, accountId)]);
  const ix = indexarCatalogo(skus as { sku: string }[]);
  return lineas.map((l) => evaluarAmarre(ix, l, alias));
}

/** Un color del pedido que el dueño ya decidió a mano: ligado a una variante o confirmado nuevo. */
export interface ColorLigado {
  modelo: string;
  color: string;
  /** null = confirmado como color nuevo */
  colorMeli: string | null;
}

/** Resumen por pedido: los colores con amarre a mano, sin repetir (para enseñarlos y poder quitarlos). */
export function coloresLigados(lineas: LineaParaAmarre[], amarres: AmarreLinea[]): ColorLigado[] {
  const vistos = new Map<string, ColorLigado>();
  lineas.forEach((l, i) => {
    const a = amarres[i];
    if (!a) return;
    const aMano = a.estado === "color_nuevo" || a.ligadoA !== undefined;
    if (!aMano) return;
    const modelo = (l.modelo || "").trim().toUpperCase();
    const color = (l.color || "").trim().toUpperCase();
    const k = `${modelo}|${color}`;
    if (!vistos.has(k)) vistos.set(k, { modelo, color, colorMeli: a.estado === "color_nuevo" ? null : (a.ligadoA ?? null) });
  });
  return [...vistos.values()].sort((a, b) => a.modelo.localeCompare(b.modelo) || a.color.localeCompare(b.color));
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
