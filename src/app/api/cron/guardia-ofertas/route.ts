import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import type { DB } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { guardiaDeOfertas } from "@/lib/servicios/guardia-ofertas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

/**
 * 11:00 pm de México (05:00Z, vercel.json): la guardia de ofertas de calzado.
 * Revisa publicación por publicación y quita la relámpago, oferta del día u
 * oferta con aporte, activa o programada, que no cumple el precio de Números
 * (dueño, 16-nov-2026). Bitácora `sync_log` tarea `guardia-ofertas`.
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
    const r = await guardiaDeOfertas(admin, cliente, cuentaId, "cron");
    return NextResponse.json({ publicaciones: r.publicaciones, sinLeer: r.sinLeer, quitadas: r.quitadas.length, fallidas: r.fallidas.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
