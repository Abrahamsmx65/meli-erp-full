import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { zipEtiquetasDePedido } from "@/lib/servicios/etiquetas-pedido";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** El ZIP de etiquetas del pedido; el armado vive en `servicios/etiquetas-pedido.ts`. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Conecta Mercado Libre." }, { status: 400 });

  try {
    const { nombre, contenido } = await zipEtiquetasDePedido(supabase, cuenta.id, id);
    return new NextResponse(new Uint8Array(contenido), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${nombre}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: msg === "Pedido no encontrado." ? 404 : 400 });
  }
}
