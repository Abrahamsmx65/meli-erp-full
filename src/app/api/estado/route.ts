import { NextResponse, after } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, registrarSync, cerrarSync } from "@/lib/datos/repos";
import { procesarPendientes } from "@/lib/servicios/webhooks";
import { recalcular } from "@/lib/servicios/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Estado de la conexión, y de paso el motor de la sincronización en vivo.
 *
 * La barra de arriba consulta esto cada 30 segundos. Aprovechando el viaje,
 * aquí se procesan los avisos que MELI dejó en la bandeja y se recalcula el
 * plan cuando quedó obsoleto: mientras alguien tenga la app abierta, todo se
 * actualiza solo, sin picar nada.
 *
 * La respuesta sale ANTES de hacer ese trabajo. Antes se procesaban hasta 25
 * avisos —cada uno con sus llamadas a MELI— con la barra esperando: la app
 * entera se sentía lenta por culpa de su propio latido. Ahora el trabajo corre
 * después de contestar, con candado para que dos pestañas no lo dupliquen.
 *
 * Es a propósito que el trabajo vaya montado en la consulta de estado y no en
 * el webhook: MELI corta a los 500 ms y procesar ahí haría que perdiéramos
 * avisos. Lo que nadie procese mientras la app está cerrada lo recoge el cron.
 */

/** Cuánto puede tener el plan de viejo antes de recalcularse solo. */
const EDAD_MAX_PLAN_MS = 3 * 60_000;

export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  }

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return NextResponse.json({
      conectado: false,
      ultimaSync: null,
      planGeneradoEn: null,
      planVigente: true,
      avisosPendientes: 0,
      enVivo: false,
    });
  }

  const [sync, plan, pendientes, ultimoAviso] = await Promise.all([
    supabase
      .from("sync_log")
      .select("inicio, estado")
      .eq("account_id", cuenta.id)
      .eq("estado", "ok")
      .neq("tarea", "en_vivo")
      .order("inicio", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("plan_cache")
      .select("generado_en, vigente")
      .eq("account_id", cuenta.id)
      .maybeSingle(),
    supabase
      .from("webhooks_meli")
      .select("id", { count: "exact", head: true })
      .eq("account_id", cuenta.id)
      .is("procesado_en", null),
    supabase
      .from("webhooks_meli")
      .select("recibido_en")
      .eq("account_id", cuenta.id)
      .order("recibido_en", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const hayAvisos = (pendientes.count ?? 0) > 0;
  const planViejo =
    plan.data?.vigente === false &&
    (!plan.data?.generado_en ||
      Date.now() - new Date(plan.data.generado_en).getTime() > EDAD_MAX_PLAN_MS);

  if (hayAvisos || planViejo) {
    after(() => trabajar(cuenta.id, hayAvisos, planViejo));
  }

  // "En vivo" significa que los webhooks están llegando de verdad, no que
  // estén configurados. Si no llega nada en 24 h, algo se rompió y hay que
  // decirlo en vez de presumir tiempo real.
  const recibidoReciente = ultimoAviso.data?.recibido_en
    ? Date.now() - new Date(ultimoAviso.data.recibido_en).getTime() < 24 * 3600 * 1000
    : false;

  const ultimaNovedad = ultimoAviso.data?.recibido_en ?? sync.data?.inicio ?? null;

  return NextResponse.json({
    conectado: true,
    enVivo: recibidoReciente,
    ultimaSync: recibidoReciente ? ultimaNovedad : (sync.data?.inicio ?? null),
    planGeneradoEn: plan.data?.generado_en ?? null,
    planVigente: plan.data?.vigente ?? true,
    avisosPendientes: pendientes.count ?? 0,
  });
}

/**
 * El trabajo pesado, ya con la respuesta entregada.
 *
 * El candado vive en sync_log: si otra pestaña (u otro ciclo del mismo
 * navegador) ya tiene una corrida viva, esta se retira sin hacer nada.
 */
async function trabajar(accountId: string, avisos: boolean, planViejo: boolean): Promise<void> {
  const admin = clienteAdmin();

  const { data: vivo } = await admin
    .from("sync_log")
    .select("id")
    .eq("account_id", accountId)
    .eq("tarea", "en_vivo")
    .eq("estado", "corriendo")
    .gte("inicio", new Date(Date.now() - 4 * 60_000).toISOString())
    .limit(1);
  if (vivo?.length) return;

  const logId = await registrarSync(admin, accountId, "en_vivo");

  try {
    let procesados = 0;
    if (avisos) {
      const r = await procesarPendientes(admin, accountId, 25);
      procesados = r.procesados;
    }

    // Recalcular si el plan ya venía viejo o si estos avisos lo invalidaron.
    let msPlan: number | null = null;
    if (planViejo || procesados > 0) {
      const { data: plan } = await admin
        .from("plan_cache")
        .select("generado_en, vigente")
        .eq("account_id", accountId)
        .maybeSingle();
      const obsoleto =
        plan?.vigente === false &&
        (!plan?.generado_en ||
          Date.now() - new Date(plan.generado_en).getTime() > EDAD_MAX_PLAN_MS);
      if (obsoleto) {
        const r = await recalcular(admin, accountId);
        msPlan = r.msCalculo;
      }
    }

    await cerrarSync(admin, logId, "ok", { procesados, msPlan });

    // Estas corridas son latidos, no historia: no vale la pena acumularlas.
    await admin
      .from("sync_log")
      .delete()
      .eq("account_id", accountId)
      .eq("tarea", "en_vivo")
      .lt("inicio", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  } catch (err) {
    await cerrarSync(admin, logId, "error", {
      mensaje: (err as Error).message.slice(0, 300),
    });
  }
}
