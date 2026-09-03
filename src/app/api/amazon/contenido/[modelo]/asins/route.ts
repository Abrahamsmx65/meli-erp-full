import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { armarExcelDeAsins } from "@/lib/servicios/contenido-asins";
import { respuestaExcel } from "@/lib/servicios/contenido-respuesta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Todos los ASINs de un modelo (su publicación completa), en un Excel para el A+. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ modelo: string }> },
) {
  const { modelo } = await params;

  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaAmazon(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "No hay ninguna cuenta de Amazon conectada." }, { status: 400 });
  }

  return respuestaExcel(
    await armarExcelDeAsins(
      supabase,
      { id: cuenta.id, pais: cuenta.pais ?? null },
      decodeURIComponent(modelo ?? ""),
    ),
  );
}
