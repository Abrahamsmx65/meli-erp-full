import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import {
  abrirSesion,
  llamarHerramienta,
  resultadoEstructurado,
} from "@/lib/higgsfield/mcp";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Probar la VOZ antes de gastar el video: genera SOLO el audio del guion
 * (seed_audio, centavos comparado con un video), la pantalla lo reproduce y,
 * si convence, el folio del audio viaja al video como referencia de voz —
 * Seedance la clona con lip sync. Una voz mala ya no cuesta un video.
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
  const accion = String(body?.accion ?? "");
  const admin = clienteAdmin();

  try {
    const sesion = await abrirSesion(admin, cuenta.id);

    if (accion === "generar") {
      const guion = String(body?.guion ?? "").trim().slice(0, 600);
      if (!guion) return NextResponse.json({ error: "Falta el guion." }, { status: 400 });
      const params: Record<string, unknown> = {
        model: "seed_audio",
        // La instrucción de acento va pegada al guion: seed_audio lee el
        // texto tal cual, así que el guion se manda LIMPIO al final.
        prompt: guion,
      };
      if (body?.vozId) {
        params.voice_id = String(body.vozId);
        params.voice_type = body?.vozTipo === "element" ? "element" : "preset";
      }
      let res = await llamarHerramienta(sesion, "generate_audio", { params });
      let sc = resultadoEstructurado(res);
      if (sc?.unlim_choice) {
        res = await llamarHerramienta(sesion, "generate_audio", {
          params: { ...params, use_unlim: true },
        });
        sc = resultadoEstructurado(res);
      }
      if (sc?.error) throw new Error(String(sc.error).slice(0, 300));
      const jobId = sc?.results?.[0]?.id ?? "";
      if (!jobId) {
        throw new Error(`No se pudo lanzar el audio: ${JSON.stringify(sc ?? {}).slice(0, 200)}`);
      }
      return NextResponse.json({ ok: true, jobId });
    }

    if (accion === "estado") {
      const jobId = String(body?.jobId ?? "");
      if (!jobId) return NextResponse.json({ error: "Falta el folio." }, { status: 400 });
      const res = await llamarHerramienta(sesion, "job_status", { jobId });
      const sc = resultadoEstructurado(res);
      const trabajo = sc?.generation ?? sc?.results?.[0] ?? sc;
      const estado = String(trabajo?.status ?? "");
      if (estado === "failed" || estado === "canceled" || estado === "nsfw") {
        return NextResponse.json(
          { error: "No se pudo generar el audio; intenta de nuevo." },
          { status: 502 },
        );
      }
      if (estado !== "completed") return NextResponse.json({ ok: true, pendiente: true });
      const url = trabajo?.results?.rawUrl ?? trabajo?.results?.minUrl ?? null;
      return NextResponse.json({
        ok: true,
        url,
        duracion: trabajo?.results?.durationSec ?? null,
      });
    }

    return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
