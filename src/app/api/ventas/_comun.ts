import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type Cuenta, type DB } from "@/lib/datos/repos";

/** Sesión + cuenta de MELI, o la respuesta de error lista para devolver. */
export async function sesionYCuenta(): Promise<
  { ok: true; supabase: DB; cuenta: Cuenta; userId: string } | { ok: false; respuesta: NextResponse }
> {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, respuesta: NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 }) };
  }
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return { ok: false, respuesta: NextResponse.json({ error: "No hay cuenta de MELI conectada." }, { status: 400 }) };
  }
  return { ok: true, supabase, cuenta, userId: user.id };
}

export function respuestaPdf(bytes: Uint8Array, nombre: string): NextResponse {
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}

export function respuestaExcel(buffer: Buffer, nombre: string): NextResponse {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}
