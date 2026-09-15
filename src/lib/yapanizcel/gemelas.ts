/**
 * Publicaciones GEMELAS: el mismo producto publicado DOS veces en MELI, una
 * con la N (o la C) antes del diseño y otra sin ella: `462-A57` y
 * `N-462-A57`, `462-i14` y `N-462-i14`. La N/C ya es "el mismo producto"
 * para el amarre de bodega (nivel `prefijo_nc`), pero cada publicación es
 * un SKU distinto en `yz_skus` y cada una traía sus propios números.
 *
 * Regla del dueño (15-sep-2026, con el 462 a la vista): «hoy en día solo
 * ocupamos los SKUs de 462 comenzando con N-, hay que juntar todo por
 * ahí: stock, pedidos de China y todo». La bodega y el pedido de la fábrica
 * dicen `462-A57` y amarraban EXACTO con la publicación vieja (sin N), así
 * que la N-, que es la que vende, se quedaba sin bodega ni en camino: el
 * plan pedía de más y el envío a Full no veía la bodega.
 *
 * Por eso todo lo de un grupo de gemelas se junta bajo UNA PRINCIPAL:
 *   · la publicación CON prefijo (N antes que C), salvo que esté cerrada
 *     en MELI; entre varias con prefijo, la activa primero;
 *   · si ninguna con prefijo sigue viva, la sin prefijo (activa primero).
 * Las demás se ABSORBEN: su venta, su Full, su transferencia, sus envíos en
 * camino, su bodega y su pedido a China se suman a la principal, y ellas
 * desaparecen de Pedidos a China, del plan de envíos y de Bodega. Un grupo
 * solo se da por descontinuado si TODAS sus gemelas lo están.
 *
 * La clave del grupo es la aplastada sin la N/C suelta (`clavePrefijoNC`):
 * dos publicaciones que solo difieren en guiones o mayúsculas también son
 * gemelas, igual que en el amarre.
 */
import { claveCanonica, clavePrefijoNC, piezas, piezasSinPrefijo, PREFIJOS_AUTOMATICOS } from "./sku";

export interface PublicacionGemela {
  sku: string;
  /** Estado en MELI (active / paused / closed…); null si no se sabe. */
  estado?: string | null;
}

export interface Gemelas {
  /** SKU → SKU principal de su grupo (él mismo si no tiene gemelas o es la principal). */
  principalDe: Map<string, string>;
  /** Principal → las gemelas que absorbe (sin ella). Solo grupos con más de una. */
  absorbidas: Map<string, string[]>;
}

/** true si el SKU lleva la N o la C antes del diseño (suelta o pegada: "N-462-…", "462N-…"). */
export function llevaPrefijoNC(sku: string): boolean {
  return piezasSinPrefijo(sku, PREFIJOS_AUTOMATICOS).length < piezas(sku).length;
}

/** La letra del prefijo ("N" o "C"), o "" si no lleva. */
function letraPrefijo(sku: string): string {
  const partes = claveCanonica(sku).split("-").filter(Boolean);
  if (partes.length < 2) return "";
  if (/^[A-Z]$/.test(partes[0]) && /^\d/.test(partes[1])) return partes[0];
  const m = partes[0].match(/^\d+([A-Z])$/);
  return m ? m[1] : "";
}

function rangoEstado(estado: string | null | undefined): number {
  const e = String(estado ?? "").toLowerCase();
  if (e === "active") return 0;
  if (e === "paused") return 1;
  if (e === "closed") return 3;
  return 2;
}

/** Orden dentro del grupo: la que va primero es la principal. */
function compararCandidatas(a: PublicacionGemela, b: PublicacionGemela): number {
  const ca = llevaPrefijoNC(a.sku) && rangoEstado(a.estado) < 3;
  const cb = llevaPrefijoNC(b.sku) && rangoEstado(b.estado) < 3;
  if (ca !== cb) return ca ? -1 : 1;
  const ea = rangoEstado(a.estado);
  const eb = rangoEstado(b.estado);
  if (ea !== eb) return ea - eb;
  // Con prefijo las dos: N antes que C. Luego el nombre, por tener un orden fijo.
  const pa = letraPrefijo(a.sku);
  const pb = letraPrefijo(b.sku);
  if (ca && pa !== pb) return pa === "N" ? -1 : pb === "N" ? 1 : pa.localeCompare(pb);
  return a.sku.localeCompare(b.sku);
}

/** Agrupa el catálogo en gemelas y elige la principal de cada grupo. */
export function agruparGemelas(publicaciones: Iterable<PublicacionGemela>): Gemelas {
  const grupos = new Map<string, PublicacionGemela[]>();
  for (const p of publicaciones) {
    const sku = String(p.sku ?? "").trim();
    if (!sku) continue;
    const clave = clavePrefijoNC(sku);
    if (!clave) continue;
    const g = grupos.get(clave);
    if (g) g.push({ ...p, sku });
    else grupos.set(clave, [{ ...p, sku }]);
  }

  const principalDe = new Map<string, string>();
  const absorbidas = new Map<string, string[]>();
  for (const g of grupos.values()) {
    if (g.length === 1) {
      principalDe.set(g[0].sku, g[0].sku);
      continue;
    }
    const orden = [...g].sort(compararCandidatas);
    const principal = orden[0].sku;
    for (const p of orden) principalDe.set(p.sku, principal);
    absorbidas.set(principal, orden.slice(1).map((p) => p.sku));
  }
  return { principalDe, absorbidas };
}

/** El SKU principal de uno cualquiera (él mismo si no está en el catálogo). */
export function principalDe(g: Gemelas, sku: string): string {
  return g.principalDe.get(sku) ?? sku;
}

/** Suma un mapa SKU → número bajo las principales. */
export function sumarPorPrincipal(g: Gemelas, m: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [sku, n] of m) {
    const p = principalDe(g, sku);
    out.set(p, (out.get(p) ?? 0) + n);
  }
  return out;
}
