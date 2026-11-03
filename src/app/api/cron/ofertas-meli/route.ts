import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import type { DB } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { leerConfigOfertas, revisarOfertas } from "@/lib/servicios/ofertas-meli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

/**
 * Cada hora (vercel.json): revisa las ofertas con aporte de MELI de la
 * cuenta de calzado y, con «Aceptar solas» prendido, acepta las que
 * cumplen el PV normal de Números.
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
    const { automatico } = await leerConfigOfertas(admin, cuentaId);
    const r = await revisarOfertas(admin, cliente, cuentaId, { aceptar: automatico, origen: "cron" });
    return NextResponse.json({
      automatico,
      ofertas: r.renglones.length,
      aceptadas: r.ultimaAceptacion?.origen === "cron" ? r.ultimaAceptacion.aceptadas.length : 0,
      avisos: r.avisos,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
