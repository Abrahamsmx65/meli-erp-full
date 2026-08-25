import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import {
  credencialesHiggsfield,
  crearPersonajeHF,
  estadoPersonajeHF,
  subirImagen,
} from "@/lib/higgsfield/client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Personajes consistentes para los videos: la influencer de dama, el modelo
 * de caballero. Se crean con 1 a 6 fotos de referencia; Higgsfield los
 * entrena (tarda unos minutos) y de ahí en adelante la misma cara aparece
 * en todos los clips.
 */

const GENEROS = new Set(["mujer", "hombre", "nino"]);

/** Crea un personaje a partir de fotos (data URLs base64 del formulario). */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  if (!credencialesHiggsfield()) {
    return NextResponse.json({ error: "Falta configurar HIGGSFIELD_CREDENTIALS." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const nombre = String(body?.nombre ?? "").trim();
  const genero = String(body?.genero ?? "").trim() || null;
  const fotos: string[] = Array.isArray(body?.fotos) ? body.fotos : [];

  if (!nombre) return NextResponse.json({ error: "Ponle nombre al personaje." }, { status: 400 });
  if (genero && !GENEROS.has(genero)) {
    return NextResponse.json({ error: "Género inválido." }, { status: 400 });
  }
  if (fotos.length < 1 || fotos.length > 6) {
    return NextResponse.json({ error: "Sube entre 1 y 6 fotos del personaje." }, { status: 400 });
  }

  // Las fotos llegan como data URLs; se suben al CDN de Higgsfield, que es
  // de donde su entrenador las lee.
  const urls: string[] = [];
  try {
    for (const foto of fotos) {
      const coincide = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(foto));
      if (!coincide) {
        return NextResponse.json({ error: "Las fotos deben ser JPG, PNG o WebP." }, { status: 400 });
      }
      const datos = Buffer.from(coincide[2], "base64");
      if (datos.length > 8 * 1024 * 1024) {
        return NextResponse.json({ error: "Cada foto debe pesar menos de 8 MB." }, { status: 400 });
      }
      urls.push(await subirImagen(datos, coincide[1]));
    }
  } catch (err) {
    return NextResponse.json(
      { error: `No se pudieron subir las fotos: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  const { data: fila, error: errIns } = await supabase
    .from("personajes_video")
    .insert({ account_id: cuenta.id, nombre, genero, fotos: urls })
    .select("id")
    .single();
  if (errIns || !fila) {
    return NextResponse.json({ error: errIns?.message ?? "No se pudo guardar." }, { status: 500 });
  }

  try {
    const ref = await crearPersonajeHF(nombre, urls);
    await supabase
      .from("personajes_video")
      .update({
        soul_id: ref.id,
        estado: ref.status === "completed" ? "listo" : ref.status === "failed" ? "fallido" : "creando",
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", fila.id);
  } catch (err) {
    await supabase
      .from("personajes_video")
      .update({
        estado: "fallido",
        error: (err as Error).message.slice(0, 300),
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", fila.id);
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  return NextResponse.json({ ok: true, id: fila.id }, { status: 202 });
}

/** Lista los personajes; de paso refresca a los que siguen entrenando. */
export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const { data: filas } = await supabase
    .from("personajes_video")
    .select("*")
    .eq("account_id", cuenta.id)
    .order("creado_en", { ascending: false });

  for (const p of filas ?? []) {
    if (p.estado !== "creando" || !p.soul_id) continue;
    try {
      const ref = await estadoPersonajeHF(p.soul_id as string);
      const estado =
        ref.status === "completed" ? "listo" : ref.status === "failed" ? "fallido" : "creando";
      if (estado !== p.estado) {
        await supabase
          .from("personajes_video")
          .update({ estado, actualizado_en: new Date().toISOString() })
          .eq("id", p.id);
        p.estado = estado;
      }
    } catch {
      // Si Higgsfield no contesta, se queda como estaba y se reintenta luego.
    }
  }

  return NextResponse.json({ ok: true, personajes: filas ?? [] });
}

/** Borra un personaje (los videos ya hechos se quedan). */
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
    .from("personajes_video")
    .delete()
    .eq("account_id", cuenta.id)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
