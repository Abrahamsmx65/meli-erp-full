import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import type { Cuenta } from "@/lib/datos/repos";
import { refrescarConsolidadosDeFondo } from "@/lib/servicios/consolidado-cargar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Un mes tarda ~1–2 min; después de esto no se arranca otro. */
const PLAZO_MS = 150_000;

/**
 * Deja el corte general (/cortes) masticado por atrás: mes corriente cada
 * 10 minutos y el anterior mientras siga cambiando (vercel.json). Así la
 * pantalla lee un renglón ya calculado en vez de estrenarlo al abrirla.
 * Mismo secreto que /api/cron/plan.
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

  const limite = Date.now() + PLAZO_MS;
  const { data: cuentas } = await admin
    .from("meli_accounts")
    .select("id, meli_user_id, nickname, site_id")
    .order("creado_en", { ascending: true });
  const resultados: Record<string, unknown>[] = [];
  for (const c of (cuentas ?? []) as Cuenta[]) {
    try {
      resultados.push({ cuenta: c.nickname, periodos: await refrescarConsolidadosDeFondo(admin, c, { limite }) });
    } catch (err) {
      resultados.push({ cuenta: c.nickname, error: (err as Error).message });
    }
  }
  return NextResponse.json({ cuentas: cuentas?.length ?? 0, resultados });
}
