import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { Cliente, cuentasAmazon } from "@/lib/amazon/spapi";
import { sincronizarFinanzas } from "@/lib/amazon/finanzas-sync";
import { invalidarApp } from "@/lib/servicios/cache-app";
import { invalidarCortesDePeriodos } from "@/lib/servicios/corte-invalidar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Margen antes del corte, para cerrar el grupo o guardar el token. */
const PLAZO_MS = 240_000;

/**
 * Ingesta del dinero real de Amazon (Finances API por grupo de liquidación).
 * La dispara Vercel Cron cada 10 minutos (vercel.json); cada corrida avanza
 * ~100 páginas (10 mil eventos) y guarda por dónde va. Mismo secreto que
 * /api/cron/plan.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const presentado = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!presentado) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const admin = clienteAdmin();
  let autorizado = Boolean(process.env.CRON_SECRET) && presentado === process.env.CRON_SECRET;
  if (!autorizado) {
    const { data } = await admin.from("app_secretos").select("valor").eq("clave", "cron_amazon").maybeSingle();
    autorizado = Boolean(data?.valor) && presentado === data!.valor;
  }
  if (!autorizado) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const cuentas = await cuentasAmazon(admin);
  if (!cuentas.length) return NextResponse.json({ aviso: "No hay cuentas de Amazon con credenciales guardadas." });

  const limite = Date.now() + PLAZO_MS;
  const resultados: Record<string, unknown>[] = [];

  for (const cuenta of cuentas) {
    const inicio = Date.now();
    // El mismo nombre de tarea en amazon_sync_log espacia esta corrida de
    // cualquier otra que se dispare a la vez (latido, curl a mano).
    const { data: reciente } = await admin
      .from("amazon_sync_log")
      .select("id")
      .eq("account_id", cuenta.accountId)
      .eq("tarea", "cron_finanzas")
      .eq("estado", "corriendo")
      .gte("inicio", new Date(Date.now() - PLAZO_MS - 30_000).toISOString())
      .limit(1);
    if (reciente?.length) {
      resultados.push({ cuenta: cuenta.nombre, aviso: "Ya hay una corrida en curso." });
      continue;
    }
    const { data: corrida } = await admin
      .from("amazon_sync_log")
      .insert({ account_id: cuenta.accountId, tarea: "cron_finanzas", estado: "corriendo" })
      .select("id")
      .maybeSingle();
    try {
      const r = await sincronizarFinanzas(admin, new Cliente(cuenta, limite));
      resultados.push({ cuenta: cuenta.nombre, ok: true, ...r });
      if (r.eventos > 0) {
        // El monitor y el dinero de Amazon se sirven masticados: con eventos
        // nuevos, el fondo los rehace en la siguiente lectura.
        await invalidarApp(admin, cuenta.accountId, "Entraron eventos financieros de Amazon.", { prefijo: "finanzas:amazon:" }).catch(() => undefined);
        await invalidarApp(admin, cuenta.accountId, "Entraron eventos financieros de Amazon.", { prefijo: "monitor:" }).catch(() => undefined);
        // El corte general de los meses tocados se rehace en el fondo.
        await invalidarCortesDePeriodos(admin, { meliAccountId: null }, r.periodos, "Entraron eventos financieros de Amazon.").catch(() => undefined);
      }
      if (corrida?.id) {
        await admin.from("amazon_sync_log").update({ fin: new Date().toISOString(), estado: "ok", detalle: { ...r, ms: Date.now() - inicio } }).eq("id", corrida.id);
      }
    } catch (err) {
      const mensaje = (err as Error).message;
      resultados.push({ cuenta: cuenta.nombre, ok: false, error: mensaje });
      if (corrida?.id) {
        await admin.from("amazon_sync_log").update({ fin: new Date().toISOString(), estado: "error", detalle: { error: mensaje.slice(0, 1000) } }).eq("id", corrida.id);
      }
    }
  }

  return NextResponse.json({ cuentas: cuentas.length, resultados });
}
