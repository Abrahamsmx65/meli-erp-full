import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { sincronizar } from "@/lib/servicios/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sincronización automática. La dispara Vercel Cron.
 *
 * Corre a diario aunque no vayas a planear ese día: cada corrida guarda la
 * foto del stock, y esas fotos son las que con el tiempo dejan medir los
 * agotamientos en vez de estimarlos.
 */
export async function GET(req: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");

  if (!secreto || auth !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const admin = clienteAdmin();
  const { data: cuentas } = await admin.from("meli_accounts").select("id, nickname");

  const resultados: Record<string, unknown>[] = [];

  for (const c of cuentas ?? []) {
    try {
      const r = await sincronizar(admin, c.id);
      resultados.push({ cuenta: c.nickname, ok: true, ...r });
    } catch (err) {
      resultados.push({ cuenta: c.nickname, ok: false, error: (err as Error).message });
    }
  }

  return NextResponse.json({ corridas: resultados.length, resultados });
}
