import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { abrirSesion } from "@/lib/higgsfield/mcp";
import { quemarMarcaYSubir } from "@/lib/servicios/marca-agua";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Corrige los subtítulos de un video TERMINADO sin regenerarlo y sin gastar
 * créditos: re-quema el guion nuevo (y la marca de agua) sobre la copia
 * LIMPIA guardada — o, si el video es de antes de que existiera la copia
 * limpia, sobre el original del CDN de Higgsfield mientras siga vivo.
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
  const guion = String(body?.guion ?? "").trim().slice(0, 600);
  if (!id || !guion) {
    return NextResponse.json({ error: "Faltan el video o el guion." }, { status: 400 });
  }

  const { data: fila } = await supabase
    .from("videos_producto")
    .select("id, estado, duracion, video_url, video_guardado, formato, audio_url")
    .eq("account_id", cuenta.id)
    .eq("id", id)
    .single();
  if (!fila) return NextResponse.json({ error: "No existe ese video." }, { status: 404 });
  if (fila.estado !== "completado" || !fila.video_guardado) {
    return NextResponse.json({ error: "Ese video todavía no está terminado." }, { status: 400 });
  }

  const admin = clienteAdmin();
  const ruta = `${cuenta.id}/${fila.id}.mp4`;

  // La fuente para re-quemar debe estar LIMPIA (sin textos anteriores):
  // primero la copia limpia del bucket; si no existe (video viejo), el
  // original del CDN de Higgsfield, que vive unos días.
  const nombreLimpio = `${fila.id}-limpio.mp4`;
  const { data: existentes } = await admin.storage
    .from("videos-producto")
    .list(cuenta.id, { search: nombreLimpio });
  let fuente: string | null = null;
  if (existentes?.some((a) => a.name === nombreLimpio)) {
    fuente = admin.storage
      .from("videos-producto")
      .getPublicUrl(`${cuenta.id}/${nombreLimpio}`).data.publicUrl;
  } else if (fila.video_url) {
    fuente = fila.video_url as string;
  }
  if (!fuente) {
    return NextResponse.json(
      { error: "Este video no tiene copia limpia para corregir; regenera una vez y las siguientes correcciones ya serán gratis." },
      { status: 400 },
    );
  }

  try {
    const sesion = await abrirSesion(admin, cuenta.id);
    await quemarMarcaYSubir(
      admin,
      sesion,
      ruta,
      // Anticache: que el sandbox baje el archivo actual, no una copia vieja.
      `${fuente}${fuente.includes("?") ? "&" : "?"}v=${Date.now()}`,
      guion,
      (fila.duracion as number) || 15,
      // La copia limpia trae la pista que generó la IA; si el video se hizo
      // con una voz APROBADA, esa pista se vuelve a poner (si no, corregir
      // los subtítulos le cambiaba la voz al video).
      fila.formato === "studio" ? (fila.audio_url as string | null) : null,
    );
  } catch (err) {
    return NextResponse.json(
      { error: `No se pudieron re-quemar los subtítulos: ${(err as Error).message.slice(0, 200)}` },
      { status: 502 },
    );
  }

  await supabase
    .from("videos_producto")
    .update({ guion, actualizado_en: new Date().toISOString() })
    .eq("id", fila.id);

  return NextResponse.json({ ok: true });
}
