import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { resolverEtiquetas } from "@/lib/etiquetas/resolver";
import { generarZpl } from "@/lib/etiquetas/zpl";

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

  const etiquetas = await resolverEtiquetas(supabase, cuenta.id, pedidas);
  const conCodigo = etiquetas.filter((e) => e.codigoFull);
  if (!conCodigo.length) {
    return NextResponse.json(
      { error: "Ninguno de esos SKUs tiene código Full todavía." },
      { status: 400 },
    );
  }

  const zpl = generarZpl(conCodigo);
  return new NextResponse(zpl, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="etiquetas.txt"',
      "Cache-Control": "no-store",
    },
  });
}
