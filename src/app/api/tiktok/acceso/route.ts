import { NextResponse } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { rotarTokenPreparar, tokenPreparar } from "@/lib/servicios/acceso-preparar";
import { clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** El link de empleados (GET lo enseña; POST genera uno nuevo y mata el anterior). */
async function dueno() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return cuentaActiva(supabase);
}

export async function GET() {
  const cuenta = await dueno();
  if (!cuenta) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  return NextResponse.json({ token: await tokenPreparar(cuenta.id) });
}

export async function POST() {
  const cuenta = await dueno();
  if (!cuenta) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  try {
    return NextResponse.json({ token: await rotarTokenPreparar(cuenta.id) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
