import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { avisarErp } from "@/lib/erp";

export const dynamic = "force-dynamic";

/** Cada 10 min: los pedidos que no se pagaron a tiempo sueltan sus pares (y TikTok los vuelve a ofrecer). */
export async function GET(req: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const { data, error } = await db().rpc("tienda_expirar", { p_account: config.cuenta() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const soltados = Array.isArray(data) ? data.length : 0;
  if (soltados) await avisarErp(`caducaron pedidos (${soltados} SKU)`);
  return NextResponse.json({ ok: true, soltados });
}
