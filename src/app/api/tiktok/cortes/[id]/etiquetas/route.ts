import { after } from "next/server";
import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { pdfEtiquetasDelCorte } from "@/lib/servicios/tiktok-despacho";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const { id } = await ctx.params;
  const corteId = Number(id);
  if (!Number.isFinite(corteId)) return NextResponse.json({ error: "Corte inválido." }, { status: 400 });

  try {
    const admin = clienteAdmin();
    const pdf = await pdfEtiquetasDelCorte(admin, cuenta.id, corteId);
    // Un corte grande (el #35 del 21-sep-2026 juntó 798 pedidos) no alcanza
    // a bajar todas sus guías en una sola petición: las que faltaron salen
    // como «SIN GUÍA» y el PDF del corte no se guarda. Aquí se sigue bajando
    // lo que falta en el fondo, para que la siguiente impresión ya salga
    // completa; si ya estaba completo, esto es leer un archivo y nada más.
    after(async () => {
      await pdfEtiquetasDelCorte(admin, cuenta.id, corteId).catch(() => undefined);
    });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="corte-${corteId}-etiquetas.pdf"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
