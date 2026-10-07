/**
 * Amarre A MANO del color de un pedido con el color publicado en MELI.
 *
 * La fábrica escribe «NAVY (AZUL MARINO)» y MELI «BLUE»; «M BROWN» donde
 * MELI dice «LT BROWN». Los amarres automáticos no adivinan dos letras ni
 * sinónimos, así que el dueño ELIGE con qué variante de MELI va cada color
 * (pedido del dueño, 7-oct-2026: «que me ponga lo que MELI tiene, lo marque
 * en rojo por afuera y cuando me meta salgan las variantes de ese modelo y
 * yo elija cómo ligarlo; lo mismo en los packing lists de China»).
 *
 * El renglón del pedido CONSERVA la escritura de la fábrica —así sigue
 * amarrando el packing list, que la fábrica escribe igual— y aquí vive la
 * traducción, por MODELO + color aplastado (no por pedido: la misma
 * escritura se repite en los pedidos siguientes y en los contenedores).
 * `colorMeli` null = el dueño confirmó que es un color NUEVO de verdad.
 *
 * La usan: la alerta de Cargar pedidos y Contenedores, el «en camino» de la
 * vista de inventario (y con ella Planificación China), Productos nuevos,
 * las etiquetas del pedido y el casado del packing list.
 */
import { canonizar, colorPlano } from "../importar/sku";
import type { DB } from "../datos/repos";

export interface AliasColor {
  /** modelo canonizado (GT074) */
  modelo: string;
  /** color del pedido aplastado (NAVYAZULMARINO) */
  color: string;
  /** color de MELI elegido; null = confirmado como color nuevo */
  colorMeli: string | null;
  /** color del pedido tal cual se escribió, para enseñarlo */
  colorPedido: string;
}

/** clave → alias */
export type MapaAlias = Map<string, AliasColor>;

export function claveAlias(modelo: string, color: string): string {
  return `${canonizar(modelo || "")}|${colorPlano(color || "")}`;
}

export function aliasDe(mapa: MapaAlias | null | undefined, modelo: string, color: string | null): AliasColor | undefined {
  if (!mapa?.size) return undefined;
  return mapa.get(claveAlias(modelo, color ?? ""));
}

/**
 * El color con el que se busca en MELI: el que eligió el dueño si lo hay,
 * si no el del pedido tal cual. Un color confirmado como nuevo se queda
 * como está (no hay a qué traducirlo).
 */
export function colorEfectivo(mapa: MapaAlias | null | undefined, modelo: string, color: string | null): string {
  const a = aliasDe(mapa, modelo, color);
  return a?.colorMeli ? a.colorMeli : (color ?? "");
}

export function armarMapaAlias(
  filas: { modelo: string; color: string; color_meli: string | null; color_pedido: string }[],
): MapaAlias {
  const mapa: MapaAlias = new Map();
  for (const f of filas) {
    const modelo = canonizar(f.modelo || "");
    const color = colorPlano(f.color || "");
    if (!modelo || !color) continue;
    mapa.set(`${modelo}|${color}`, {
      modelo,
      color,
      colorMeli: f.color_meli ? String(f.color_meli).trim().toUpperCase() : null,
      colorPedido: String(f.color_pedido ?? "").trim().toUpperCase(),
    });
  }
  return mapa;
}

/** Los amarres de la cuenta. Si la tabla no se puede leer, no hay amarres (no se grita). */
export async function cargarAliasColores(db: DB, accountId: string): Promise<MapaAlias> {
  const { data, error } = await db
    .from("pedido_color_amarres")
    .select("modelo, color, color_meli, color_pedido")
    .eq("account_id", accountId);
  if (error || !data) return new Map();
  return armarMapaAlias(data as { modelo: string; color: string; color_meli: string | null; color_pedido: string }[]);
}
