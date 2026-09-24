import { NextResponse, after, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { abrirSesion, listarHerramientas } from "@/lib/higgsfield/mcp";
import { dispararVideos } from "@/lib/servicios/disparar-videos";
import { origenReal } from "@/lib/servicios/origen";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Ruta TEMPORAL (ronda 7): con la cuenta de Higgsfield ya conectada por
// OAuth, lista las herramientas reales que expone su MCP para cablear el
// Marketing Studio con los nombres y parámetros exactos. Se borra al
// terminar la integración.
const LLAVE = "dx-mgx7q4wkzt";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("llave") !== LLAVE) {
    return NextResponse.json({ error: "No." }, { status: 404 });
  }

  // ?despachar=1 → enciende el vigilante de videos (para destrabar filas
  // sin esperar a que alguien abra la página).
  if (req.nextUrl.searchParams.get("despachar")) {
    const origen = origenReal(req);
    after(() => dispararVideos(origen));
    return NextResponse.json({ ok: true, despachado: true });
  }

  const admin = clienteAdmin();
  const { data: conexiones } = await admin
    .from("higgsfield_mcp")
    .select("account_id, expira_en, actualizado_en")
    .limit(1);
  if (!conexiones?.length) {
    return NextResponse.json({ conectado: false, nota: "Nadie ha conectado su cuenta todavía." });
  }

  try {
    const sesion = await abrirSesion(admin, conexiones[0].account_id as string);
    const herramientas = await listarHerramientas(sesion);

    // ?importar=url → el resultado CRUDO de media_import_url (para cuando
    // el Studio rápido no puede importar las fotos).
    const importar = req.nextUrl.searchParams.get("importar");
    if (importar) {
      const { llamarHerramienta, resultadoEstructurado } = await import("@/lib/higgsfield/mcp");
      const res = await llamarHerramienta(sesion, "media_import_url", {
        url: importar,
        type: "image",
      });
      return NextResponse.json(resultadoEstructurado(res) ?? res);
    }

    // ?habla=url → corre el análisis de voz real (silencedetect + ffprobe)
    // sobre ese audio/video y devuelve los tramos con voz que detectó.
    const habla = req.nextUrl.searchParams.get("habla");
    if (habla) {
      const { analizarHabla, parsearSilencios } = await import("@/lib/servicios/marca-agua");
      const analisis = await analizarHabla(sesion, habla);
      const dur = analisis.duracion ?? 15;
      return NextResponse.json({
        ok: true,
        duracion: analisis.duracion,
        habla: parsearSilencios(analisis.salida, dur),
        crudo: analisis.salida.slice(0, 1500),
      });
    }

    // ?sandbox=1 → ¿el sandbox del MCP trae ffmpeg y salida a internet?
    // (lo necesita la marca de agua).
    if (req.nextUrl.searchParams.get("sandbox")) {
      const { llamarHerramienta, resultadoEstructurado } = await import("@/lib/higgsfield/mcp");
      const res = await llamarHerramienta(sesion, "sandbox_exec", {
        command:
          "ffmpeg -version 2>&1 | head -1; curl -sI --max-time 20 " +
          "'https://raw.githubusercontent.com/google/fonts/main/ofl/archivoblack/ArchivoBlack-Regular.ttf' | head -1",
        timeout_seconds: 60,
      });
      return NextResponse.json(resultadoEstructurado(res) ?? res);
    }

    // ?remarcar=id → quema la marca de agua sobre un video YA guardado
    // (mismo archivo, misma URL; la página lo enseña marcado al recargar).
    const remarcar = req.nextUrl.searchParams.get("remarcar");
    if (remarcar) {
      const { quemarMarcaYSubir } = await import("@/lib/servicios/marca-agua");
      const { data: fila } = await admin
        .from("videos_producto")
        .select("id, account_id, estado, video_guardado, video_url, guion, duracion, audio_url, formato")
        .eq("id", remarcar)
        .single();
      if (!fila?.video_guardado || fila.estado !== "completado") {
        return NextResponse.json({ error: "Ese video no está terminado." }, { status: 400 });
      }
      const ruta = `${fila.account_id}/${fila.id}.mp4`;
      // La fuente debe estar LIMPIA para no encimar textos: la copia limpia
      // del bucket si existe; si no, el original del CDN; y como último
      // recurso el archivo guardado (videos viejos sin textos previos).
      const nombreLimpio = `${fila.id}-limpio.mp4`;
      const { data: existentes } = await admin.storage
        .from("videos-producto")
        .list(fila.account_id as string, { search: nombreLimpio });
      const fuente = existentes?.some((a) => a.name === nombreLimpio)
        ? admin.storage
            .from("videos-producto")
            .getPublicUrl(`${fila.account_id}/${nombreLimpio}`).data.publicUrl
        : ((fila.video_url as string) ?? (fila.video_guardado as string));
      const url = await quemarMarcaYSubir(
        admin,
        sesion,
        ruta,
        // Anticache: que el sandbox baje el archivo actual.
        `${fuente}${fuente.includes("?") ? "&" : "?"}v=${Date.now()}`,
        fila.guion as string | null,
        (fila.duracion as number) || 15,
        fila.formato === "studio" ? (fila.audio_url as string | null) : null,
      );
      return NextResponse.json({ ok: true, url });
    }

    // ?job=folio → el estado CRUDO de ese trabajo en el MCP (para destrabar
    // videos que se ven eternos en la app).
    const job = req.nextUrl.searchParams.get("job");
    if (job) {
      const { llamarHerramienta, resultadoEstructurado } = await import("@/lib/higgsfield/mcp");
      const res = await llamarHerramienta(sesion, "job_status", { jobId: job });
      return NextResponse.json(resultadoEstructurado(res) ?? res);
    }

    // ?modelo=x → la ficha del modelo en el catálogo (params, roles, duraciones).
    const modelo = req.nextUrl.searchParams.get("modelo");
    if (modelo) {
      const { llamarHerramienta, resultadoEstructurado } = await import("@/lib/higgsfield/mcp");
      const res = await llamarHerramienta(sesion, "models_explore", {
        action: "get",
        model_id: modelo,
      });
      return NextResponse.json(resultadoEstructurado(res) ?? res);
    }

    // ?herr=nombre → el esquema COMPLETO de esa herramienta.
    const nombre = req.nextUrl.searchParams.get("herr");
    if (nombre) {
      const una = herramientas.find((h: any) => h.name === nombre);
      return NextResponse.json(una ?? { error: "No existe esa herramienta." });
    }
    // Nombres + descripción corta + campos del esquema (sin inundar).
    // ?herramienta=generate_video → esa herramienta COMPLETA: descripción
    // sin recortar y el esquema entero de entrada (lo que va dentro de
    // `params`), para saber con qué se le contesta un aviso del MCP.
    const nombreHerramienta = req.nextUrl.searchParams.get("herramienta");
    if (nombreHerramienta) {
      const h = herramientas.find((x: any) => x?.name === nombreHerramienta);
      if (!h) return NextResponse.json({ error: `No hay herramienta ${nombreHerramienta}.` }, { status: 404 });
      return NextResponse.json({ nombre: h.name, descripcion: h.description ?? "", inputSchema: h.inputSchema ?? null, annotations: h.annotations ?? null });
    }

    const resumen = herramientas.map((h: any) => ({
      nombre: h.name,
      descripcion: String(h.description ?? "").slice(0, 200),
      campos: Object.keys(h.inputSchema?.properties ?? {}),
      requeridos: h.inputSchema?.required ?? [],
    }));
    return NextResponse.json({ conectado: true, total: resumen.length, herramientas: resumen });
  } catch (err) {
    return NextResponse.json({ conectado: true, error: (err as Error).message.slice(0, 300) });
  }
}
