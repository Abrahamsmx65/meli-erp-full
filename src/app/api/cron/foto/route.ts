import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { tomarFotoStock } from "@/lib/servicios/foto";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * La foto del stock de cada día, sola y antes que nada.
 *
 * Corre una hora antes de la sincronización grande y no comparte nada con
 * ella: si el catálogo de MELI truena, si las órdenes tardan, si el plan no
 * alcanza a recalcularse, la foto YA ESTÁ GUARDADA. Es el único dato del
 * sistema que no admite segunda oportunidad — a ayer no se le puede tomar
 * la foto — y de él depende que los agotamientos se midan en vez de
 * adivinarse.
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
      const r = await tomarFotoStock(admin, c.id);
      resultados.push({ cuenta: c.nickname, ok: !r.incompleta, ...r });
    } catch (err) {
      resultados.push({ cuenta: c.nickname, ok: false, error: (err as Error).message });
    }
  }

  // Un 500 aquí no es decorativo: hace que Vercel marque la corrida como
  // fallida y el hueco se vea en el panel en vez de pasar callado.
  const fallo = resultados.some((r) => r.ok === false);
  return NextResponse.json({ fotos: resultados.length, resultados }, { status: fallo ? 500 : 200 });
}
