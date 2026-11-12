import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sube UNA foto a MELI y contesta su id (el que luego viaja al publicar).
 * El navegador la manda ya reducida: Vercel no acepta cuerpos de más de 4.5 MB.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const forma = await req.formData().catch(() => null);
  const archivo = forma?.get("file");
  if (!(archivo instanceof Blob) || !archivo.size) {
    return NextResponse.json({ error: "No llegó la foto." }, { status: 400 });
  }
  if (!/^image\/(jpeg|png|webp)$/.test(archivo.type)) {
    return NextResponse.json({ error: "La foto tiene que ser JPG, PNG o WEBP." }, { status: 400 });
  }

  const cliente = await clienteDeCuenta(clienteAdmin(), cuenta.id);
  if (!cliente) return NextResponse.json({ error: "La cuenta no tiene tokens de MELI guardados." }, { status: 500 });

  try {
    const nombre = archivo instanceof File && archivo.name ? archivo.name : "foto.jpg";
    return NextResponse.json(await cliente.subirImagen(archivo, nombre));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
