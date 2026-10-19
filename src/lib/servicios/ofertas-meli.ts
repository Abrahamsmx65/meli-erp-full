/**
 * Ofertas MELI: revisa las ofertas CON APORTE de Mercado Libre a las que
 * invitan a las publicaciones de calzado y acepta las que cumplen el PV
 * normal de Números (motor en `precios/ofertas-aporte.ts`; dueño,
 * 19-oct-2026: automático y solo calzado).
 *
 * Lectura en bloque: la lista de promociones del vendedor y, de cada una
 * con aporte, sus publicaciones invitadas por páginas (`search_after`), en
 * vez de una llamada por publicación. El resultado se guarda masticado en
 * `app_cache` (`ofertas-meli`) y la pantalla lo lee. Cada corrida deja en
 * `sync_log` (tarea `ofertas-aporte`) qué se aceptó y una muestra cruda de
 * lo que contestó MELI.
 */

import type { MeliClient } from "../meli/client";
import { conCandado, traerTodo, type DB } from "../datos/repos";
import { calcularNumeros } from "../finanzas/numeros";
import { redondear99 } from "../precios/promociones";
import {
  cuerpoParaAceptar,
  decidirOferta,
  esTipoConAporte,
  ordenarOfertas,
  type ItemDeOferta,
  type ObjetivoOferta,
  type PromocionMeli,
  type RenglonOferta,
} from "../precios/ofertas-aporte";
import { guardarCacheApp, leerCacheAppGuardado } from "./cache-app";
import { listarNumeros } from "./numeros";
import { CLAVE_TARIFAS, type TarifasGuardadas } from "./tarifas-reales";

export const CLAVE_OFERTAS = "ofertas-meli";
export const CLAVE_CONFIG_OFERTAS = "ofertas-meli:config";
export const TAREA_OFERTAS = "ofertas-aporte";

const POR_PAGINA = 50;
const MAX_PAGINAS_PROMO = 200;
const MAX_PAGINAS_LISTA = 20;

export interface PromocionResumen {
  id: string;
  tipo: string;
  nombre: string;
  estado: string;
  fin: string | null;
  invitadas: number;
  error: string | null;
}

export interface RevisionOfertas {
  generadoEn: string;
  renglones: RenglonOferta[];
  promociones: PromocionResumen[];
  avisos: string[];
  /** última aceptación (manual o automática) */
  ultimaAceptacion: ResultadoAceptacion | null;
}

export interface ResultadoAceptacion {
  en: string;
  origen: "cron" | "manual";
  aceptadas: { itemId: string; modelo: string | null; nombre: string; precio: number | null }[];
  fallidas: { itemId: string; modelo: string | null; nombre: string; error: string }[];
}

export interface ConfigOfertas {
  automatico: boolean;
}

const recortar = (x: unknown, max = 4000) => {
  const s = JSON.stringify(x ?? null);
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

const mensajeDe = (err: unknown) => {
  const e = err as { message?: string; cuerpo?: unknown };
  return e?.cuerpo ? `${e.message ?? "error"}: ${recortar(e.cuerpo, 300)}` : String(e?.message ?? err);
};

export async function leerConfigOfertas(db: DB, accountId: string): Promise<ConfigOfertas> {
  const g = await leerCacheAppGuardado<ConfigOfertas>(db, accountId, CLAVE_CONFIG_OFERTAS).catch(() => null);
  return { automatico: g?.estado === "encontrado" ? Boolean(g.valor.datos.automatico) : false };
}

export async function guardarConfigOfertas(db: DB, accountId: string, c: ConfigOfertas): Promise<void> {
  await guardarCacheApp(db, accountId, CLAVE_CONFIG_OFERTAS, c, 0);
}

export async function leerOfertasGuardadas(db: DB, accountId: string): Promise<RevisionOfertas | null> {
  const g = await leerCacheAppGuardado<RevisionOfertas>(db, accountId, CLAVE_OFERTAS).catch(() => null);
  return g?.estado === "encontrado" ? g.valor.datos : null;
}

/** PV normal (a .99, como «Llevar precios») y envío de Números por modelo. */
async function objetivosPorModelo(db: DB, accountId: string): Promise<Map<string, ObjetivoOferta>> {
  const tarifas = await leerCacheAppGuardado<TarifasGuardadas>(db, accountId, CLAVE_TARIFAS).catch(() => null);
  const porModelo = tarifas && tarifas.estado === "encontrado" ? tarifas.valor.datos.porModelo : {};
  const { renglones } = await listarNumeros(db, accountId, porModelo);
  const m = new Map<string, ObjetivoOferta>();
  for (const r of renglones) {
    const c = calcularNumeros(r.entrada, r.costo, r.reales);
    m.set(r.entrada.modelo, { pvNormal: redondear99(c.pvNormal), envio: c.usado.meli.envio ?? 0 });
  }
  return m;
}

/** Publicaciones de calzado de la cuenta → modelo. */
async function modelosPorItem(db: DB, accountId: string): Promise<Map<string, string>> {
  const filas = await traerTodo<{ item_id: string | null; modelo: string | null }>(db, "skus", "item_id, modelo, sku", (q) =>
    q.eq("account_id", accountId).eq("activo", true).not("item_id", "is", null).order("sku", { ascending: true }),
  );
  const m = new Map<string, string>();
  for (const f of filas) if (f.item_id && f.modelo) m.set(f.item_id, f.modelo.toUpperCase());
  return m;
}

async function promocionesDelVendedor(cliente: MeliClient, userId: number, muestra: Record<string, unknown>): Promise<PromocionMeli[]> {
  const todas: PromocionMeli[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS_LISTA; pagina++) {
    const r = await cliente.get<{ results?: PromocionMeli[]; paging?: { total?: number } } | PromocionMeli[]>(
      `/seller-promotions/users/${userId}`,
      { app_version: "v2", offset: pagina * POR_PAGINA, limit: POR_PAGINA },
    );
    if (pagina === 0) muestra.promociones = recortar(r);
    const lote = Array.isArray(r) ? r : r?.results ?? [];
    todas.push(...lote);
    const total = Array.isArray(r) ? null : r?.paging?.total ?? null;
    if (lote.length < POR_PAGINA || (total != null && todas.length >= total)) break;
  }
  return todas;
}

async function invitadasDe(cliente: MeliClient, promo: PromocionMeli, muestra: Record<string, unknown>): Promise<ItemDeOferta[]> {
  const items: ItemDeOferta[] = [];
  let searchAfter: string | null = null;
  for (let pagina = 0; pagina < MAX_PAGINAS_PROMO; pagina++) {
    const r: { results?: ItemDeOferta[]; paging?: { searchAfter?: string | null; search_after?: string | null } } = await cliente.get(
      `/seller-promotions/promotions/${promo.id}/items`,
      { app_version: "v2", promotion_type: promo.type ?? "", limit: POR_PAGINA, search_after: searchAfter ?? undefined },
    );
    const clave = `items:${promo.type}`;
    if (pagina === 0 && !(clave in muestra)) muestra[clave] = recortar(r);
    const lote = r?.results ?? [];
    items.push(...lote);
    searchAfter = r?.paging?.searchAfter ?? r?.paging?.search_after ?? null;
    if (!lote.length || !searchAfter) break;
  }
  return items;
}

async function revisarSinCandado(admin: DB, cliente: MeliClient, accountId: string): Promise<{ revision: RevisionOfertas; muestra: Record<string, unknown> }> {
  const avisos: string[] = [];
  const muestra: Record<string, unknown> = {};
  const { data: cuenta } = await admin.from("meli_accounts").select("meli_user_id").eq("id", accountId).maybeSingle();
  const userId = Number((cuenta as { meli_user_id?: number } | null)?.meli_user_id);
  if (!userId) throw new Error("La cuenta no tiene usuario de MELI.");

  const [objetivos, items, promos] = await Promise.all([
    objetivosPorModelo(admin, accountId),
    modelosPorItem(admin, accountId),
    promocionesDelVendedor(cliente, userId, muestra),
  ]);

  const conAporte = promos.filter((p) => p.id && esTipoConAporte(p.type) && !["finished", "expired"].includes((p.status ?? "").toLowerCase()));
  const renglones: RenglonOferta[] = [];
  const promociones: PromocionResumen[] = [];
  for (const p of conAporte) {
    const resumen: PromocionResumen = {
      id: String(p.id),
      tipo: (p.type ?? "").toUpperCase(),
      nombre: p.name ?? p.type ?? "",
      estado: p.status ?? "",
      fin: p.finish_date ?? null,
      invitadas: 0,
      error: null,
    };
    try {
      for (const it of await invitadasDe(cliente, p, muestra)) {
        const itemId = String(it.id ?? "");
        const modelo = items.get(itemId) ?? null;
        if (!modelo) continue; // solo calzado de esta cuenta
        resumen.invitadas++;
        renglones.push(decidirOferta(it, p, modelo, objetivos.get(modelo) ?? null));
      }
    } catch (err) {
      resumen.error = mensajeDe(err);
      avisos.push(`${resumen.nombre} (${resumen.tipo}): ${resumen.error}`);
    }
    promociones.push(resumen);
  }
  const previa = await leerOfertasGuardadas(admin, accountId);
  return {
    revision: {
      generadoEn: new Date().toISOString(),
      renglones: ordenarOfertas(renglones),
      promociones,
      avisos,
      ultimaAceptacion: previa?.ultimaAceptacion ?? null,
    },
    muestra,
  };
}

async function anotar(admin: DB, accountId: string, estado: "ok" | "error", detalle: unknown) {
  await admin.from("sync_log").insert({ account_id: accountId, tarea: TAREA_OFERTAS, estado, fin: new Date().toISOString(), detalle });
}

/** Revisa y guarda; con `aceptar` además acepta todo lo que cumple. */
export async function revisarOfertas(
  admin: DB,
  cliente: MeliClient,
  accountId: string,
  opciones: { aceptar?: boolean; origen?: "cron" | "manual" } = {},
): Promise<RevisionOfertas> {
  const origen = opciones.origen ?? "manual";
  return conCandado(
    admin,
    accountId,
    "ofertas-meli",
    780,
    async () => {
      const inicio = Date.now();
      const { revision, muestra } = await revisarSinCandado(admin, cliente, accountId);
      let resultado: ResultadoAceptacion | null = null;
      if (opciones.aceptar) {
        resultado = { en: new Date().toISOString(), origen, aceptadas: [], fallidas: [] };
        for (const r of revision.renglones) {
          if (r.decision !== "aceptar") continue;
          try {
            await cliente.post(`/seller-promotions/items/${r.itemId}?app_version=v2`, cuerpoParaAceptar(r));
            r.decision = "aceptada";
            r.motivo = `Aceptada: ${r.motivo}`;
            resultado.aceptadas.push({ itemId: r.itemId, modelo: r.modelo, nombre: r.nombre, precio: r.precio });
          } catch (err) {
            resultado.fallidas.push({ itemId: r.itemId, modelo: r.modelo, nombre: r.nombre, error: mensajeDe(err) });
          }
        }
        revision.ultimaAceptacion = resultado;
        revision.renglones = ordenarOfertas(revision.renglones);
      }
      await guardarCacheApp(admin, accountId, CLAVE_OFERTAS, revision, Date.now() - inicio);
      const cuenta = (d: string) => revision.renglones.filter((r) => r.decision === d).length;
      await anotar(admin, accountId, resultado?.fallidas.length || revision.avisos.length ? "error" : "ok", {
        origen,
        aceptar: Boolean(opciones.aceptar),
        promociones: revision.promociones,
        cumplen: cuenta("aceptar"),
        noCumplen: cuenta("no_cumple"),
        sinPrecio: cuenta("sin_precio"),
        sinDatos: cuenta("sin_datos"),
        aceptadas: resultado?.aceptadas ?? [],
        fallidas: resultado?.fallidas ?? [],
        avisos: revision.avisos.slice(0, 50),
        muestra,
      });
      return revision;
    },
    "Ya se están revisando las ofertas.",
  );
}
