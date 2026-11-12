import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { atenderGetAmazon, atenderPostAmazon } from "@/lib/servicios/amazon-publicar-rutas";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

async function cuenta(): Promise<string | NextResponse> {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const c = await cuentaActiva(supabase);
  if (!c) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  return c.id;
}

export async function GET(req: NextRequest) {
  const c = await cuenta();
  return c instanceof NextResponse ? c : atenderGetAmazon(c, req);
}

export async function POST(req: NextRequest) {
  const c = await cuenta();
  return c instanceof NextResponse ? c : atenderPostAmazon(c, req);
}
