/**
 * Lo que cada plataforma COBRÓ de verdad por modelo en los últimos 30 días
 * (MELI, Amazon, TikTok), para que Números calcule con lo real y no con
 * estimaciones (dueño, 11-oct-2026). Las sumas van en Postgres
 * (`*_tarifas_por_modelo`, migración 0136) y el resultado se guarda
 * masticado en `app_cache` (`finanzas:tarifas-reales`).
 */
import type { DB } from "../datos/repos";
import { traerRpcTodoOLanzar } from "../datos/repos";
import type { TarifasReales } from "../finanzas/numeros";
import { cuentaAmazon } from "./amazon";

export const CLAVE_TARIFAS = "finanzas:tarifas-reales";
export const DIAS_TARIFAS = 30;
export const EDAD_TARIFAS_MS = 6 * 3_600_000;

export interface TarifasGuardadas {
  desde: string;
  porModelo: Record<string, TarifasReales>;
  avisos: string[];
}

const n = (x: unknown): number | null => (x == null || !Number.isFinite(Number(x)) ? null : Number(x));

export async function calcularTarifasReales(db: DB, accountId: string): Promise<TarifasGuardadas> {
  const desde = new Date(Date.now() - DIAS_TARIFAS * 86_400_000).toISOString().slice(0, 10);
  const porModelo: Record<string, TarifasReales> = {};
  const de = (m: string) => (porModelo[m] ??= {});
  const avisos: string[] = [];

  const [meli, amz, tt] = await Promise.allSettled([
    traerRpcTodoOLanzar<any>(db, "meli_tarifas_por_modelo", { p_account: accountId, p_desde: desde }),
    (async () => {
      const cuenta = await cuentaAmazon(db);
      return cuenta ? traerRpcTodoOLanzar<any>(db, "amazon_tarifas_por_modelo", { p_account: cuenta.id, p_desde: desde }) : [];
    })(),
    traerRpcTodoOLanzar<any>(db, "tiktok_tarifas_por_modelo", { p_account: accountId, p_desde: desde }),
  ]);

  if (meli.status === "fulfilled") {
    for (const r of meli.value)
      de(r.modelo).meli = {
        pares: Number(r.pares ?? 0),
        paresDirecta: Number(r.pares_directa ?? 0),
        comisionPct: n(r.comision_pct),
        envioPar: n(r.envio_par),
        retencionPct: n(r.retencion_pct),
        netoPar: n(r.neto_par),
      };
  } else avisos.push(`MELI: ${(meli.reason as Error).message}`);
  if (amz.status === "fulfilled") {
    for (const r of amz.value)
      de(r.modelo).amazon = {
        unidades: Number(r.unidades ?? 0),
        precioPar: n(r.precio_par),
        comisionPct: n(r.comision_pct),
        retencionPct: n(r.retencion_pct),
        fbaPar: n(r.fba_par),
        otrosPar: n(r.otros_par),
        netoPar: n(r.neto_par),
      };
  } else avisos.push(`Amazon: ${(amz.reason as Error).message}`);
  if (tt.status === "fulfilled") {
    for (const r of tt.value)
      de(r.modelo).tiktok = {
        pares: Number(r.pares ?? 0),
        precioPar: n(r.precio_par),
        pagoPar: n(r.pago_par),
        afiliadoPct: n(r.afiliado_pct),
      };
  } else avisos.push(`TikTok: ${(tt.reason as Error).message}`);

  return { desde, porModelo, avisos };
}
