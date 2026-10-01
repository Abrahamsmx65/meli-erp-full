import { NextResponse } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { refrescarCatalogoTienda } from "@/lib/servicios/tienda-catalogo";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Botón «Actualizar catálogo»: relee de TikTok TODOS los productos activos (fotos, colores, tallas, precio). */
export async function POST() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  try {
    const r = await refrescarCatalogoTienda(clienteAdmin(), cuenta.id, 240_000, { todo: true });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
