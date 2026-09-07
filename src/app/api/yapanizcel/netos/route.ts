import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { esCron } from "@/lib/yapanizcel/api";
import { correrNetos } from "@/lib/yapanizcel/netos";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Trabajo de fondo de YAPANIZCEL: el neto real de cada orden, orden por
 * orden contra Mercado Pago, y el registro hacia atrás de las órdenes
 * viejas. Cron cada 10 minutos (~4 minutos y medio de trabajo por corrida)
 * o a mano con sesión.
 */
async function autorizado(req: NextRequest): Promise<boolean> {
  if (esCron(req)) return true;
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return Boolean(user);
}

export async function GET(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const admin = clienteAdmin();
  const { data: cuentas } = await admin.from("yz_cuentas").select("id, nickname");
  const resultados: Record<string, unknown>[] = [];
  const t0 = Date.now();
  for (const c of cuentas ?? []) {
    try {
      resultados.push({ cuenta: c.nickname, ...(await correrNetos(admin, c.id, 270_000 - (Date.now() - t0))) });
    } catch (err) {
      resultados.push({ cuenta: c.nickname, error: (err as Error).message });
    }
  }
  return NextResponse.json({ ok: true, resultados });
}
