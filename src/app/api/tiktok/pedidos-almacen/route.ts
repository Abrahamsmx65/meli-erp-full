import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import {
  armarPedidoDeCuenta,
  cargarPedidoAlmacen,
  desdeSugerido,
  guardarPedidoAlmacen,
  normalizarParametros,
} from "@/lib/servicios/tiktok-pedidos-almacen";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function sesion() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 }) };
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return { error: NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 }) };
  return { supabase, user, cuenta };
}

/**
 * GET ?id=N → el pedido guardado. GET ?desde&hasta&modo&diasObjetivo → cómo
 * quedaría el pedido con esos parámetros, sin guardar nada.
 */
export async function GET(req: NextRequest) {
  const s = await sesion();
  if ("error" in s) return s.error;
  const sp = req.nextUrl.searchParams;
  try {
    const id = Number(sp.get("id"));
    if (Number.isFinite(id) && id > 0) {
      return NextResponse.json(await cargarPedidoAlmacen(s.supabase, s.cuenta.id, id));
    }
    const sugerido = await desdeSugerido(s.supabase, s.cuenta.id);
    const p = normalizarParametros(
      { desde: sp.get("desde"), hasta: sp.get("hasta"), modo: sp.get("modo"), diasObjetivo: sp.get("diasObjetivo") },
      sugerido,
    );
    return NextResponse.json(await armarPedidoDeCuenta(s.supabase, s.cuenta.id, p));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** Arma y GUARDA el pedido con el siguiente número. */
export async function POST(req: NextRequest) {
  const s = await sesion();
  if ("error" in s) return s.error;
  const body = await req.json().catch(() => ({}));
  try {
    const sugerido = await desdeSugerido(s.supabase, s.cuenta.id);
    const p = normalizarParametros(body ?? {}, sugerido);
    const pedido = await guardarPedidoAlmacen(clienteAdmin(), s.cuenta.id, p, s.user.id);
    return NextResponse.json({ ok: true, ...pedido });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
