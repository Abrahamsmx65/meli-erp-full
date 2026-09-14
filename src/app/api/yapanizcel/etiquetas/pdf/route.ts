import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/yapanizcel/cuenta";
import { datosDeEtiquetaYz, resolverEtiquetasYz } from "@/lib/yapanizcel/etiquetas";
import { generarPdfMeliDatos } from "@/lib/etiquetas/pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** El PDF de etiquetas de MELI (2 × 1 por página) para las fundas. */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "La cuenta de YAPANIZCEL no está conectada." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const pedidas = Array.isArray(body?.skus) ? body.skus : [];
  if (!pedidas.length) return NextResponse.json({ error: "No mandaste ningún SKU." }, { status: 400 });

  const etiquetas = await resolverEtiquetasYz(supabase, cuenta.id, pedidas);
  const conCodigo = etiquetas.filter((e) => e.codigoFull);
  if (!conCodigo.length) {
    return NextResponse.json(
      { error: "Ninguno de esos SKUs tiene código Full todavía." },
      { status: 400 },
    );
  }

  const pdf = await generarPdfMeliDatos(conCodigo.map(datosDeEtiquetaYz));
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="etiquetas-fundas.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
