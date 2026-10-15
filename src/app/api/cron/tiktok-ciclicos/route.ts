import { NextResponse, type NextRequest } from "next/server";
import { programarCiclicas } from "@/lib/servicios/tiktok-promociones";
import { configuracionTikTok } from "@/lib/tiktok/client";
import { clienteAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Relámpagos CÍCLICOS de TikTok, cada hora: a cada modelo cíclico activo se
 * le reponen las ventanas que falten para que siempre tenga
 * `VENTANAS_ADELANTE` programadas, una detrás de otra, de hasta 72 h cada
 * una (dueño, 15-oct-2026: «el sistema se encarga de que siempre va a estar
 * con relámpagos programadas»). Lo que no alcance en esta corrida lo recoge
 * la siguiente.
 */
export async function GET(req: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secreto || auth !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  if (!configuracionTikTok()) {
    return NextResponse.json({ ok: true, aviso: "TikTok Shop no está configurado." });
  }

  const admin = clienteAdmin();
  const { data: cuentas } = await admin.from("meli_accounts").select("id, nickname");
  const resultados: Record<string, unknown>[] = [];
  for (const c of cuentas ?? []) {
    try {
      const r = await programarCiclicas(admin, c.id, { presupuestoMs: 250_000 });
      resultados.push({ cuenta: c.nickname, ok: true, ...r });
    } catch (err) {
      resultados.push({ cuenta: c.nickname, ok: false, error: (err as Error).message });
    }
  }
  return NextResponse.json({ cuentas: resultados.length, resultados });
}
