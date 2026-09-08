/**
 * Descontinuados: SKUs que ya no se venden.
 *
 * Regla del dueño, en dos niveles:
 *   · VARIANTE: un SKU sin UNA sola venta en los últimos 180 días (medio
 *     año) se da por descontinuado: no se ofrece para mandar a Full ni se
 *     pide a China, y no aparece en esas pantallas. Si su diseño (la
 *     familia) sigue vendiendo con otras variantes, el diseño sigue saliendo.
 *   · DISEÑO: si NINGUNA variante del diseño vendió en 180 días, se retira
 *     el diseño COMPLETO, con todo y las variantes que por sí solas no se
 *     juzgarían (publicadas hace poco o sin fecha): una funda nueva de un
 *     diseño muerto no lo revive.
 *
 * Guardas para no matar lo que apenas nace o lo que no se puede juzgar:
 *   · una publicación con menos de 180 días de publicada no se descontinúa
 *     sola (todavía no tuvo tiempo de vender), y sin fecha tampoco: la
 *     sincronización la pone para todas las variantes de cada publicación;
 *   · un diseño cuyas variantes son TODAS nuevas o sin fecha es un
 *     lanzamiento, no un muerto: no se retira;
 *   · si el historial de ventas guardado no cubre 180 días todavía, no se
 *     descontinúa nadie: sin historial no hay veredicto.
 */
import type { DB } from "../datos/repos";
import { hoyMx, restarDias, todo } from "./db";
import { desglosar, esCalzado } from "./sku";

export const DIAS_SIN_VENTA = 180;

export interface Descontinuados {
  skus: Set<string>;
  /** Diseños retirados completos (ninguna variante vendió en 180 días). */
  disenos: Set<string>;
  /** false mientras el historial guardado no llegue a 180 días. */
  activo: boolean;
  /** desde cuándo hay ventas guardadas */
  historialDesde: string | null;
}

/** La regla, pura, para poder probarla. */
export function decidirDescontinuados(
  skus: { sku: string; publicadoEn: string | null }[],
  ultimaVenta: Map<string, string>,
  historialDesde: string | null,
  hoy: string,
  dias = DIAS_SIN_VENTA,
): Descontinuados {
  // "Los últimos 180 días" son [hoy − 179, hoy]: el horizonte que guarda la
  // sincronización. El historial está completo cuando arranca en ese día o
  // antes (no un día antes, que era lo que pedía la primera versión y por
  // eso la regla nunca se encendía).
  const corte = restarDias(hoy, dias - 1);
  const activo = Boolean(historialDesde && historialDesde <= corte);
  const out = new Set<string>();
  const disenos = new Set<string>();
  if (!activo) return { skus: out, disenos, activo, historialDesde };

  const vendio = (sku: string) => {
    const ultima = ultimaVenta.get(sku);
    return Boolean(ultima && ultima >= corte);
  };

  // Por diseño: ¿alguna variante vendió? ¿alguna es vieja (juzgable)?
  const familias = new Map<string, { skus: string[]; vendio: boolean; vieja: boolean }>();
  for (const s of skus) {
    // Sin fecha de publicación no se puede distinguir "nueva" de "muerta":
    // no se juzga sola. La fecha la pone la sincronización (yz_fijar_publicado).
    const publicada = s.publicadoEn ? s.publicadoEn.slice(0, 10) : null;
    const vieja = Boolean(publicada && publicada < corte);
    if (vieja && !vendio(s.sku)) out.add(s.sku);

    const diseno = desglosar(s.sku).diseno;
    if (!diseno || esCalzado(diseno)) continue;
    const f = familias.get(diseno) ?? { skus: [], vendio: false, vieja: false };
    f.skus.push(s.sku);
    if (vendio(s.sku)) f.vendio = true;
    if (vieja) f.vieja = true;
    familias.set(diseno, f);
  }

  // Un diseño viejo donde NADIE vendió se va completo, con sus variantes
  // nuevas o sin fecha incluidas.
  for (const [diseno, f] of familias) {
    if (f.vendio || !f.vieja) continue;
    disenos.add(diseno);
    for (const sku of f.skus) out.add(sku);
  }
  return { skus: out, disenos, activo, historialDesde };
}

/**
 * La última venta por SKU. Camino nuevo: `yz_ultimas_ventas`, UN solo objeto
 * JSON con filtro de fecha — a la regla solo le importa si vendió DENTRO de
 * la ventana, así que un SKU con ventas más viejas equivale a no aparecer.
 * La versión anterior (`yz_ultima_venta`) agregaba TODA yz_ventas_diarias
 * sin filtro y se paginaba: PostgREST re-ejecutaba el agregado completo
 * ~18 veces por render. Queda de respaldo si la función nueva no existe.
 */
async function cargarUltimasVentas(db: DB, accountId: string, corte: string): Promise<Map<string, string>> {
  const { data, error } = await db.rpc("yz_ultimas_ventas", { p_account: accountId, p_desde: corte });
  if (!error && data && typeof data === "object") {
    return new Map(Object.entries(data as Record<string, string>));
  }

  const out = new Map<string, string>();
  for (let desde = 0; ; desde += 1000) {
    const { data: pagina, error: e2 } = await db.rpc("yz_ultima_venta", { p_account: accountId }).range(desde, desde + 999);
    if (e2) throw new Error(`yz_ultima_venta: ${e2.message}`);
    const lote = (pagina ?? []) as { sku: string; ultima_venta: string }[];
    for (const u of lote) out.set(u.sku, u.ultima_venta);
    if (lote.length < 1000) break;
  }
  return out;
}

export async function cargarDescontinuados(db: DB, accountId: string): Promise<Descontinuados> {
  const hoy = hoyMx();
  const corte = restarDias(hoy, DIAS_SIN_VENTA - 1);
  const [skus, estado, ultimas] = await Promise.all([
    todo<{ sku: string; publicado_en: string | null }>(db, "yz_skus", "sku, publicado_en", (q) => q.eq("account_id", accountId)),
    db.from("yz_sync_estado").select("ventas_desde").eq("account_id", accountId).maybeSingle(),
    cargarUltimasVentas(db, accountId, corte),
  ]);
  return decidirDescontinuados(
    skus.map((s) => ({ sku: s.sku, publicadoEn: s.publicado_en })),
    ultimas,
    estado.data?.ventas_desde ?? null,
    hoy,
  );
}
