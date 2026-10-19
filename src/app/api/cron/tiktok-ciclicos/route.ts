import { NextResponse, type NextRequest } from "next/server";
import { programarCiclicas } from "@/lib/servicios/tiktok-promociones";
import { configuracionTikTok } from "@/lib/tiktok/client";
import { clienteAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Relámpagos CÍCLICOS de TikTok, CADA MINUTO: a cada modelo cíclico activo
 * cuya relámpago ya terminó (o que no tiene ninguna) se le crea la
 * siguiente, de hasta 72 h, arrancando 2 minutos después (dueño,
 * 19-oct-2026: «en el tiempo más temprano posible cuando se vence la
 * última, y el espacio entre una y otra de 2 minutos»). TikTok no deja dos
 * vivas o programadas del mismo producto, así que no se adelantan: la
 * revisión de cada minuto es barata y, cuando una está por terminar, el
 * fondo espera a que termine y pega la siguiente. Lo que no alcance en
 * esta corrida lo recoge la siguiente.
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
