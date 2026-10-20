import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import type { DB } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { confirmarRelampagosPendientes } from "@/lib/servicios/precios-modelos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

/**
 * 10:00 de México (16:00Z) y 00:30 (06:30Z, vercel.json): inscribe las
 * relámpago candidatas que cumplen el precio relámpago de Números. MELI deja
 * una sola programada por publicación por el API; la de las 00:30 alcanza la
 * relámpago del día en cuanto termina la de ayer. Mismo secreto que los demás
 * crons.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const presentado = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!presentado || !process.env.CRON_SECRET || presentado !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const admin = clienteAdmin() as DB;
  const { data: cuentas } = await admin.from("meli_accounts").select("id").order("creado_en", { ascending: true }).limit(1);
  const cuentaId = (cuentas ?? [])[0]?.id as string | undefined;
  if (!cuentaId) return NextResponse.json({ error: "Sin cuenta de Mercado Libre." }, { status: 404 });
  const cliente = await clienteDeCuenta(admin, cuentaId);
  if (!cliente) return NextResponse.json({ error: "La cuenta no tiene tokens de MELI." }, { status: 500 });
  try {
    return NextResponse.json(await confirmarRelampagosPendientes(admin, cliente, cuentaId));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
