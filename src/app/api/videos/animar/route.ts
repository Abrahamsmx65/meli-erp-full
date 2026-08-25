import { NextResponse, after, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { generarVideoSpeak, generarVideoWan } from "@/lib/higgsfield/client";
import { dispararVideos } from "@/lib/servicios/disparar-videos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Segunda mitad del UGC: el usuario ya ELIGIÓ en cuál de las 4 imágenes
 * candidatas el producto salió fiel, y aquí se lanza la animación sobre esa
 * imagen — Speak v2 si grabó su voz, Wan 2.6 (voz de IA) si no. Separarlo
 * de la generación evita gastar el crédito caro en una imagen mala.
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
  const id = String(body?.id ?? "");
  const imagen = String(body?.imagen ?? "");
  if (!id || !imagen) {
    return NextResponse.json({ error: "Falta el video o la imagen elegida." }, { status: 400 });
  }

  const { data: fila } = await supabase
    .from("videos_producto")
    .select("id, formato, estado, prompt, duracion, audio_url, imagenes_candidatas")
    .eq("account_id", cuenta.id)
    .eq("id", id)
    .single();
  if (!fila) return NextResponse.json({ error: "No existe ese video." }, { status: 404 });
  if (fila.formato !== "ugc" || fila.estado !== "eligiendo") {
    return NextResponse.json({ error: "Ese video no está esperando elección." }, { status: 400 });
  }
  const candidatas: string[] = Array.isArray(fila.imagenes_candidatas)
    ? (fila.imagenes_candidatas as string[])
    : [];
  if (!candidatas.includes(imagen)) {
    return NextResponse.json({ error: "Esa imagen no es de este video." }, { status: 400 });
  }

  try {
    const video = fila.audio_url
      ? await generarVideoSpeak({
          input_image: { type: "image_url", image_url: imagen },
          input_audio: { type: "audio_url", audio_url: fila.audio_url as string },
          prompt: fila.prompt as string,
          quality: "high",
          duration: fila.duracion === 5 ? 5 : fila.duracion === 15 ? 15 : 10,
        })
      : await generarVideoWan({
          prompt: fila.prompt as string,
          image_url: imagen,
          duration: fila.duracion === 15 ? 15 : 10,
        });
    if (!video.id) throw new Error("El modelo de video no devolvió folio.");

    await supabase
      .from("videos_producto")
      .update({
        imagen_generada: imagen,
        etapa: "video",
        request_id: video.id,
        estado: "enviado",
        error: null,
        // El reloj del vigilante arranca de nuevo: la elección pudo tardar.
        creado_en: new Date().toISOString(),
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", fila.id);
  } catch (err) {
    await supabase
      .from("videos_producto")
      .update({
        estado: "fallido",
        error: (err as Error).message.slice(0, 300),
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", fila.id);
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  const origen = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  after(() => dispararVideos(origen));

  return NextResponse.json({ ok: true }, { status: 202 });
}
