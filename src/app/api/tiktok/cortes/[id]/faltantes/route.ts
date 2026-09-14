import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { faltantesDelCorte, pdfFaltantesDelCorte } from "@/lib/servicios/tiktok-despacho";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Lo que falta por preparar de un corte: el pedido y sus productos. Sin
 * `formato=pdf` contesta JSON (lo que la pantalla enseña en el renglón del
 * corte); con él, la hoja para imprimir.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  const admin = clienteAdmin();
  try {
    if (req.nextUrl.searchParams.get("formato") === "pdf") {
      const pdf = await pdfFaltantesDelCorte(admin, cuenta.id, corteId);
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="corte-${corteId}-faltantes.pdf"`,
        },
      });
    }
    return NextResponse.json(await faltantesDelCorte(admin, cuenta.id, corteId));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
