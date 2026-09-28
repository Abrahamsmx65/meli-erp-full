import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import type { Cuenta } from "@/lib/datos/repos";
import { enviarResumenDiario } from "@/lib/servicios/resumen-diario";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Correo de las 7:00 de México (13:00Z, vercel.json) con las ventas de AYER
 * de las cuatro plataformas. Mismo secreto que los demás crons. Para
 * probarlo a mano: `?dia=YYYY-MM-DD&forzar=1` (sin `forzar`, un día ya
 * mandado no se repite).
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const presentado = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!presentado) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const admin = clienteAdmin();
  let autorizado = Boolean(process.env.CRON_SECRET) && presentado === process.env.CRON_SECRET;
  if (!autorizado) {
    const { data } = await admin.from("app_secretos").select("valor").eq("clave", "cron_amazon").maybeSingle();
    autorizado = Boolean(data?.valor) && presentado === data!.valor;
  }
  if (!autorizado) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("dia") ?? "") ? (sp.get("dia") as string) : undefined;
  const forzar = sp.get("forzar") === "1";

  // El ERP cuelga de la primera cuenta de MELI (la de calzado); Amazon,
  // fundas y TikTok se leen desde ella como en el corte general.
  const { data: cuentas } = await admin
    .from("meli_accounts")
    .select("id, meli_user_id, nickname, site_id")
    .order("creado_en", { ascending: true })
    .limit(1);
  const cuenta = (cuentas ?? [])[0] as Cuenta | undefined;
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta de Mercado Libre." }, { status: 404 });
  try {
    return NextResponse.json(await enviarResumenDiario(admin, cuenta, { dia, forzar }));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
