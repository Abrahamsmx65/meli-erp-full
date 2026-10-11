import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { excelDeBorrador } from "@/lib/servicios/pedidos-borradores";

export const dynamic = "force-dynamic";

/** El Excel del pedido en el formato de su fábrica (borrador o confirmado). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Conecta primero tu cuenta." }, { status: 400 });
  const { id } = await params;
  try {
    const { nombre, contenido } = await excelDeBorrador(supabase, cuenta.id, id);
    return new NextResponse(new Uint8Array(contenido), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
