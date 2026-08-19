import type { DB } from "../datos/repos";
import { registrarSync, cerrarSync } from "../datos/repos";
import { procesarPendientes } from "./webhooks";
import { recalcular } from "./cache";

/** Cuánto puede tener el plan de viejo antes de recalcularse solo. */
export const EDAD_MAX_PLAN_MS = 3 * 60_000;

/**
 * El latido del sistema: drena los avisos de MELI y deja el plan recalculado.
 *
 * Lo disparan tres caminos, y por eso vive aparte:
 *  - /api/estado cada 30 s mientras alguien tiene la app abierta,
 *  - el webhook de MELI cuando detecta que lleva más de una hora sin correr
 *    (los avisos llegan a toda hora, así que esto sustituye a un cron),
 *  - /api/cron/plan si algún día se programa desde fuera.
 *
 * El candado vive en sync_log: si ya hay una corrida viva para la cuenta,
 * el que llega se retira sin hacer nada. Así dos pestañas, un webhook y un
 * cron pueden empujar a la vez sin duplicar trabajo ni quemar cuota de MELI.
 */
export async function latido(
  admin: DB,
  accountId: string,
  opts?: { limiteMs?: number },
): Promise<{ corrio: boolean; procesados: number; msPlan: number | null }> {
  const limite = Date.now() + (opts?.limiteMs ?? 240_000);

  const { data: vivo } = await admin
    .from("sync_log")
    .select("id")
    .eq("account_id", accountId)
    .eq("tarea", "en_vivo")
    .eq("estado", "corriendo")
    .gte("inicio", new Date(Date.now() - 4 * 60_000).toISOString())
    .limit(1);
  if (vivo?.length) return { corrio: false, procesados: 0, msPlan: null };

  const logId = await registrarSync(admin, accountId, "en_vivo");

  try {
    // Drenar la bandeja en tandas hasta vaciarla o quedarse sin tiempo.
    let procesados = 0;
    while (Date.now() < limite) {
      const r = await procesarPendientes(admin, accountId, 40);
      procesados += r.procesados;
      if (r.quedanPendientes === 0 || r.procesados === 0) break;
    }

    // Dejar el plan servido si quedó obsoleto y ya no está fresquito.
    let msPlan: number | null = null;
    const { data: plan } = await admin
      .from("plan_cache")
      .select("generado_en, vigente")
      .eq("account_id", accountId)
      .maybeSingle();
    const obsoleto =
      plan?.vigente === false &&
      (!plan?.generado_en ||
        Date.now() - new Date(plan.generado_en).getTime() > EDAD_MAX_PLAN_MS);
    if (obsoleto && Date.now() < limite) {
      const r = await recalcular(admin, accountId);
      msPlan = r.msCalculo;
    }

    await cerrarSync(admin, logId, "ok", { procesados, msPlan });

    // Estas corridas son latidos, no historia: no vale la pena acumularlas.
    await admin
      .from("sync_log")
      .delete()
      .eq("account_id", accountId)
      .eq("tarea", "en_vivo")
      .lt("inicio", new Date(Date.now() - 24 * 3600 * 1000).toISOString());

    return { corrio: true, procesados, msPlan };
  } catch (err) {
    await cerrarSync(admin, logId, "error", {
      mensaje: (err as Error).message.slice(0, 300),
    });
    return { corrio: true, procesados: 0, msPlan: null };
  }
}

/**
 * ¿Hace falta encender el latido desde el webhook? Solo si nadie lo ha
 * corrido en la última hora — con la app abierta corre cada medio minuto,
 * así que esto solo prende cuando la app lleva rato cerrada.
 */
export async function latidoApagado(admin: DB, accountId: string): Promise<boolean> {
  const { data } = await admin
    .from("sync_log")
    .select("id")
    .eq("account_id", accountId)
    .eq("tarea", "en_vivo")
    .gte("inicio", new Date(Date.now() - 55 * 60_000).toISOString())
    .limit(1);
  return !data?.length;
}
