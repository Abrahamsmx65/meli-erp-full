import { NextResponse, type NextRequest } from "next/server";
import { programarCiclicas } from "@/lib/servicios/tiktok-promociones";
import { configuracionTikTok } from "@/lib/tiktok/client";
import { clienteAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Relámpagos CÍCLICOS de TikTok, cada 10 minutos: a cada modelo cíclico
 * activo cuya relámpago ya terminó (o que no tiene ninguna) se le crea la
 * siguiente, de hasta 72 h (dueño, 15-oct-2026: «el sistema se encarga de
 * que siempre va a estar con relámpagos programadas»). TikTok no deja dos
 * vivas o programadas del mismo producto, así que no se adelantan: por eso
 * la corrida es cada 10 min y no cada hora. Lo que no alcance en esta
 * corrida lo recoge la siguiente.
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
