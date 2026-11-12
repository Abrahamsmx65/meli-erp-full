import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { atenderGet, atenderPost, contextoDeCuenta } from "@/lib/servicios/meli-publicar-rutas";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

async function contexto() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  return contextoDeCuenta(cuenta.id);
}

export async function GET(req: NextRequest) {
  const c = await contexto();
  return c instanceof NextResponse ? c : atenderGet(c, req);
}

export async function POST(req: NextRequest) {
  const c = await contexto();
  return c instanceof NextResponse ? c : atenderPost(c, req);
}
