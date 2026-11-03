import { NextResponse } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { confirmarRelampagosPendientes, contarRelampagosPendientes } from "@/lib/servicios/precios-modelos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

/**
 * Botón «Confirmar relámpagos» de Números: lo mismo que el cron de las
 * 10:00 (`/api/cron/relampagos`), a mano. Solo inscribe relámpago
 * CANDIDATAS al precio relámpago de Números; MELI rechaza las que no lo
 * aceptan y nunca se baja más.
 */
export async function POST() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  const admin = clienteAdmin() as DB;
  const cliente = await clienteDeCuenta(admin, cuenta.id);
  if (!cliente) return NextResponse.json({ error: "La cuenta no tiene tokens de MELI guardados." }, { status: 500 });
  try {
    return NextResponse.json(await confirmarRelampagosPendientes(admin, cliente, cuenta.id, "manual"));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** Solo lee: cuántas relámpago propuestas siguen sin confirmar y por qué fecha. */
export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  const admin = clienteAdmin() as DB;
  const cliente = await clienteDeCuenta(admin, cuenta.id);
  if (!cliente) return NextResponse.json({ error: "La cuenta no tiene tokens de MELI guardados." }, { status: 500 });
  try {
    const conteo = await contarRelampagosPendientes(admin, cliente, cuenta.id);
    await admin.from("sync_log").insert({
      account_id: cuenta.id,
      tarea: "relampagos-conteo",
      estado: "ok",
      fin: new Date().toISOString(),
      detalle: conteo,
    });
    return NextResponse.json(conteo);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
