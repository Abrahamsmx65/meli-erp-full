import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { aplicarPrecios, normalizarModelos, revisarPrecios } from "@/lib/servicios/precios-modelos";
import { leerAsignaciones, leerStocks } from "@/lib/precios/promociones";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Precios de Números → MELI (relámpago, Buen Fin, todos los días) y Amazon
 * (PVP deal). GET revisa sin escribir; POST aplica lo revisado.
 */
async function preparar(req: NextRequest, modelosCrudos: unknown) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 }) };
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return { error: NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 }) };
  const modelos = normalizarModelos(modelosCrudos);
  if (!modelos.length) return { error: NextResponse.json({ error: "Escribe al menos un modelo (GT251, GT253…)." }, { status: 400 }) };
  if (modelos.length > 20) return { error: NextResponse.json({ error: "Máximo 20 modelos a la vez." }, { status: 400 }) };
  const admin = clienteAdmin() as DB;
  const cliente = await clienteDeCuenta(admin, cuenta.id);
  if (!cliente) return { error: NextResponse.json({ error: "La cuenta no tiene tokens de MELI guardados." }, { status: 500 }) };
  return { db: supabase as DB, admin, cliente, cuentaId: cuenta.id, modelos };
}

export async function GET(req: NextRequest) {
  const p = await preparar(req, req.nextUrl.searchParams.get("modelos"));
  if ("error" in p) return p.error;
  try {
    let asignadas = {};
    try {
      asignadas = leerAsignaciones(JSON.parse(req.nextUrl.searchParams.get("asignadas") ?? "{}"));
    } catch {
      /* sin asignaciones */
    }
    return NextResponse.json(await revisarPrecios(p.db, p.admin, p.cliente, p.cuentaId, p.modelos, asignadas));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { modelos?: unknown; asignadas?: unknown; stocks?: unknown };
  const p = await preparar(req, body.modelos);
  if ("error" in p) return p.error;
  try {
    return NextResponse.json(await aplicarPrecios(p.db, p.admin, p.cliente, p.cuentaId, p.modelos, leerAsignaciones(body.asignadas), leerStocks(body.stocks)));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
