import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { resolverEtiquetas } from "@/lib/etiquetas/resolver";
import { generarPdfAmazon, generarPdfEtiquetas } from "@/lib/etiquetas/pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * El PDF de etiquetas, idéntico al de "Etiquetas de producto" de Mercado
 * Libre (hoja A4, 24 por hoja). Con `tipo: "amazon"` las barras llevan el
 * FNSKU en vez del código Full, en el mismo formato.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const body = await req.json().catch(() => null);
  const pedidas = Array.isArray(body?.skus) ? body.skus : [];
  if (!pedidas.length) return NextResponse.json({ error: "No mandaste ningún SKU." }, { status: 400 });

  const tipo = body?.tipo === "amazon" ? "amazon" : "meli";
  const etiquetas = await resolverEtiquetas(supabase, cuenta.id, pedidas);
  const conCodigo = etiquetas.filter((e) => (tipo === "amazon" ? e.fnsku : e.codigoFull));
  if (!conCodigo.length) {
    return NextResponse.json(
      {
        error:
          tipo === "amazon"
            ? "Ninguno de esos SKUs tiene FNSKU. Aparece cuando el producto existe en el inventario de Amazon; sincroniza Amazon y vuelve a intentar."
            : "Ninguno de esos SKUs tiene código Full todavía.",
      },
      { status: 400 },
    );
  }

  const pdf =
    tipo === "amazon" ? await generarPdfAmazon(conCodigo) : await generarPdfEtiquetas(conCodigo);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="etiquetas${tipo === "amazon" ? "-amazon" : ""}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
