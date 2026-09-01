import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { armarZipDeModelo } from "@/lib/servicios/contenido-imagenes";
import { respuestaZip } from "@/lib/servicios/contenido-respuesta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Todas las imágenes de un modelo, en un ZIP con una carpeta por color. */
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

  return respuestaZip(
    await armarZipDeModelo(supabase, { id: cuenta.id, pais: cuenta.pais ?? null }, decodeURIComponent(modelo ?? "")),
  );
}
