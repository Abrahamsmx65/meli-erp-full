import { NextResponse, type NextRequest } from "next/server";
import { avisarFaltantesRecientes } from "@/lib/servicios/tiktok-faltantes-correo";
import { releerSinPrepararDeCortesRecientes } from "@/lib/servicios/tiktok-despacho";
import { configuracionTikTok } from "@/lib/tiktok/client";
import { clienteAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cada mañana (13:30Z = 7:30 en México): si algún pedido de los cortes
 * recientes no se escaneó, un correo con los números de pedido a quien
 * empaca. Sin faltantes, sin correo.
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
      // Primero se releen en TikTok los pedidos sin preparar: uno cancelado
      // después del corte no debe llegar al correo como faltante.
      const releidos = await releerSinPrepararDeCortesRecientes(admin, c.id).catch((err: Error) => ({ error: err.message }));
      resultados.push({ cuenta: c.nickname, releidos, ...(await avisarFaltantesRecientes(admin, c.id)) });
    } catch (err) {
      resultados.push({ cuenta: c.nickname, error: (err as Error).message });
    }
  }
  return NextResponse.json({ ok: true, resultados });
}
