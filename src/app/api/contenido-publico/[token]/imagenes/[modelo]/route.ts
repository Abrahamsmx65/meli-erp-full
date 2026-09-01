import { NextResponse } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { cuentaPorToken } from "@/lib/servicios/acceso-contenido";
import { armarZipDeModelo } from "@/lib/servicios/contenido-imagenes";
import { respuestaZip } from "@/lib/servicios/contenido-respuesta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** El ZIP de imágenes para quien entra con el link sin contraseña. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; modelo: string }> },
) {
  const { token, modelo } = await params;
  const cuenta = await cuentaPorToken(token ?? "");
  if (!cuenta) return NextResponse.json({ error: "Este link ya no sirve." }, { status: 404 });

  return respuestaZip(
    await armarZipDeModelo(clienteAdmin(), cuenta, decodeURIComponent(modelo ?? "")),
  );
}
