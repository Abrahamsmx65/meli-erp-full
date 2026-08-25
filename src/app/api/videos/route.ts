import { NextResponse, after, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import {
  credencialesHiggsfield,
  generarVideo,
  generarImagenSoul,
} from "@/lib/higgsfield/client";
import { construirEntradaDop, validarPrompt, validarImagenUrl } from "@/lib/higgsfield/presets";
import { dispararVideos } from "@/lib/servicios/disparar-videos";

export const dynamic = "force-dynamic";

/**
 * Encola un video de producto.
 *
 * Dos modos:
 * - `clip`: el bueno para MELI. Soul genera primero una foto vertical 9:16
 *   (con el personaje usando el producto, o solo el producto) y cuando esa
 *   foto está lista, el vigilante la anima con Kling 10 segundos — justo el
 *   mínimo que piden los Clips de Mercado Libre.
 * - `dop`: prueba rápida de ~5 s directa de la foto de la publicación.
 *
 * La fila se guarda ANTES de llamar a Higgsfield: si la llamada truena, el
 * intento queda registrado como fallido con su motivo, no desaparece.
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
  const enDosEtapas = formato === "clip" || formato === "hablado";

  let imagenUrl: string;
  let promptVideo: string;
  let promptImagen: string | null = null;
  try {
    imagenUrl = validarImagenUrl(String(body?.imagenUrl ?? ""));
    promptVideo = validarPrompt(String(body?.prompt ?? ""));
    if (enDosEtapas) {
      promptImagen = validarPrompt(String(body?.promptImagen ?? ""));
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  // Personaje (clip o hablado): debe existir, ser de esta cuenta y estar listo.
  let personaje: { id: string; soul_id: string | null } | null = null;
  if (enDosEtapas && body?.personajeId) {
    const { data: p } = await supabase
      .from("personajes_video")
      .select("id, soul_id, estado")
      .eq("account_id", cuenta.id)
      .eq("id", String(body.personajeId))
      .maybeSingle();
    if (!p) return NextResponse.json({ error: "Ese personaje no existe." }, { status: 400 });
    if (p.estado !== "listo" || !p.soul_id) {
      return NextResponse.json(
        { error: "Ese personaje todavía se está entrenando; espera a que diga Listo." },
        { status: 400 },
      );
    }
    personaje = { id: p.id as string, soul_id: p.soul_id as string };
  }

  const { data: fila, error: errIns } = await supabase
    .from("videos_producto")
    .insert({
      account_id: cuenta.id,
      item_id: body?.itemId ? String(body.itemId) : null,
      sku: body?.sku ? String(body.sku) : null,
      titulo: body?.titulo ? String(body.titulo) : null,
      imagen_url: imagenUrl,
      prompt: promptVideo,
      prompt_imagen: promptImagen,
      preset: body?.escena ? String(body.escena) : null,
      modelo:
        formato === "clip"
          ? "soul+kling-2.5-turbo"
          : formato === "hablado"
            ? "soul+veo-3.1"
            : String(body?.modelo ?? "dop-turbo"),
      formato,
      etapa: enDosEtapas ? "imagen" : "video",
      duracion: formato === "clip" ? 10 : formato === "hablado" ? 8 : 5,
      personaje_id: personaje?.id ?? null,
    })
    .select("id")
    .single();

  if (errIns || !fila) {
    return NextResponse.json({ error: errIns?.message ?? "No se pudo guardar." }, { status: 500 });
  }

  try {
    let requestId: string;
    if (enDosEtapas) {
      // Etapa 1: la foto vertical 9:16. La animación la lanza el vigilante
      // cuando esta foto termina.
      const res = await generarImagenSoul({
        prompt: promptImagen!,
        width_and_height: "1152x2048",
        quality: "1080p",
        batch_size: 1,
        enhance_prompt: false, // el prompt ya viene armado por el motor de escenas
        image_reference: { type: "image_url", image_url: imagenUrl },
        ...(personaje
          ? { custom_reference_id: personaje.soul_id!, custom_reference_strength: 0.8 }
          : {}),
      });
      if (!res.id) throw new Error("Higgsfield no devolvió folio.");
      requestId = res.id;
      await supabase
        .from("videos_producto")
        .update({
          request_id_imagen: requestId,
          estado: "enviado",
          actualizado_en: new Date().toISOString(),
        })
        .eq("id", fila.id);
    } else {
      const entrada = construirEntradaDop({
        prompt: promptVideo,
        imagenUrl,
        modelo: String(body?.modelo ?? "dop-turbo"),
      });
      const res = await generarVideo(entrada);
      if (!res.id) throw new Error("Higgsfield no devolvió folio.");
      await supabase
        .from("videos_producto")
        .update({
          request_id: res.id,
          estado: "enviado",
          actualizado_en: new Date().toISOString(),
        })
        .eq("id", fila.id);
    }
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
