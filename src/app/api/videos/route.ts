import { NextResponse, after, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import {
  credencialesHiggsfield,
  generarVideo,
  generarVideoKling,
  generarVideoVeo,
  subirImagen,
} from "@/lib/higgsfield/client";
import { validarPrompt, validarImagenUrl, construirEntradaDop } from "@/lib/higgsfield/presets";
import { dispararVideos } from "@/lib/servicios/disparar-videos";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Encola un video de producto.
 *
 * REGLA DE ORO: el producto no se altera. El video se genera DIRECTO de la
 * foto real de la publicación; nada de regenerar imágenes con IA (eso
 * redibujaba el producto y quedó prohibido).
 *
 * Modos:
 * - `clip`: para MELI. El navegador arma un lienzo vertical 9:16 con la
 *   foto real tal cual (fondo difuminado de la misma foto), se sube al CDN
 *   de Higgsfield y Kling lo anima 10 s — el mínimo de los Clips.
 * - `hablado`: mismo lienzo, animado por Veo 3.1 (8 s) con VOZ EN OFF en
 *   español presentando el producto. Para redes.
 * - `dop`: prueba rápida ~5 s; acepta VARIAS fotos reales como referencia.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  if (!credencialesHiggsfield()) {
    return NextResponse.json(
      { error: "Falta configurar HIGGSFIELD_CREDENTIALS. Crea una llave de API en cloud.higgsfield.ai y ponla en las variables de entorno." },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => null);
  const formato =
    body?.formato === "clip" ? "clip" : body?.formato === "hablado" ? "hablado" : "dop";

  let imagenUrl: string;
  let promptVideo: string;
  try {
    imagenUrl = validarImagenUrl(String(body?.imagenUrl ?? ""));
    promptVideo = validarPrompt(String(body?.prompt ?? ""));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  // Lienzo 9:16 (clip y hablado): la foto real montada en vertical, armada
  // en el navegador SIN IA. Llega como data URL y se sube al CDN de
  // Higgsfield, porque los modelos necesitan una URL.
  let lienzoUrl: string | null = null;
  if (formato === "clip" || formato === "hablado") {
    const lienzo = String(body?.imagenLienzo ?? "");
    const coincide = /^data:(image\/jpeg);base64,(.+)$/.exec(lienzo);
    if (!coincide) {
      return NextResponse.json({ error: "Falta el lienzo vertical de la foto." }, { status: 400 });
    }
    const datos = Buffer.from(coincide[2], "base64");
    if (datos.length > 3 * 1024 * 1024) {
      return NextResponse.json({ error: "El lienzo pesa demasiado." }, { status: 400 });
    }
    try {
      lienzoUrl = await subirImagen(datos, "image/jpeg");
    } catch (err) {
      return NextResponse.json(
        { error: `No se pudo subir la foto: ${(err as Error).message}` },
        { status: 502 },
      );
    }
  }

  // Fotos extra (solo DoP, que sí acepta varias referencias reales).
  const fotos: string[] = [];
  if (formato === "dop" && Array.isArray(body?.fotos)) {
    for (const f of body.fotos.slice(0, 6)) {
      try {
        fotos.push(validarImagenUrl(String(f)));
      } catch {
        // Una foto rara no tumba el intento; simplemente no se manda.
      }
    }
  }
  if (!fotos.length) fotos.push(imagenUrl);

  const { data: fila, error: errIns } = await supabase
    .from("videos_producto")
    .insert({
      account_id: cuenta.id,
      item_id: body?.itemId ? String(body.itemId) : null,
      sku: body?.sku ? String(body.sku) : null,
      titulo: body?.titulo ? String(body.titulo) : null,
      imagen_url: imagenUrl,
      imagen_generada: lienzoUrl, // el lienzo 9:16 (foto real, sin IA)
      prompt: promptVideo,
      preset: body?.escena ? String(body.escena) : null,
      modelo:
        formato === "clip"
          ? "kling-2.5-turbo"
          : formato === "hablado"
            ? "veo-3.1"
            : String(body?.modelo ?? "dop-turbo"),
      formato,
      etapa: "video",
      duracion: formato === "clip" ? 10 : formato === "hablado" ? 8 : 5,
    })
    .select("id")
    .single();

  if (errIns || !fila) {
    return NextResponse.json({ error: errIns?.message ?? "No se pudo guardar." }, { status: 500 });
  }

  try {
    let requestId: string;
    if (formato === "clip") {
      const res = await generarVideoKling({
        prompt: promptVideo,
        image_url: lienzoUrl!,
        duration: 10,
      });
      requestId = res.id;
    } else if (formato === "hablado") {
      const res = await generarVideoVeo({
        prompt: promptVideo,
        image_url: lienzoUrl!,
        duration: 8,
        resolution: "1080p",
      });
      requestId = res.id;
    } else {
      const entrada = construirEntradaDop({
        prompt: promptVideo,
        imagenUrl: fotos[0],
        modelo: String(body?.modelo ?? "dop-turbo"),
      });
      // Todas las fotos reales seleccionadas van de referencia.
      entrada.input_images = fotos.map((f) => ({ type: "image_url" as const, image_url: f }));
      const res = await generarVideo(entrada);
      requestId = res.id;
    }
    if (!requestId) throw new Error("Higgsfield no devolvió folio.");

    await supabase
      .from("videos_producto")
      .update({
        request_id: requestId,
        estado: "enviado",
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

  // Que el vigilante empiece a preguntar cómo va.
  const origen = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  after(() => dispararVideos(origen));

  return NextResponse.json({ ok: true, id: fila.id }, { status: 202 });
}

/** Borra un intento de la lista (el archivo en Storage se queda, no estorba). */
export async function DELETE(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta el id." }, { status: 400 });

  const { error } = await supabase
    .from("videos_producto")
    .delete()
    .eq("account_id", cuenta.id)
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
