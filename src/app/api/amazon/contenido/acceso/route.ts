import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { rotarToken } from "@/lib/servicios/acceso-contenido";

export const dynamic = "force-dynamic";

/**
 * Genera un link nuevo para el acceso sin contraseña y deja muerto el
 * anterior. Es la única forma de revocar si el link se filtró.
 */
export async function POST() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaAmazon(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "No hay ninguna cuenta de Amazon conectada." }, { status: 400 });
  }

  try {
    return NextResponse.json({ ok: true, token: await rotarToken(cuenta.id) });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      {
        error: msg.includes("does not exist")
          ? "Falta aplicar la migración 0033 en Supabase (tabla contenido_acceso)."
          : msg,
      },
      { status: 500 },
    );
  }
}
