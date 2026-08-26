import { NextResponse, after, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import {
  credencialesHiggsfield,
  generarImagenSoul,
  generarVideo,
  generarVideoKling,
  generarVideoVeo,
  generarVideoWan,
  subirArchivo,
} from "@/lib/higgsfield/client";
import { validarPrompt, validarImagenUrl, construirEntradaDop } from "@/lib/higgsfield/presets";
import {
  abrirSesion,
  llamarHerramienta,
  resultadoEstructurado,
} from "@/lib/higgsfield/mcp";
import { clienteAdmin } from "@/lib/supabase/server";
import { dispararVideos } from "@/lib/servicios/disparar-videos";
import { origenReal } from "@/lib/servicios/origen";

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
 * - `ugc`: una persona presenta el producto hablando a cámara. Es la única
 *   excepción a la regla de oro y el usuario la pidió así: Soul genera la
 *   imagen 9:16 de la persona SOSTENIENDO el producto (con la foto real de
 *   referencia y el candado de fidelidad) y luego, con audio grabado, Speak
 *   v2 la anima con lip sync (10-15 s); sin audio, Veo 3.1 le pone la voz
 *   en español (8 s).
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

  // Studio: el video se genera en la CUENTA de Higgsfield (Marketing Studio
  // vía su MCP) — producto anclado a las fotos reales, avatar consistente y
  // la calidad de la app. Camino aparte: no usa la llave de API.
  if (body?.formato === "studio") {
    return await generarEstudio(req, supabase, cuenta.id, body);
  }

  const formato =
    body?.formato === "clip"
      ? "clip"
      : body?.formato === "hablado"
        ? "hablado"
        : body?.formato === "ugc"
          ? "ugc"
          : "dop";

  let imagenUrl: string;
  let promptVideo: string;
  try {
    imagenUrl = validarImagenUrl(String(body?.imagenUrl ?? ""));
    promptVideo = validarPrompt(String(body?.prompt ?? ""));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  // UGC: si viene audio grabado (WAV) va por Soul + Speak; sin audio el
  // video ARRANCA de la foto real y lo hace Wan de una sola etapa. La
  // duración de Speak es el escalón (5/10/15 s) donde cabe el audio.
  let promptImagenUGC: string | null = null;
  let audioUrl: string | null = null;
  let duracionSpeak: 5 | 10 | 15 = 10;
  if (formato === "ugc") {
    const audio = String(body?.audio ?? "");
    if (audio) {
      const coincide = /^data:audio\/wav;base64,(.+)$/.exec(audio);
      if (!coincide) {
        return NextResponse.json({ error: "El audio debe llegar en WAV." }, { status: 400 });
      }
      const datos = Buffer.from(coincide[1], "base64");
      if (datos.length > 3 * 1024 * 1024) {
        return NextResponse.json({ error: "El audio pesa demasiado." }, { status: 400 });
      }
      const segundos = Number(body?.audioDuracion ?? 0);
      if (!segundos || segundos > 15) {
        return NextResponse.json(
          { error: "El audio debe durar entre 1 y 15 segundos." },
          { status: 400 },
        );
      }
      duracionSpeak = segundos <= 5 ? 5 : segundos <= 10 ? 10 : 15;
      try {
        audioUrl = await subirArchivo(datos, "audio/wav");
      } catch (err) {
        return NextResponse.json(
          { error: `No se pudo subir el audio: ${(err as Error).message}` },
          { status: 502 },
        );
      }
    }
    // El prompt de la persona (Soul) solo hace falta en el camino con audio.
    if (audioUrl) {
      try {
        promptImagenUGC = validarPrompt(String(body?.promptImagen ?? ""));
      } catch {
        return NextResponse.json(
          { error: "Falta el prompt de la persona (UGC)." },
          { status: 400 },
        );
      }
    }
  }

  // Lienzo 9:16: la foto real montada en vertical, armada en el navegador
  // SIN IA. Llega como data URL y se sube al CDN de Higgsfield, porque los
  // modelos necesitan una URL. El UGC con voz de IA también parte de aquí:
  // es el primer cuadro del video y por eso el producto sale idéntico.
  let lienzoUrl: string | null = null;
  if (formato === "clip" || formato === "hablado" || (formato === "ugc" && !audioUrl)) {
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
      lienzoUrl = await subirArchivo(datos, "image/jpeg");
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
      prompt_imagen: promptImagenUGC,
      audio_url: audioUrl,
      preset: body?.escena ? String(body.escena) : null,
      modelo:
        formato === "clip"
          ? "kling-2.5-turbo"
          : formato === "hablado"
            ? "veo-3.1"
            : formato === "ugc"
              ? audioUrl
                ? "speak-v2"
                : "wan-2.6"
              : String(body?.modelo ?? "dop-turbo"),
      formato,
      // Solo el UGC con audio pasa por la imagen de la persona; el resto
      // (incluido el UGC con voz de IA, que parte de la foto real) va
      // directo al video.
      etapa: formato === "ugc" && audioUrl ? "imagen" : "video",
      duracion:
        formato === "clip"
          ? 10
          : formato === "hablado"
            ? 8
            : formato === "ugc"
              ? audioUrl
                ? duracionSpeak
                : // Voz de IA con Wan 2.6: 10 o 15 s según el guion.
                  Number(body?.duracion) === 15
                  ? 15
                  : 10
              : 5,
    })
    .select("id")
    .single();

  if (errIns || !fila) {
    return NextResponse.json({ error: errIns?.message ?? "No se pudo guardar." }, { status: 500 });
  }

  try {
    let requestId: string;
    if (formato === "ugc" && audioUrl) {
      // Camino con audio grabado — etapa 1: la imagen de la persona (Soul,
      // 4 candidatas; el usuario elige en cuál salió fiel el producto antes
      // de gastar la animación con Speak).
      const res = await generarImagenSoul({
        prompt: promptImagenUGC!,
        width_and_height: "1152x2048",
        quality: "1080p",
        batch_size: 4,
        image_reference: { type: "image_url", image_url: imagenUrl },
      });
      requestId = res.id;
      if (!requestId) throw new Error("Higgsfield no devolvió folio.");
      await supabase
        .from("videos_producto")
        .update({
          request_id_imagen: requestId,
          estado: "enviado",
          actualizado_en: new Date().toISOString(),
        })
        .eq("id", fila.id);
      const origenUgc = origenReal(req);
      after(() => dispararVideos(origenUgc));
      return NextResponse.json({ ok: true, id: fila.id }, { status: 202 });
    }
    if (formato === "ugc") {
      // Voz de IA en UNA etapa: el video arranca del lienzo con la foto
      // REAL (producto idéntico) y Wan mete a la persona, la voz y el
      // movimiento — todo en una toma continua.
      const res = await generarVideoWan({
        prompt: promptVideo,
        image_url: lienzoUrl!,
        duration: Number(body?.duracion) === 15 ? 15 : 10,
      });
      requestId = res.id;
    } else if (formato === "clip") {
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
  const origen = origenReal(req);
  after(() => dispararVideos(origen));

  return NextResponse.json({ ok: true, id: fila.id }, { status: 202 });
}

/**
 * Genera el video en el Marketing Studio de la cuenta conectada:
 * 1. Crea (o reutiliza) el PRODUCTO con las fotos reales de la publicación —
 *    ahí vive el candado de fidelidad de verdad.
 * 2. Lanza marketing_studio_video con el modo (UGC/Unboxing/Reseña…), el
 *    avatar fijo si se eligió, 9:16 y las instrucciones en español.
 * 3. El vigilante sondea el job por el MCP y guarda el MP4 en Storage.
 */
async function generarEstudio(
  req: NextRequest,
  supabase: Awaited<ReturnType<typeof clienteServidor>>,
  accountId: string,
  body: any,
): Promise<NextResponse> {
  const titulo = String(body?.titulo ?? "").trim();
  const fotos: string[] = (Array.isArray(body?.fotos) ? body.fotos : [])
    .map((f: unknown) => String(f))
    .filter((f: string) => /^https?:\/\//.test(f))
    .slice(0, 6);
  const instrucciones = String(body?.prompt ?? "").trim();
  const modo = String(body?.modo ?? "UGC");
  const avatarId = body?.avatarId ? String(body.avatarId) : null;

  if (!titulo || !fotos.length) {
    return NextResponse.json({ error: "Faltan el título o las fotos." }, { status: 400 });
  }

  const admin = clienteAdmin();
  let requestId = "";
  try {
    const sesion = await abrirSesion(admin, accountId);

    // 1. Producto anclado a las fotos reales.
    const creado = await llamarHerramienta(sesion, "show_marketing_studio", {
      action: "create",
      type: "product",
      title: titulo.slice(0, 255),
      medias: fotos.map((f) => ({ value: f, role: "image" })),
    });
    const scProducto = resultadoEstructurado(creado);
    const productoId: string | undefined =
      scProducto?.scraping_id ?? scProducto?.items?.[0]?.id;
    if (!productoId) {
      throw new Error(
        `El Studio no devolvió el producto: ${JSON.stringify(scProducto ?? {}).slice(0, 200)}`,
      );
    }

    // 2. El video. Si la cuenta tiene generaciones ilimitadas de prueba, el
    //    MCP pregunta antes de gastar: se usan (gratis) en automático.
    const params: Record<string, unknown> = {
      model: "marketing_studio_video",
      product_ids: [productoId],
      mode: modo,
      aspect_ratio: "9:16",
      duration: 15,
    };
    if (instrucciones) params.prompt = instrucciones;
    if (avatarId) params.avatar_ids = [avatarId];

    let res = await llamarHerramienta(sesion, "generate_video", { params });
    let sc = resultadoEstructurado(res);
    if (sc?.unlim_choice) {
      res = await llamarHerramienta(sesion, "generate_video", {
        params: { ...params, use_unlim: true },
      });
      sc = resultadoEstructurado(res);
    }
    if (sc?.error) throw new Error(String(sc.error).slice(0, 300));
    requestId = sc?.results?.[0]?.id ?? "";
    if (!requestId) {
      throw new Error(`El Studio no devolvió folio: ${JSON.stringify(sc ?? {}).slice(0, 200)}`);
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  const { data: fila, error: errIns } = await supabase
    .from("videos_producto")
    .insert({
      account_id: accountId,
      item_id: body?.itemId ? String(body.itemId) : null,
      sku: body?.sku ? String(body.sku) : null,
      titulo,
      imagen_url: fotos[0],
      prompt: instrucciones || `Marketing Studio · ${modo}`,
      preset: `Studio · ${modo}`,
      modelo: "marketing-studio",
      formato: "studio",
      etapa: "video",
      duracion: 15,
      request_id: requestId,
      estado: "enviado",
    })
    .select("id")
    .single();
  if (errIns || !fila) {
    return NextResponse.json({ error: errIns?.message ?? "No se pudo guardar." }, { status: 500 });
  }

  const origen = origenReal(req);
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
