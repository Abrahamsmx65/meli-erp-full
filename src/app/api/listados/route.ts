import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { leerGrupoListados } from "@/lib/servicios/listados";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Lee EN VIVO las publicaciones de un agrupador con sus variantes y diferencias. */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const agrupador = req.nextUrl.searchParams.get("agrupador")?.trim() ?? "";
  if (!agrupador) return NextResponse.json({ error: "Falta el agrupador." }, { status: 400 });

  // Los tokens viven en meli_tokens, que solo lee el service role.
  const cliente = await clienteDeCuenta(clienteAdmin(), cuenta.id);
  if (!cliente) {
    return NextResponse.json(
      { error: "La cuenta no tiene tokens de MELI guardados." },
      { status: 500 },
    );
  }

  try {
    const grupo = await leerGrupoListados(cliente, supabase, cuenta.id, agrupador);
    if (!grupo) {
      return NextResponse.json(
        { error: `No hay publicaciones con el agrupador "${agrupador}" en el catálogo.` },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, grupo });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
