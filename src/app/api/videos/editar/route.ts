import { NextResponse, after, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { dispararVideos } from "@/lib/servicios/disparar-videos";
import { origenReal } from "@/lib/servicios/origen";
import {
  abrirSesion,
  generarContestandoAvisos,
  llamarHerramienta,
  resultadoEstructurado,
} from "@/lib/higgsfield/mcp";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Edición de un video YA generado sin regenerarlo: `voice_change` de
 * Higgsfield reemplaza la voz hablada manteniendo visuales y tiempos y
 * re-mezcla el audio. Cuesta una fracción de un video nuevo — es la salida
 * barata cuando el video quedó bien pero el audio no.
 *
 * OJO: los subtítulos van QUEMADOS en los pixeles; si el video traía
 * subtítulos, cambiar la voz los deja como estaban.
 */

/** Las voces disponibles (de la cuenta conectada), para el selector. */
export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const admin = clienteAdmin();
  try {
    const sesion = await abrirSesion(admin, cuenta.id);
    const res = await llamarHerramienta(sesion, "list_voices", { size: 60 });
    const sc = resultadoEstructurado(res);
    const voces = (sc?.voices ?? [])
      .filter((v: any) => v?.voice_id)
      .map((v: any) => ({
        id: v.voice_id,
        tipo: v.voice_type ?? "preset",
        nombre: v.name ?? "",
        genero: v.gender ?? null,
        muestra: v.preview_url ?? null,
      }));
    return NextResponse.json({ ok: true, voces });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

/** Lanza el cambio de voz sobre un video terminado; sale como intento nuevo. */
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
  const vozId = String(body?.vozId ?? "");
  const vozTipo = body?.vozTipo === "element" ? "element" : "preset";
  const vozNombre = String(body?.vozNombre ?? "").slice(0, 60);
  if (!id || !vozId) {
    return NextResponse.json({ error: "Faltan el video o la voz." }, { status: 400 });
  }

  const { data: fila } = await supabase
    .from("videos_producto")
    .select(
      "id, item_id, sku, titulo, imagen_url, imagen_generada, prompt, formato, modelo, duracion, request_id, estado, video_guardado",
    )
    .eq("account_id", cuenta.id)
    .eq("id", id)
    .single();
  if (!fila) return NextResponse.json({ error: "No existe ese video." }, { status: 404 });
  if (fila.estado !== "completado" || !fila.video_guardado) {
    return NextResponse.json({ error: "Ese video todavía no está terminado." }, { status: 400 });
  }

  const admin = clienteAdmin();
  let requestId = "";
  try {
    const sesion = await abrirSesion(admin, cuenta.id);

    // voice_change acepta el FOLIO del trabajo que generó el video (los del
    // Studio lo tienen); para videos de otro origen se importa el MP4
    // guardado y se usa el media_id.
    const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let videoId =
      fila.formato === "studio" && esUuid.test(String(fila.request_id ?? ""))
        ? String(fila.request_id)
        : "";
    if (!videoId) {
      const imp = resultadoEstructurado(
        await llamarHerramienta(sesion, "media_import_url", {
          url: fila.video_guardado as string,
          type: "video",
        }),
      );
      if (!imp?.media_id) {
        throw new Error("No se pudo importar el video guardado para editarlo.");
      }
      videoId = String(imp.media_id);
    }

    const params: Record<string, unknown> = {
      video_id: videoId,
      voice_id: vozId,
      voice_type: vozTipo,
    };
    const sc = await generarContestandoAvisos(sesion, "voice_change", params);
    if (sc?.error) throw new Error(String(sc.error).slice(0, 300));
    requestId = sc?.results?.[0]?.id ?? "";
    if (!requestId) {
      throw new Error(`No devolvió folio: ${JSON.stringify(sc ?? {}).slice(0, 200)}`);
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  // El resultado entra como intento NUEVO (el original se queda intacto) y
  // el vigilante del Studio lo trae igual que cualquier otro job del MCP.
  const { data: nueva, error: errIns } = await supabase
    .from("videos_producto")
    .insert({
      account_id: cuenta.id,
      item_id: fila.item_id,
      sku: fila.sku,
      titulo: fila.titulo,
      imagen_url: fila.imagen_url,
      imagen_generada: fila.imagen_generada,
      prompt: `Cambio de voz${vozNombre ? ` · ${vozNombre}` : ""} (sobre el video anterior, visuales intactos)`,
      preset: "Edición · Cambio de voz",
      modelo: "voice-change",
      formato: "studio",
      etapa: "video",
      duracion: fila.duracion ?? 15,
      request_id: requestId,
      estado: "enviado",
    })
    .select("id")
    .single();
  if (errIns || !nueva) {
    return NextResponse.json({ error: errIns?.message ?? "No se pudo guardar." }, { status: 500 });
  }

  const origen = origenReal(req);
  after(() => dispararVideos(origen));
  return NextResponse.json({ ok: true, id: nueva.id }, { status: 202 });
}
