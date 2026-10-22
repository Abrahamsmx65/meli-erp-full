import { NextResponse } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { confirmarBuenFinPendientes } from "@/lib/servicios/precios-modelos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

/**
 * Botón «Confirmar Buen Fin»: lo mismo que hace el cron de relámpagos con
 * Buen Fin, a mano. Inscribe o corrige cada promoción de Buen Fin al PV
 * normal de Números (a .99) y no toca la que ya está ni la que con el
 * aporte de MELI haría pagar el envío.
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
    return NextResponse.json(await confirmarBuenFinPendientes(admin, cliente, cuenta.id, "manual"));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
