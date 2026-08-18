import { NextResponse } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { procesarPendientes } from "@/lib/servicios/webhooks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Estado de la conexión, y de paso el motor de la sincronización en vivo.
 *
 * La barra de arriba consulta esto cada 30 segundos. Aprovechando el viaje,
 * aquí se procesan los avisos que MELI dejó en la bandeja: mientras alguien
 * tenga la app abierta, las ventas y el stock se actualizan solos en menos de
 * medio minuto, sin picar nada.
 *
 * Es a propósito que el trabajo vaya montado en la consulta de estado y no en
 * el webhook: MELI corta a los 500 ms y procesar ahí haría que perdiéramos
 * avisos. Lo que nadie procese mientras la app está cerrada lo recoge la
 * pasada nocturna.
 */
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

  // Drenar la bandeja. Si truena, el estado se devuelve igual: saber cómo
  // vamos nunca debe depender de que la sincronización haya salido bien.
  let procesados = 0;
  try {
    const r = await procesarPendientes(clienteAdmin(), cuenta.id, 25);
    procesados = r.procesados;
  } catch {
    /* se reintenta en el siguiente ciclo */
  }

  const [sync, plan, pendientes, ultimoAviso] = await Promise.all([
    supabase
      .from("sync_log")
      .select("inicio, estado")
      .eq("account_id", cuenta.id)
      .eq("estado", "ok")
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
    procesadosAhora: procesados,
  });
}
