/**
 * Por dónde se vendió en TikTok (LIVE, video, tarjeta de producto, buscador,
 * pestaña Tienda), leído de la ANALÍTICA de TikTok Shop y guardado por día
 * en `tiktok_fuentes_dia` (migración 0154). Motor puro en
 * `tiktok/fuentes-venta.ts`.
 *
 * Corre en el cron de PAGOS (cada hora, `sincronizarPagosTikTok`) con su
 * propio rato: en cada corrida se vuelven a pedir los últimos
 * `DIAS_RECIENTES` días (lo de hoy y ayer cambia durante el día) y, hacia
 * atrás, hasta `TRAMOS_POR_CORRIDA` tramos de `DIAS_POR_TRAMO` días desde lo
 * más viejo guardado hasta `TIKTOK_DESDE`: la historia se completa sola en
 * dos o tres corridas. Cada lectura deja su renglón en `tiktok_sync_log`
 * (tarea `fuentes-venta`) con el primer intervalo crudo y, si TikTok
 * rechaza (sin permiso de analítica, versión), el error tal cual.
 *
 * Pedido del dueño, 4-nov-2026: «saber cuánto fue por live, cuánto por video
 * y cuánto de tarjetas de producto».
 */
import type { DB } from "../datos/repos";
import type { Cliente } from "../tiktok/client";
import { rendimientoDeTienda } from "../tiktok/api";
import { interpretarFuentes, sumarFuentes, ventanasPorLeer, type FuentesDia, type ResumenFuentes } from "../tiktok/fuentes-venta";
import { fechaMx } from "./ventas-monitor";
import { TIKTOK_DESDE } from "./consolidado-tiktok";

const DIAS_RECIENTES = 4;
const DIAS_POR_TRAMO = 30;
const TRAMOS_POR_CORRIDA = 3;
export const TAREA_FUENTES = "fuentes-venta";

export interface ResultadoFuentes {
  ventanas: { desde: string; hasta: string; dias: number }[];
  guardados: number;
  version: string | null;
  error: string | null;
}

export async function leerFuentesDeVenta(db: DB, accountId: string, cliente: Cliente): Promise<ResultadoFuentes> {
  const inicio = new Date().toISOString();
  const r: ResultadoFuentes = { ventanas: [], guardados: 0, version: null, error: null };
  let primero: unknown = null;
  try {
    const { data: guardadas, error } = await db
      .from("tiktok_fuentes_dia")
      .select("fecha")
      .eq("account_id", accountId)
      .order("fecha", { ascending: true })
      .limit(1);
    if (error) throw new Error(`tiktok_fuentes_dia: ${error.message}`);
    const ventanas = ventanasPorLeer(
      fechaMx(),
      (guardadas ?? []).map((g: any) => String(g.fecha)),
      { recientes: DIAS_RECIENTES, fondo: TIKTOK_DESDE, diasPorTramo: DIAS_POR_TRAMO, tramos: TRAMOS_POR_CORRIDA },
    );
    for (const v of ventanas) {
      if (cliente.msRestantes() < 15_000) break;
      const lectura = await rendimientoDeTienda(cliente, { desde: v.desde, hasta: v.hasta });
      if (!lectura) break;
      r.version = lectura.version;
      const dias = interpretarFuentes(lectura.crudo);
      if (primero == null) {
        const intervalos = lectura.crudo?.performance?.intervals ?? lectura.crudo?.data?.performance?.intervals;
        primero = { ...lectura.crudo, performance: { intervals: Array.isArray(intervalos) ? intervalos.slice(0, 1) : intervalos } };
      }
      if (dias.length) {
        const filas = dias.map((d) => ({ account_id: accountId, fecha: d.fecha, datos: d, leido_en: new Date().toISOString() }));
        const { error: e } = await db.from("tiktok_fuentes_dia").upsert(filas, { onConflict: "account_id,fecha" });
        if (e) throw new Error(`tiktok_fuentes_dia: ${e.message}`);
        r.guardados += filas.length;
      }
      r.ventanas.push({ desde: v.desde, hasta: v.hasta, dias: dias.length });
      // Un tramo de fondo que TikTok contesta vacío es historia que no existe: no se insiste.
      if (v.esFondo && !dias.length) break;
    }
  } catch (err) {
    r.error = (err as Error).message;
  }
  await db
    .from("tiktok_sync_log")
    .insert({
      account_id: accountId,
      tarea: TAREA_FUENTES,
      inicio,
      fin: new Date().toISOString(),
      estado: r.error ? "error" : "ok",
      detalle: { ...r, primero },
    })
    .then(() => undefined, () => undefined);
  return r;
}

export interface FuentesDeVenta {
  resumen: ResumenFuentes;
  dias: FuentesDia[];
  /** cuándo se leyó por última vez algo del rango; null sin lectura */
  leidoEn: string | null;
  /** lo que contestó TikTok la última vez que falló la lectura (null si la última salió bien o nunca corrió) */
  error: string | null;
  /** true si nunca ha corrido una lectura */
  sinLectura: boolean;
}

/** Lo guardado del rango [desde, hasta] (YYYY-MM-DD), sumado, y el estado de la última lectura. */
export async function cargarFuentesDeVenta(db: DB, accountId: string, rango: { desde: string; hasta: string }): Promise<FuentesDeVenta> {
  const [{ data: filas }, { data: ultima }] = await Promise.all([
    db
      .from("tiktok_fuentes_dia")
      .select("fecha, datos, leido_en")
      .eq("account_id", accountId)
      .gte("fecha", rango.desde)
      .lte("fecha", rango.hasta)
      .order("fecha", { ascending: true }),
    db
      .from("tiktok_sync_log")
      .select("estado, detalle, fin")
      .eq("account_id", accountId)
      .eq("tarea", TAREA_FUENTES)
      .order("inicio", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const dias: FuentesDia[] = (filas ?? []).map((f: any) => ({ ...(f.datos as FuentesDia), fecha: String(f.fecha) }));
  const leidoEn = (filas ?? []).reduce<string | null>((a, f: any) => (f.leido_en && (!a || f.leido_en > a) ? String(f.leido_en) : a), null);
  return {
    resumen: sumarFuentes(dias),
    dias,
    leidoEn,
    error: ultima?.estado === "error" ? String((ultima.detalle as any)?.error ?? "TikTok no contestó") : null,
    sinLectura: !ultima,
  };
}
