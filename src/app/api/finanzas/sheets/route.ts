import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { clienteAdmin } from "@/lib/supabase/admin";
import { cuentaActiva, RecursoOcupadoError, type DB } from "@/lib/datos/repos";
import { leerSheetsFinanzas } from "@/lib/servicios/sheets-finanzas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Botón «Leer sheets»: lee en el momento los sheets del dueño (el sheet manda). */
export async function POST() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  try {
    return NextResponse.json(await leerSheetsFinanzas(clienteAdmin() as DB, cuenta.id));
  } catch (err) {
    const ocupado = err instanceof RecursoOcupadoError;
    return NextResponse.json({ error: (err as Error).message }, { status: ocupado ? 409 : 500 });
  }
}
