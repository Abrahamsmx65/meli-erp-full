import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/admin";
import type { DB } from "@/lib/datos/repos";
import { leerSheetsFinanzas } from "@/lib/servicios/sheets-finanzas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Cada hora (vercel.json): lee «Cuentas YAPANIZCEL» y «Números». El sheet manda. */
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
  try {
    return NextResponse.json(await leerSheetsFinanzas(admin, cuentaId));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
