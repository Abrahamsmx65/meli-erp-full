import { NextResponse, type NextRequest } from "next/server";
import { sincronizarPagosTikTok } from "@/lib/servicios/tiktok";
import { configuracionTikTok } from "@/lib/tiktok/client";
import { clienteAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Los PAGOS de TikTok, cada hora y por su cuenta: lo que TikTok dice que
 * va a pagar por cada pedido en pie (lista de sin liquidar) y lo que ya
 * liquidó (pedido por pedido). Vive aparte del sync de inventario y
 * pedidos (`/api/cron/tiktok`, cada 15 min) por decisión del dueño
 * (28-sep-2026): el dinero no comparte tiempo ni candado con el kardex ni
 * con el despacho.
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
      const r = await sincronizarPagosTikTok(admin, c.id);
      resultados.push({ cuenta: c.nickname, ok: true, ...r });
    } catch (err) {
      resultados.push({ cuenta: c.nickname, ok: false, error: (err as Error).message });
    }
  }
  return NextResponse.json({ cuentas: resultados.length, resultados });
}
