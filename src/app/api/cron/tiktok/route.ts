import { NextResponse, type NextRequest } from "next/server";
import { sincronizarTikTok } from "@/lib/servicios/tiktok";
import { configuracionTikTok } from "@/lib/tiktok/client";
import { clienteAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * TikTok cada hora, no una vez al día.
 *
 * Los otros canales aguantan el ritmo diario porque el marketplace guarda el
 * stock y lo descuenta él. Aquí no: entre corrida y corrida, la publicación
 * sigue ofreciendo lo que el kardex ya no tiene. Cada hora es el punto donde
 * el riesgo de sobrevender se vuelve chico sin gastarse la cuota del API.
 *
 * Además de bajar pedidos, cada corrida RECONCILIA: vuelve a empujar todo lo
 * que quedó desfasado, incluso lo que falló ayer o lo que se capturó a mano
 * mientras el API estaba caído.
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
      const r = await sincronizarTikTok(admin, c.id);
      resultados.push({ cuenta: c.nickname, ok: true, ...r });
    } catch (err) {
      resultados.push({ cuenta: c.nickname, ok: false, error: (err as Error).message });
    }
  }

  return NextResponse.json({ cuentas: resultados.length, resultados });
}
