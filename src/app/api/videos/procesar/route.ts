import { NextResponse, after, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { estadoSolicitud } from "@/lib/higgsfield/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Vigila los videos encolados en Higgsfield.
 *
 * Mismo patrón que skus-pendientes: contesta 202 de inmediato, trabaja
 * después de responder, y si al agotar su presupuesto de tiempo todavía hay
 * videos en el horno, se vuelve a lanzar solo.
 *
 * Al completarse un video se descarga del CDN de Higgsfield (donde solo vive
 * unos días) y se copia al bucket `videos-producto` de Supabase Storage; la
 * URL permanente es la que se enseña en la app.
 */
export async function POST(req: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const esCron = Boolean(secreto) && auth === `Bearer ${secreto}`;

  if (!esCron) {
    const supabase = await clienteServidor();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const origen = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  after(() => procesar(origen));

  return NextResponse.json({ ok: true, encolado: true }, { status: 202 });
}

/** Cuántos videos siguen en el horno; con sesión también enciende el proceso. */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const origen = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  after(() => procesar(origen));

  const admin = clienteAdmin();
  const { count } = await admin
    .from("videos_producto")
    .select("*", { count: "exact", head: true })
    .in("estado", ["enviado", "en_progreso"]);

  return NextResponse.json({ ok: true, encolado: true, enCurso: count ?? 0 }, { status: 202 });
}

/** Una generación no debería tardar más que esto; después se da por perdida. */
const LIMITE_MIN = 30;

async function procesar(origen: string): Promise<void> {
  const admin = clienteAdmin();
  const t0 = Date.now();
  const PRESUPUESTO_MS = 230_000; // margen dentro de los 300 s de Vercel

  let huboEnCurso = false;

  while (Date.now() - t0 < PRESUPUESTO_MS) {
    const { data: pendientes } = await admin
      .from("videos_producto")
      .select("id, account_id, request_id, estado, creado_en")
      .in("estado", ["enviado", "en_progreso"])
      .order("creado_en", { ascending: true })
      .limit(50);

    if (!pendientes?.length) break;
    huboEnCurso = true;

    for (const fila of pendientes) {
      if (Date.now() - t0 > PRESUPUESTO_MS) break;

      // Sin request_id no hay a quién preguntarle; se marca de una vez.
      if (!fila.request_id) {
        await guardar(admin, fila.id, {
          estado: "fallido",
          error: "Se quedó sin folio de Higgsfield.",
        });
        continue;
      }

      // Demasiado tiempo en el horno: se da por perdido para no vigilar eterno.
      if (Date.now() - new Date(fila.creado_en).getTime() > LIMITE_MIN * 60_000) {
        await guardar(admin, fila.id, {
          estado: "fallido",
          error: `Sin respuesta de Higgsfield en ${LIMITE_MIN} minutos.`,
        });
        continue;
      }

      try {
        const res = await estadoSolicitud(fila.request_id);

        if (res.status === "completed" && res.video?.url) {
          const permanente = await copiarAVideoStorage(
            admin,
            fila.account_id,
            fila.id,
            res.video.url,
          );
          await guardar(admin, fila.id, {
            estado: "completado",
            video_url: res.video.url,
            video_guardado: permanente,
            error: null,
          });
        } else if (res.status === "failed" || res.status === "canceled") {
          await guardar(admin, fila.id, {
            estado: "fallido",
            error: "Higgsfield no pudo generar el video (créditos devueltos).",
          });
        } else if (res.status === "nsfw") {
          await guardar(admin, fila.id, {
            estado: "rechazado",
            error: "La moderación de Higgsfield rechazó el contenido (créditos devueltos).",
          });
        } else if (fila.estado !== "en_progreso") {
          await guardar(admin, fila.id, { estado: "en_progreso" });
        }
      } catch (err) {
        // Error al preguntar no es error del video: se reintenta en la
        // siguiente vuelta, y el límite de tiempo evita el bucle eterno.
        console.error(`videos: no se pudo consultar ${fila.request_id}:`, err);
      }
    }

    // Un respiro entre vueltas; generar toma minutos, no milisegundos.
    await new Promise((r) => setTimeout(r, 8_000));
  }

  if (!huboEnCurso) return;

  // ¿Sigue algo en el horno? El proceso se relanza y sigue vigilando.
  const { count } = await admin
    .from("videos_producto")
    .select("*", { count: "exact", head: true })
    .in("estado", ["enviado", "en_progreso"]);

  const secreto = process.env.CRON_SECRET;
  if ((count ?? 0) > 0 && secreto) {
    try {
      await fetch(`${origen}/api/videos/procesar`, {
        method: "POST",
        headers: { authorization: `Bearer ${secreto}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Si no prendió, el botón de actualizar de la página lo relanza.
    }
  }
}

async function guardar(
  admin: ReturnType<typeof clienteAdmin>,
  id: string,
  cambios: Record<string, unknown>,
): Promise<void> {
  await admin
    .from("videos_producto")
    .update({ ...cambios, actualizado_en: new Date().toISOString() })
    .eq("id", id);
}

/**
 * Baja el MP4 del CDN de Higgsfield y lo sube al bucket público. Devuelve la
 * URL permanente. Si la copia falla se lanza: mejor reintentar en la
 * siguiente vuelta que quedarse con una URL que caduca.
 */
async function copiarAVideoStorage(
  admin: ReturnType<typeof clienteAdmin>,
  accountId: string,
  id: string,
  url: string,
): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`No se pudo descargar el video (${res.status}).`);
  const cuerpo = Buffer.from(await res.arrayBuffer());

  const ruta = `${accountId}/${id}.mp4`;
  const { error } = await admin.storage
    .from("videos-producto")
    .upload(ruta, cuerpo, { contentType: "video/mp4", upsert: true });
  if (error) throw new Error(`No se pudo guardar en Storage: ${error.message}`);

  const { data } = admin.storage.from("videos-producto").getPublicUrl(ruta);
  return data.publicUrl;
}
