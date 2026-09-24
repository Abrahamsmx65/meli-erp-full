import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { subirArchivo } from "@/lib/higgsfield/client";
import { ESTILO_PERSONA } from "@/lib/higgsfield/ugc";
import {
  abrirSesion,
  generarContestandoAvisos,
  llamarHerramienta,
  resultadoEstructurado,
  type SesionMCP,
} from "@/lib/higgsfield/mcp";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Catálogo del Marketing Studio para la pantalla: los avatares disponibles
 * (para fijar el personaje de marca — misma cara en todos los videos) y los
 * modos/presets de video (UGC, Unboxing, Product Review…).
 */
export async function GET(req: NextRequest) {
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

    // ?costo=rapido|completo → cuánto costaría el próximo video en créditos.
    // get_cost NO lanza ningún trabajo: preguntar es gratis.
    const costo = req.nextUrl.searchParams.get("costo");
    if (costo) {
      const resolucion = req.nextUrl.searchParams.get("res") === "720p" ? "720p" : "1080p";
      const treinta = req.nextUrl.searchParams.get("dur") === "30";
      const params: Record<string, unknown> =
        costo === "completo"
          ? {
              model: "marketing_studio_video",
              prompt: "Video de producto (consulta de costo)",
              aspect_ratio: "9:16",
              duration: 15,
              resolution: resolucion,
              get_cost: true,
            }
          : {
              // 30 s van con Seedance 2.5 (duración nativa); 15 con 2.0.
              model: treinta ? "seedance_2_5" : "seedance_2_0",
              prompt: "Video de producto (consulta de costo)",
              aspect_ratio: "9:16",
              duration: treinta ? 30 : 15,
              resolution: resolucion,
              mode: treinta ? "omni_reference" : "std",
              generate_audio: true,
              get_cost: true,
            };
      const resCosto = await llamarHerramienta(sesion, "generate_video", { params });
      const scCosto = resultadoEstructurado(resCosto);
      const saldoRes = await llamarHerramienta(sesion, "balance", {}).catch(() => null);
      const scSaldo = saldoRes ? resultadoEstructurado(saldoRes) : null;
      return NextResponse.json({
        ok: true,
        creditos: scCosto?.cost?.credits ?? null,
        saldo: typeof scSaldo?.credits === "number" ? scSaldo.credits : null,
      });
    }

    const res = await llamarHerramienta(sesion, "show_marketing_studio", {
      action: "list",
      type: "avatar",
      size: 60,
    });
    const sc = resultadoEstructurado(res);
    const avatares = (sc?.items ?? [])
      .filter((a: any) => a?.id)
      .map((a: any) => ({
        id: a.id,
        nombre: a.name ?? "",
        foto: a.preview_url ?? null,
        tipo: a.type ?? "preset",
        genero: a.gender ?? null,
      }));
    const modos = (sc?.presets ?? []).map((p: any) => ({
      modo: p.mode,
      descripcion: p.description ?? "",
    }));
    return NextResponse.json({ ok: true, avatares, modos });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

/**
 * Crea el PERSONAJE de marca en la cuenta de Higgsfield, sin salir del ERP.
 * Dos caminos:
 * - `crear-foto`: con una foto que sube el usuario (se manda al CDN de
 *   Higgsfield y de ahí al Studio como avatar).
 * - `crear-ia` / `terminar-ia`: la IA genera a la persona desde una
 *   descripción (soul_cast, hecho justo para personajes); como tarda ~1 min,
 *   primero se lanza y la pantalla pregunta con `terminar-ia` hasta que la
 *   imagen queda y el avatar se da de alta con el folio del trabajo.
 */
export async function POST(req: Request) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const body = await req.json().catch(() => null);
  const accion = String(body?.accion ?? "");
  const nombre = String(body?.nombre ?? "").trim().slice(0, 60);

  const admin = clienteAdmin();
  try {
    const sesion = await abrirSesion(admin, cuenta.id);

    if (accion === "crear-foto") {
      if (!nombre) return NextResponse.json({ error: "Ponle nombre al personaje." }, { status: 400 });
      const coincide = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(body?.foto ?? ""));
      if (!coincide) {
        return NextResponse.json({ error: "Falta la foto del personaje (JPG/PNG)." }, { status: 400 });
      }
      const datos = Buffer.from(coincide[2], "base64");
      if (datos.length > 8 * 1024 * 1024) {
        return NextResponse.json({ error: "La foto pesa demasiado (máximo 8 MB)." }, { status: 400 });
      }
      // El Studio solo acepta fotos alojadas en los dominios de Higgsfield:
      // primero al CDN de la llave, y esa URL ya es válida para el avatar.
      const url = await subirArchivo(datos, coincide[1]);
      const avatar = await crearAvatar(sesion, nombre, { value: url, role: "image" });
      return NextResponse.json({ ok: true, avatar });
    }

    if (accion === "crear-ia") {
      if (!nombre) return NextResponse.json({ error: "Ponle nombre al personaje." }, { status: 400 });
      const descripcion = String(body?.descripcion ?? "").trim().slice(0, 500);
      const genero = body?.genero === "hombre" ? "man" : "woman";
      const prompt =
        `Realistic vertical portrait photo of a Mexican ${genero} in their late 20s, ` +
        (descripcion ? `${descripcion}, ` : "") +
        `${ESTILO_PERSONA}. Looking at the camera with a warm, confident, friendly ` +
        `expression, natural smile, face clearly visible and well lit, upper body in ` +
        `frame. Shot like a casual phone photo of a lifestyle creator: natural light, ` +
        `realistic skin texture, no studio look, no heavy retouching.`;
      const params: Record<string, unknown> = {
        model: "soul_cast",
        prompt,
        aspect_ratio: "3:4",
      };
      const sc = await generarContestandoAvisos(sesion, "generate_image", params);
      if (sc?.error) throw new Error(String(sc.error).slice(0, 300));
      const jobId = sc?.results?.[0]?.id ?? "";
      if (!jobId) {
        throw new Error(`No se pudo lanzar la imagen: ${JSON.stringify(sc ?? {}).slice(0, 200)}`);
      }
      return NextResponse.json({ ok: true, jobId });
    }

    if (accion === "terminar-ia") {
      if (!nombre) return NextResponse.json({ error: "Ponle nombre al personaje." }, { status: 400 });
      const jobId = String(body?.jobId ?? "");
      if (!jobId) return NextResponse.json({ error: "Falta el folio de la imagen." }, { status: 400 });
      const res = await llamarHerramienta(sesion, "job_status", { jobId });
      const sc = resultadoEstructurado(res);
      const trabajo = sc?.generation ?? sc?.results?.[0] ?? sc;
      const estado = String(trabajo?.status ?? "");
      if (estado === "failed" || estado === "canceled" || estado === "nsfw") {
        return NextResponse.json(
          { error: "La imagen del personaje no se pudo generar; intenta con otra descripción." },
          { status: 502 },
        );
      }
      if (estado !== "completed") {
        return NextResponse.json({ ok: true, pendiente: true });
      }
      const foto: string | undefined = trabajo?.results?.rawUrl ?? trabajo?.results?.minUrl;
      // El avatar se da de alta con el FOLIO del trabajo (el Studio saca la
      // imagen de ahí solo); la foto solo viaja para enseñarla en pantalla.
      const avatar = await crearAvatar(sesion, nombre, { value: jobId, role: "image" });
      return NextResponse.json({ ok: true, avatar, foto: foto ?? null });
    }

    return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

/** Da de alta el avatar en el Studio y devuelve {id, nombre, foto, tipo}. */
async function crearAvatar(
  sesion: SesionMCP,
  nombre: string,
  media: { value: string; role: string; url?: string; type?: string },
): Promise<{ id: string; nombre: string; foto: string | null; tipo: string; genero: string | null }> {
  const res = await llamarHerramienta(sesion, "show_marketing_studio", {
    action: "create",
    type: "avatar",
    avatars: [{ name: nombre, medias: [media] }],
  });
  const sc = resultadoEstructurado(res);
  if (sc?.error) throw new Error(String(sc.error).slice(0, 300));
  const creado = (sc?.items ?? []).find((a: any) => a?.id);
  if (!creado) {
    throw new Error(`El Studio no devolvió el avatar: ${JSON.stringify(sc ?? {}).slice(0, 200)}`);
  }
  return {
    id: creado.id,
    nombre: creado.name ?? nombre,
    foto: creado.preview_url ?? null,
    tipo: creado.type ?? "custom",
    genero: creado.gender ?? null,
  };
}
