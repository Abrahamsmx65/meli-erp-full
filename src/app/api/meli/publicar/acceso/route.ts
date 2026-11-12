import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { rolDeSesion } from "@/lib/acceso/roles";
import { quitarTokenDePublicar, rotarTokenDePublicar } from "@/lib/servicios/acceso-publicar";

export const dynamic = "force-dynamic";

/** Crea o cambia (`accion: "crear"`) o apaga (`"quitar"`) el link para publicar sin entrar al ERP. Solo el dueño. */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  if (rolDeSesion(user) !== "dueño") return NextResponse.json({ error: "Solo el dueño." }, { status: 403 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { accion?: string };
  try {
    if (body.accion === "quitar") {
      await quitarTokenDePublicar(cuenta.id);
      return NextResponse.json({ token: null });
    }
    return NextResponse.json({ token: await rotarTokenDePublicar(cuenta.id) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
