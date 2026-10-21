import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import type { Cuenta } from "@/lib/datos/repos";
import { revisarConfirmacionPedidos } from "@/lib/servicios/confirmacion-pedidos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Las 8:00 de México (14:00Z, vercel.json): ¿China ya subió al sheet los
 * pedidos nuevos? Relee el sheet, lo deja masticado para Órdenes de compra
 * y, si algo falta por confirmar o se confirmó desde ayer, avisa al dueño.
 * Para probarlo a mano: `?forzar=1` (repite el correo del día) o
 * `?sin_correo=1` (solo revisa y guarda); `&para=…` cambia el destinatario.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const presentado = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!presentado || !process.env.CRON_SECRET || presentado !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const admin = clienteAdmin();
  const { data: cuentas } = await admin
    .from("meli_accounts")
    .select("id, meli_user_id, nickname, site_id")
    .order("creado_en", { ascending: true })
    .limit(1);
  const cuenta = (cuentas ?? [])[0] as Cuenta | undefined;
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta de Mercado Libre." }, { status: 404 });

  try {
    const r = await revisarConfirmacionPedidos(admin, cuenta, {
      forzar: sp.get("forzar") === "1",
      sinCorreo: sp.get("sin_correo") === "1",
      para: sp.get("para") || undefined,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    await admin.from("sync_log").insert({
      account_id: cuenta.id,
      tarea: "confirmacion-pedidos",
      fin: new Date().toISOString(),
      estado: "error",
      detalle: { error: (err as Error).message },
    });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
