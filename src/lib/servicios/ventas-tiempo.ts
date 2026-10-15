/**
 * Venta por DÍA y por HORA de cada canal (dueño, 9-oct-2026: «una gráfica
 * por horas y por días en todos los canales y en el general»).
 *
 * Las sumas las hace Postgres (`ventas_por_hora`, migración 0134) con las
 * mismas reglas que la pantalla de cada canal. TikTok y Amazon se guardan
 * masticados por canal y rango en `app_cache`
 * (`ventas-tiempo:v2:{canal}:{desde}:{hasta}`) y se sirven aunque estén
 * viejos; MELI calzado y fundas se leen en vivo (`CANALES_EN_VIVO`).
 */
import type { DB } from "../datos/repos";
import { guardarCacheApp, leerCacheAppGuardado, servirConCacheApp } from "./cache-app";
import type { CanalTiempo, VentasTiempo } from "../graficas/ventas-tiempo";
import { rangosDeAtajos } from "./atajos-fechas";

export type { CanalTiempo, DiaVenta, HoraVenta, VentasTiempo } from "../graficas/ventas-tiempo";
export { CANALES_TIEMPO } from "../graficas/ventas-tiempo";

// Dos minutos: el monitor de hoy de Inicio compara contra ayer a la misma
// hora. Desde la 0138 MELI y fundas se leen de `ventas_dia_hora` (~50 ms),
// así que refrescar seguido no cuesta.
const EDAD_MAX_MS = 2 * 60_000;

/**
 * MELI calzado y fundas se leen EN VIVO en cada visita (11-oct-2026): sus
 * días y horas ya están sumados en la base (`ventas_dia_hora`, 0138, ≤ 1 min)
 * y leerlos cuesta 20–70 ms; una copia encima solo los atrasaba. TikTok y
 * Amazon calculan desde sus pedidos y siguen masticados.
 */
export const CANALES_EN_VIVO: readonly CanalTiempo[] = ["meli_calzado", "meli_fundas"];

const num = (x: unknown) => Number(x) || 0;

/** Lo que contesta el RPC, ya con números (jsonb trae numeric como número o texto). */
export function normalizarVentasTiempo(canal: CanalTiempo, crudo: unknown): VentasTiempo {
  const r = (crudo ?? {}) as { dias?: any[]; horas?: any[] };
  return {
    canal,
    dias: (r.dias ?? []).map((d) => ({ f: String(d.f).slice(0, 10), u: num(d.u), o: num(d.o), i: num(d.i) })),
    horas: (r.horas ?? []).map((d) => ({ f: String(d.f).slice(0, 10), h: num(d.h), u: num(d.u), o: num(d.o), i: num(d.i) })),
  };
}

export async function leerVentasTiempo(
  db: DB,
  canal: CanalTiempo,
  accountId: string,
  rango: { desde: string; hasta: string },
): Promise<VentasTiempo> {
  const { data, error } = await db.rpc("ventas_por_hora", {
    p_canal: canal,
    p_account: accountId,
    p_desde: rango.desde,
    p_hasta: rango.hasta,
  });
  if (error) throw new Error(`ventas_por_hora (${canal}): ${error.message}`);
  return normalizarVentasTiempo(canal, data);
}

/**
 * La serie masticada de un canal. `db` tiene que poder escribir `app_cache`
 * con la cuenta del canal (el cliente admin, después de que la pantalla ya
 * verificó con la sesión que la cuenta es del usuario).
 */
export async function servirVentasTiempo(
  db: DB,
  canal: CanalTiempo,
  accountId: string,
  rango: { desde: string; hasta: string },
): Promise<{ datos: VentasTiempo; generadoEn: string | null }> {
  const clave = `ventas-tiempo:v2:${canal}:${rango.desde}:${rango.hasta}`;
  if (CANALES_EN_VIVO.includes(canal)) {
    try {
      const generadoEn = new Date().toISOString();
      return { datos: await leerVentasTiempo(db, canal, accountId, rango), generadoEn };
    } catch (e) {
      // Si la lectura en vivo falla, lo último guardado sirve.
      console.error((e as Error).message);
    }
  }
  const r = await servirConCacheApp(db, accountId, clave, EDAD_MAX_MS, () => leerVentasTiempo(db, canal, accountId, rango));
  return { datos: r.datos, generadoEn: r.generadoEn };
}

/** Varios canales a la vez; el que falle se omite (la gráfica no tumba la pantalla). */
export async function servirVariosCanales(
  db: DB,
  cuentas: { canal: CanalTiempo; accountId: string | null | undefined }[],
  rango: { desde: string; hasta: string },
): Promise<VentasTiempo[]> {
  return (await servirVariosCanalesConFecha(db, cuentas, rango)).series;
}

/** Igual, con la fecha de la serie MÁS VIEJA (el monitor de hoy corta a esa hora). */
export async function servirVariosCanalesConFecha(
  db: DB,
  cuentas: { canal: CanalTiempo; accountId: string | null | undefined }[],
  rango: { desde: string; hasta: string },
): Promise<{ series: VentasTiempo[]; generadoEn: string | null }> {
  const res = await Promise.all(
    cuentas.map(async ({ canal, accountId }) => {
      if (!accountId) return null;
      try {
        return await servirVentasTiempo(db, canal, accountId, rango);
      } catch (e) {
        console.error((e as Error).message);
        return null;
      }
    }),
  );
  const ok = res.filter((x): x is { datos: VentasTiempo; generadoEn: string | null } => x != null);
  const fechas = ok.map((x) => x.generadoEn).filter((x): x is string => !!x).sort();
  return { series: ok.map((x) => x.datos), generadoEn: fechas[0] ?? null };
}

/**
 * Deja listas las series de los atajos del filtro de fechas cuando están por
 * vencer: TikTok desde el latido y Amazon desde su cron de pantallas. MELI
 * calzado y fundas van en vivo (`CANALES_EN_VIVO`) y no se guardan.
 */
export async function precalcularVentasTiempo(
  admin: DB,
  accountId: string,
  limite: number,
  hoy: string,
  canales: readonly CanalTiempo[] = ["tiktok"],
): Promise<void> {
  for (const rango of rangosDeAtajos(hoy)) {
    for (const canal of canales) {
      if (Date.now() > limite) return;
      if (CANALES_EN_VIVO.includes(canal)) continue;
      const clave = `ventas-tiempo:v2:${canal}:${rango.desde}:${rango.hasta}`;
      const g = await leerCacheAppGuardado<VentasTiempo>(admin, accountId, clave);
      if (g.estado === "encontrado" && g.valor.vigente && Date.now() - Date.parse(g.valor.generadoEn) < EDAD_MAX_MS - 30_000) continue;
      const t0 = Date.now();
      const datos = await leerVentasTiempo(admin, canal, accountId, rango);
      await guardarCacheApp(admin, accountId, clave, datos, Date.now() - t0);
    }
  }
}
