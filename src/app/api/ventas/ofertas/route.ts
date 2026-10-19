import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { guardarConfigOfertas, revisarOfertas } from "@/lib/servicios/ofertas-meli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

/**
 * Ofertas MELI: `revisar` (solo lee), `aceptar` (acepta las que cumplen el
 * PV normal de Números) y `automatico` (prende o apaga «Aceptar solas»).
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  const cuerpo = (await req.json().catch(() => ({}))) as { accion?: string; valor?: unknown };
  const admin = clienteAdmin() as DB;
  try {
    if (cuerpo.accion === "automatico") {
      await guardarConfigOfertas(admin, cuenta.id, { automatico: Boolean(cuerpo.valor) });
      return NextResponse.json({ automatico: Boolean(cuerpo.valor) });
    }
    if (cuerpo.accion !== "revisar" && cuerpo.accion !== "aceptar") {
      return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
    }
    const cliente = await clienteDeCuenta(admin, cuenta.id);
    if (!cliente) return NextResponse.json({ error: "La cuenta no tiene tokens de MELI guardados." }, { status: 500 });
    const r = await revisarOfertas(admin, cliente, cuenta.id, { aceptar: cuerpo.accion === "aceptar", origen: "manual" });
    return NextResponse.json({ generadoEn: r.generadoEn, ultimaAceptacion: r.ultimaAceptacion, avisos: r.avisos });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
