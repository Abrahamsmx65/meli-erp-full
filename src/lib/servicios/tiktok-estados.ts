/**
 * Lectura de los ESTADOS DE CUENTA de TikTok (ver `tiktok/estados-cuenta.ts`).
 *
 * Corre en el cron de pagos (`sincronizarPagosTikTok`, cada hora) y guarda
 * la lista masticada en `app_cache` (`tiktok:estados-cuenta`); el corte
 * general solo lee ese renglón. Se relee completa desde que TikTok vende
 * (`TIKTOK_DESDE`) a lo más cada `CADA_CUANTO_MS`: son ~1 estado por día y
 * una página de 100 alcanza para tres meses. La primera vez que aparece un
 * estado con ajuste, deja en la bitácora (tarea `estados-cuenta`) la primera
 * página CRUDA de sus transacciones, para saber qué tipos de ajuste cobra
 * TikTok sin abrir nada a mano.
 */
import type { Cliente } from "../tiktok/client";
import { estadosDeCuenta, transaccionesDeEstado } from "../tiktok/api";
import { interpretarEstados, unirEstados, type EstadoCuentaTikTok } from "../tiktok/estados-cuenta";
import { guardarCacheApp, leerCacheAppGuardado } from "./cache-app";
import { TIKTOK_DESDE } from "./consolidado-tiktok";

export const CLAVE_ESTADOS_CUENTA = "tiktok:estados-cuenta";
const CADA_CUANTO_MS = 3 * 3_600_000;
const PAGINAS_MAXIMAS = 20;

export interface EstadosCuentaGuardados {
  leidoEn: string;
  estados: EstadoCuentaTikTok[];
  /** estados cuyo crudo de transacciones ya quedó en la bitácora */
  muestreados?: string[];
}

export async function leerEstadosGuardados(db: any, accountId: string): Promise<EstadosCuentaGuardados | null> {
  const r = await leerCacheAppGuardado<EstadosCuentaGuardados>(db, accountId, CLAVE_ESTADOS_CUENTA);
  return r.estado === "encontrado" ? r.valor.datos : null;
}

export async function leerEstadosDeCuenta(
  admin: any,
  accountId: string,
  cliente: Cliente,
  avisos: string[],
): Promise<{ estados: number; nuevos: number } | null> {
  const t0 = Date.now();
  const guardado = await leerEstadosGuardados(admin, accountId);
  if (guardado && Date.now() - Date.parse(guardado.leidoEn) < CADA_CUANTO_MS) return null;

  const desde = Math.floor(Date.parse(`${TIKTOK_DESDE}T06:00:00Z`) / 1000);
  const hasta = Math.floor(Date.now() / 1000) + 86_400;
  const leidos: EstadoCuentaTikTok[] = [];
  let pagina: string | undefined;
  let primeraCruda: any = null;
  for (let i = 0; i < PAGINAS_MAXIMAS; i++) {
    const r = await estadosDeCuenta(cliente, { desde, hasta, pageToken: pagina });
    if (!r) {
      avisos.push("Estados de cuenta: se acabó el tiempo; se terminan en la siguiente corrida.");
      return null;
    }
    if (i === 0) primeraCruda = r.crudo;
    leidos.push(...interpretarEstados(r.crudo));
    if (!r.siguiente) break;
    pagina = r.siguiente;
  }

  const estados = unirEstados(guardado?.estados ?? [], leidos);
  const yaVistos = new Set(guardado?.estados.map((e) => e.id) ?? []);
  const nuevos = leidos.filter((e) => !yaVistos.has(e.id)).length;

  // Una muestra cruda por estado con ajuste, la primera vez: qué tipos cobra.
  const muestreados = new Set(guardado?.muestreados ?? []);
  const porMuestrear = estados.filter((e) => Math.abs(e.ajustes) >= 0.01 && !muestreados.has(e.id)).slice(0, 2);
  const muestras: { id: string; dia: string; ajustes: number; crudo: unknown }[] = [];
  for (const e of porMuestrear) {
    try {
      const crudo = await transaccionesDeEstado(cliente, e.id);
      muestras.push({ id: e.id, dia: e.dia, ajustes: e.ajustes, crudo: recortar(crudo) });
      muestreados.add(e.id);
    } catch (err) {
      muestras.push({ id: e.id, dia: e.dia, ajustes: e.ajustes, crudo: { error: (err as Error).message.slice(0, 300) } });
    }
  }

  await guardarCacheApp(admin, accountId, CLAVE_ESTADOS_CUENTA, { leidoEn: new Date().toISOString(), estados, muestreados: [...muestreados] }, Date.now() - t0);
  await admin.from("tiktok_sync_log").insert({
    account_id: accountId,
    tarea: "estados-cuenta",
    inicio: new Date(t0).toISOString(),
    fin: new Date().toISOString(),
    estado: "ok",
    detalle: {
      estados: estados.length,
      nuevos,
      ajustes: Math.round(estados.reduce((a, e) => a + e.ajustes, 0) * 100) / 100,
      primeraPagina: estados.length ? null : recortar(primeraCruda),
      muestras,
    },
  });
  return { estados: estados.length, nuevos };
}

/** Lo crudo cabe en la bitácora: arreglos recortados a 5 renglones. */
function recortar(x: unknown, nivel = 0): unknown {
  if (Array.isArray(x)) return x.slice(0, 5).map((v) => recortar(v, nivel + 1));
  if (x && typeof x === "object" && nivel < 6) {
    return Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, v]) => [k, recortar(v, nivel + 1)]));
  }
  return x;
}
