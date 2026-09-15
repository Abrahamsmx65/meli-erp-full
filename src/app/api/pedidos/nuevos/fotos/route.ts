import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor, clienteAdmin } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { revisarFotosDeNuevos } from "@/lib/servicios/productos-nuevos-revisar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cuántas fotos tiene cada producto nuevo en MELI y en Amazon. Lo revisado
 * se GUARDA y solo se vuelve a preguntar por lo que le falta; `?todo=1`
 * revisa todo de nuevo. El trabajo vive en `productos-nuevos-revisar.ts`.
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Conecta Mercado Libre." }, { status: 400 });

  const todo = req.nextUrl.searchParams.get("todo") === "1";
  try {
    const { lista: _lista, ...r } = await revisarFotosDeNuevos(supabase, clienteAdmin(), cuenta.id, todo);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
