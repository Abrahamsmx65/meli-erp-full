import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { registrarSync, cerrarSync } from "@/lib/datos/repos";
import { procesarPendientes } from "@/lib/servicios/webhooks";
import { recalcular } from "@/lib/servicios/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Margen antes del corte de Vercel, para alcanzar a cerrar el registro. */
const PLAZO_MS = 240_000;

/**
 * Mantenimiento horario del plan. Lo dispara pg_cron desde Supabase.
 *
 * Mientras la app está abierta, el latido de /api/estado procesa los avisos
 * de MELI y recalcula el plan solo. Cuando nadie la tiene abierta, ese motor
 * se apaga: los avisos se acumulan y el plan envejece hasta la sincronización
 * de la mañana. Esta ruta cubre ese hueco: drena la bandeja de avisos y deja
 * el plan recalculado, cada hora, sin que nadie pique nada.
 *
 * Vercel Hobby solo permite crons diarios, por eso la programación vive en
 * pg_cron + pg_net (el mismo patrón que ya usa /api/cron/amazon). El secreto
 * se acepta de dos fuentes: el CRON_SECRET de Vercel o el guardado en la
 * tabla app_secretos, que es el que usa la base para llamarse a sí misma.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const presentado = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!presentado) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const admin = clienteAdmin();

  let autorizado = Boolean(process.env.CRON_SECRET) && presentado === process.env.CRON_SECRET;
  if (!autorizado) {
    const { data } = await admin
      .from("app_secretos")
      .select("valor")
      .eq("clave", "cron_amazon")
      .maybeSingle();
    autorizado = Boolean(data?.valor) && presentado === data!.valor;
  }
  if (!autorizado) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const limite = Date.now() + PLAZO_MS;
  const { data: cuentas } = await admin.from("meli_accounts").select("id, nickname");
  const resultados: Record<string, unknown>[] = [];

  for (const c of cuentas ?? []) {
    // El mismo candado que usa el latido: si ya hay trabajo vivo, no encimar.
    const { data: vivo } = await admin
      .from("sync_log")
      .select("id")
      .eq("account_id", c.id)
      .eq("tarea", "en_vivo")
      .eq("estado", "corriendo")
      .gte("inicio", new Date(Date.now() - 4 * 60_000).toISOString())
      .limit(1);
    if (vivo?.length) {
      resultados.push({ cuenta: c.nickname, aviso: "Ya hay trabajo en curso." });
      continue;
    }

    const logId = await registrarSync(admin, c.id, "en_vivo");

    try {
      // Drenar la bandeja en tandas hasta vaciarla o quedarse sin tiempo.
      let procesados = 0;
      while (Date.now() < limite) {
        const r = await procesarPendientes(admin, c.id, 40);
        procesados += r.procesados;
        if (r.quedanPendientes === 0 || r.procesados === 0) break;
      }

      // Dejar el plan servido si algo lo invalidó (estos avisos o lo que sea).
      let msPlan: number | null = null;
      const { data: plan } = await admin
        .from("plan_cache")
        .select("vigente")
        .eq("account_id", c.id)
        .maybeSingle();
      if (plan?.vigente === false && Date.now() < limite) {
        const r = await recalcular(admin, c.id);
        msPlan = r.msCalculo;
      }

      await cerrarSync(admin, logId, "ok", { procesados, msPlan, origen: "cron_plan" });
      resultados.push({ cuenta: c.nickname, ok: true, procesados, msPlan });
    } catch (err) {
      const mensaje = (err as Error).message.slice(0, 300);
      await cerrarSync(admin, logId, "error", { mensaje, origen: "cron_plan" });
      resultados.push({ cuenta: c.nickname, ok: false, error: mensaje });
    }
  }

  return NextResponse.json({ cuentas: cuentas?.length ?? 0, resultados });
}
