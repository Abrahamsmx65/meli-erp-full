/**
 * Ofertas de las FUNDAS en MELI (dueño, 23-oct-2026: «una sección igual
 * para las ofertas en la sección de fundas para poner sus relámpagos y
 * ofertas regulares y de Buen Fin y que se confirmen solas»). El MISMO
 * motor que el calzado, con la cuenta de YAPANIZCEL:
 *
 *  - Precio por DISEÑO de la pestaña FUNDAS del sheet «Números»
 *    (`yapanizcel/precios-sheet.ts`): relámpago = su columna de relámpago;
 *    Buen Fin y oferta de todos los días = PV MELI, los dos a .99.
 *  - Publicación → diseño de `yz_skus` (no cerradas). Una publicación con
 *    varios diseños no se toca: no hay un solo precio para ella.
 *  - Relámpago (una programada por publicación, como en calzado), Buen Fin
 *    y todos los días por `confirmarRelampagosPendientes` /
 *    `confirmarBuenFinPendientes`; ofertas CON APORTE por
 *    `revisarOfertasCon` contra el PV MELI. Bitácora en `yz_sync_log` y la
 *    revisión de ofertas en `yz_cache` (`ofertas-meli`).
 */
import type { DB } from "../datos/repos";
import { traerTodo } from "../datos/repos";
import type { MeliClient } from "../meli/client";
import { libroDeXlsx, SHEET_NUMEROS } from "../finanzas/sheets";
import { redondear99, type Objetivos } from "../precios/promociones";
import type { ObjetivoOferta } from "../precios/ofertas-aporte";
import { leerPreciosFundas, type PrecioFunda } from "../yapanizcel/precios-sheet";
import { guardarCacheYz, leerCacheYzGuardado } from "../yapanizcel/cache";
import { bajar } from "./sheets-finanzas";
import { bitacoraFundas } from "./bitacora-ofertas";
import {
  confirmarBuenFinPendientes,
  confirmarRelampagosPendientes,
  promosDeItems,
  type RevisionDeNumeros,
} from "./precios-modelos";
import { revisarOfertasCon, type FuenteOfertas, type RevisionOfertas } from "./ofertas-meli";

export const CLAVE_OFERTAS_FUNDAS = "ofertas-meli";
export const CLAVE_CONFIG_FUNDAS = "ofertas-meli:config";

export interface ConfigOfertasFundas {
  /** relámpago, Buen Fin, todos los días y ofertas con aporte se confirman solas */
  automatico: boolean;
}

/** La revisión de ofertas con aporte más los precios del sheet que se usaron. */
export interface RevisionOfertasFundas extends RevisionOfertas {
  precios?: PrecioFunda[];
}

export async function leerConfigOfertasFundas(db: DB, accountId: string): Promise<ConfigOfertasFundas> {
  const g = await leerCacheYzGuardado<ConfigOfertasFundas>(db, accountId, CLAVE_CONFIG_FUNDAS).catch(() => null);
  // Sin renglón, prendido: el dueño pidió «que se confirmen solas».
  return { automatico: g?.estado === "encontrado" ? g.valor.datos.automatico !== false : true };
}

export async function guardarConfigOfertasFundas(db: DB, accountId: string, c: ConfigOfertasFundas): Promise<void> {
  await guardarCacheYz(db, accountId, CLAVE_CONFIG_FUNDAS, c, 0);
}

export async function leerOfertasFundas(db: DB, accountId: string): Promise<RevisionOfertasFundas | null> {
  const g = await leerCacheYzGuardado<RevisionOfertasFundas>(db, accountId, CLAVE_OFERTAS_FUNDAS).catch(() => null);
  return g?.estado === "encontrado" ? g.valor.datos : null;
}

/** Los precios por diseño del sheet de Números (se baja en cada corrida). */
export async function preciosDelSheet(): Promise<{ precios: PrecioFunda[]; avisos: string[] }> {
  return leerPreciosFundas(await libroDeXlsx(await bajar(SHEET_NUMEROS)));
}

/** Publicación → diseño (las no cerradas). */
async function itemsFundas(admin: DB, accountId: string): Promise<{ items: Map<string, string>; avisos: string[] }> {
  const filas = await traerTodo<{ item_id: string | null; diseno: string | null }>(admin, "yz_skus", "item_id, diseno, sku", (q) =>
    q.eq("account_id", accountId).neq("estado", "closed").not("item_id", "is", null).order("sku", { ascending: true }),
  );
  const disenos = new Map<string, Set<string>>();
  for (const f of filas) {
    if (!f.item_id || !f.diseno) continue;
    disenos.set(f.item_id, (disenos.get(f.item_id) ?? new Set()).add(f.diseno));
  }
  const items = new Map<string, string>();
  const revueltas: string[] = [];
  for (const [item, ds] of disenos) {
    if (ds.size === 1) items.set(item, [...ds][0]);
    else revueltas.push(`${item} (${[...ds].join(", ")})`);
  }
  const avisos = revueltas.length
    ? [`Publicaciones con varios diseños, no se tocan (no hay un solo precio): ${revueltas.slice(0, 20).join("; ")}${revueltas.length > 20 ? ` y ${revueltas.length - 20} más` : ""}.`]
    : [];
  return { items, avisos };
}

function avisoSinPrecio(items: Map<string, string>, precios: PrecioFunda[]): string[] {
  const conPrecio = new Set(precios.map((p) => p.diseno));
  const sin = [...new Set([...items.values()].filter((d) => !conPrecio.has(d)))].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
  return sin.length ? [`Diseños con publicaciones y sin PV MELI en la pestaña FUNDAS de Números (no se tocan): ${sin.join(", ")}.`] : [];
}

/** Las promociones de MELI de todas las publicaciones de fundas, contra el sheet. */
export async function revisarPromosFundas(admin: DB, cliente: MeliClient, accountId: string): Promise<RevisionDeNumeros> {
  const [{ precios, avisos: avisosSheet }, { items, avisos: avisosItems }] = await Promise.all([preciosDelSheet(), itemsFundas(admin, accountId)]);
  const objetivos: Objetivos[] = precios.map((p) => ({
    modelo: p.diseno,
    relampago: redondear99(p.relampago),
    normal: redondear99(p.pvMeli),
    pvpDeal: null,
  }));
  const porDiseno = new Map(objetivos.map((o) => [o.modelo, o]));
  const { meli, avisos } = await promosDeItems(cliente, items, porDiseno);
  const disenos = [...new Set([...items.values()].filter((d) => porDiseno.has(d)))];
  return {
    modelos: disenos,
    revision: { objetivos, meli, amazon: [], avisos: [...avisosSheet, ...avisosItems, ...avisoSinPrecio(items, precios), ...avisos] },
  };
}

/** Relámpago, Buen Fin y todos los días de las fundas, con UNA lectura de promociones. */
export async function confirmarPromosFundas(
  admin: DB,
  cliente: MeliClient,
  accountId: string,
  origen: "cron" | "manual",
  que: { relampagos?: boolean; buenFin?: boolean } = { relampagos: true, buenFin: true },
) {
  const previa = await revisarPromosFundas(admin, cliente, accountId);
  const bitacora = bitacoraFundas(admin, accountId);
  const relampagos = que.relampagos ? await confirmarRelampagosPendientes(admin, cliente, accountId, origen, previa, bitacora) : null;
  const buenFin = que.buenFin
    ? await confirmarBuenFinPendientes(admin, cliente, accountId, origen, previa, { bitacora, clases: ["buen_fin", "todos_los_dias"] })
    : null;
  return { relampagos, buenFin };
}

/** La fuente de las ofertas con aporte de fundas: PV MELI del sheet por diseño. */
export function fuenteFundas(admin: DB, accountId: string, userId: number): FuenteOfertas & { precios: () => PrecioFunda[] } {
  let precios: PrecioFunda[] = [];
  const avisos: string[] = [];
  return {
    userId,
    avisos,
    precios: () => precios,
    async objetivos() {
      const r = await preciosDelSheet();
      precios = r.precios;
      avisos.push(...r.avisos);
      const m = new Map<string, ObjetivoOferta>();
      // El sheet de fundas no trae envío: una oferta que con el aporte cruza
      // los $299 no se acepta (`decidirOferta`).
      for (const p of precios) m.set(p.diseno, { pvNormal: redondear99(p.pvMeli), envio: null });
      return m;
    },
    async items() {
      const r = await itemsFundas(admin, accountId);
      avisos.push(...r.avisos);
      return r.items;
    },
    leerPrevia: () => leerOfertasFundas(admin, accountId),
    guardar: (revision, ms) => guardarCacheYz(admin, accountId, CLAVE_OFERTAS_FUNDAS, { ...revision, precios }, ms),
    bitacora: bitacoraFundas(admin, accountId),
  };
}

/** Revisa (y con `aceptar`, acepta) las ofertas con aporte de MELI de las fundas. */
export async function revisarOfertasFundas(
  admin: DB,
  cliente: MeliClient,
  accountId: string,
  opciones: { aceptar?: boolean; origen?: "cron" | "manual" } = {},
): Promise<RevisionOfertas> {
  const { data } = await admin.from("yz_cuentas").select("meli_user_id").eq("id", accountId).maybeSingle();
  const userId = Number((data as { meli_user_id?: number } | null)?.meli_user_id);
  if (!userId) throw new Error("La cuenta de fundas no tiene usuario de MELI.");
  return revisarOfertasCon(cliente, fuenteFundas(admin, accountId, userId), opciones);
}
