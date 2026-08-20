import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { resolverEtiquetas } from "@/lib/etiquetas/resolver";
import { generarZpl, generarZplAmazon, generarZplAmbas } from "@/lib/etiquetas/zpl";

export const dynamic = "force-dynamic";

/** El TXT en ZPL, listo para mandarse tal cual a la impresora térmica. */
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

  const tipo =
    body?.tipo === "amazon" ? "amazon" : body?.tipo === "ambas" ? "ambas" : "meli";
  const etiquetas = await resolverEtiquetas(supabase, cuenta.id, pedidas);
  const conCodigo = etiquetas.filter((e) =>
    tipo === "amazon" ? e.fnsku : tipo === "ambas" ? e.fnsku || e.codigoFull : e.codigoFull,
  );
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

  const zpl =
    tipo === "amazon"
      ? generarZplAmazon(conCodigo)
      : tipo === "ambas"
        ? generarZplAmbas(conCodigo)
        : generarZpl(conCodigo);
  const sufijo = tipo === "meli" ? "" : `-${tipo}`;
  return new NextResponse(zpl, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="etiquetas${sufijo}.txt"`,
      "Cache-Control": "no-store",
    },
  });
}
