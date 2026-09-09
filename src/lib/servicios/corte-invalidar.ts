/**
 * Marcar obsoletos los cortes masticados de unos meses (calzado en
 * app_cache, fundas en yz_cache y el corte general en consolidado_cache).
 *
 * Lo llaman los trabajos de fondo que cambian el dinero de un mes ya
 * cerrado: la recarga de pagos reales de Mercado Pago, el cron de netos de
 * fundas y la ingesta de la Finances API de Amazon. Sin esto, un mes cerrado
 * solo se refrescaba cada 6 horas y la pantalla seguía enseñando
 * retenciones en $0 con la base ya desglosada.
 *
 * Módulo chico y sin dependencias de los motores a propósito (los motores
 * importan a los trabajos de fondo, y estos a este archivo).
 */
import type { DB } from "../datos/repos";
import { invalidarApp } from "./cache-app";
import { invalidarYz } from "../yapanizcel/cache";

/** Cambiar la versión invalida cortes masticados con reglas contables anteriores. */
export const claveCorte = (periodo: string): string => `corte:v2:${periodo}`;

/** YYYY-MM de una fecha YYYY-MM-DD (o ISO). */
export const periodoDeFecha = (fecha: string): string => fecha.slice(0, 7);

export async function invalidarCortesDePeriodos(
  db: DB,
  cuentas: { meliAccountId?: string | null; yzAccountId?: string | null },
  periodos: Iterable<string>,
  motivo: string,
): Promise<void> {
  const lista = [...new Set(periodos)].filter((p) => /^\d{4}-\d{2}$/.test(p));
  if (!lista.length) return;
  const claves = lista.map(claveCorte);

  // Las cuentas de MELI: la dada, o todas (registro cerrado: un dueño) cuando
  // el trabajo que escribe no la conoce (fundas, Amazon).
  let meli: string[] = cuentas.meliAccountId ? [cuentas.meliAccountId] : [];
  if (!meli.length && cuentas.meliAccountId !== undefined) {
    try {
      const { data } = await db.from("meli_accounts").select("id");
      meli = ((data ?? []) as { id: string }[]).map((c) => c.id);
    } catch {
      meli = [];
    }
  }

  for (const id of meli) {
    if (cuentas.meliAccountId) await invalidarApp(db, id, motivo, { claves }).catch(() => undefined);
    try {
      await db.from("consolidado_cache").update({ vigente: false, motivo }).eq("account_id", id).in("periodo", lista);
    } catch {
      // Columna aún sin migrar: el refresco por edad sigue funcionando.
    }
  }
  if (cuentas.yzAccountId) await invalidarYz(db, cuentas.yzAccountId, motivo, claves).catch(() => undefined);
}
