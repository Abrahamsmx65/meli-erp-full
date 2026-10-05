import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { simularCorte } from "@/lib/servicios/tiktok-despacho";
import { normalizarModelos } from "@/lib/tiktok/corte-modelos";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Qué haría el siguiente corte, sin confirmar nada en TikTok. `?modelos=GT148,GT114` simula un corte por modelo. */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  try {
    const modelos = normalizarModelos((req.nextUrl.searchParams.get("modelos") ?? "").split(","));
    return NextResponse.json(await simularCorte(clienteAdmin(), cuenta.id, modelos));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
