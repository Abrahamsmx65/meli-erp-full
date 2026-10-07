import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";

export const dynamic = "force-dynamic";

/**
 * Biblioteca de pistas de MÚSICA del dueño para los videos de modelaje
 * (pedido del 7-oct-2026: la música que inventa la IA del video es genérica;
 * «el audio no me gusta tanto»). Las pistas viven en el bucket público
 * `videos-producto`, carpeta `{cuenta}/musica/`, y el vigilante monta la
 * elegida sobre el video terminado. El dueño sube pistas que tenga derecho a
 * usar; el ERP no trae música de ningún catálogo (la de TikTok solo se
 * licencia DENTRO de TikTok y no entrega el archivo).
 */

const EXTENSIONES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  aac: "audio/aac",
};
const MAX_BYTES = 15 * 1024 * 1024;

function carpetaDe(cuenta: string): string {
  return `${cuenta}/musica`;
}

/** Nombre de archivo seguro: letras, números, espacios y guiones. */
function limpiarNombre(nombre: string): string {
  return nombre
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 ._-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

async function contexto() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 }) };
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return { error: NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 }) };
  return { cuenta };
}

export async function GET() {
  const ctx = await contexto();
  if ("error" in ctx) return ctx.error;
  const admin = clienteAdmin();
  const { data, error } = await admin.storage
    .from("videos-producto")
    .list(carpetaDe(ctx.cuenta.id), { limit: 100, sortBy: { column: "name", order: "asc" } });
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  const pistas = (data ?? [])
    .filter((a) => a.name && !a.name.startsWith("."))
    .map((a) => ({
      nombre: a.name,
      url: admin.storage
        .from("videos-producto")
        .getPublicUrl(`${carpetaDe(ctx.cuenta.id)}/${a.name}`).data.publicUrl,
    }));
  return NextResponse.json({ pistas });
}

export async function POST(req: NextRequest) {
  const ctx = await contexto();
  if ("error" in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  const nombreCrudo = limpiarNombre(String(body?.nombre ?? ""));
  const datos = String(body?.datos ?? "");
  // Algunos navegadores suben el MP3 como application/octet-stream: el tipo
  // real lo decide la EXTENSIÓN (lista blanca), no el prefijo del data URL.
  const coincide = /^data:[\w/.+-]+;base64,(.+)$/s.exec(datos);
  if (!nombreCrudo || !coincide) {
    return NextResponse.json({ error: "Faltan el nombre o el archivo de audio." }, { status: 400 });
  }
  const ext = (nombreCrudo.split(".").pop() ?? "").toLowerCase();
  const tipo = EXTENSIONES[ext];
  if (!tipo) {
    return NextResponse.json(
      { error: "Formato no soportado; sube MP3, M4A, WAV, OGG o AAC." },
      { status: 400 },
    );
  }
  const cuerpo = Buffer.from(coincide[1], "base64");
  if (!cuerpo.length || cuerpo.length > MAX_BYTES) {
    return NextResponse.json({ error: "La pista pesa demasiado (máximo 15 MB)." }, { status: 400 });
  }

  const admin = clienteAdmin();
  const ruta = `${carpetaDe(ctx.cuenta.id)}/${nombreCrudo}`;
  const { error } = await admin.storage
    .from("videos-producto")
    .upload(ruta, cuerpo, { contentType: tipo, upsert: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  const url = admin.storage.from("videos-producto").getPublicUrl(ruta).data.publicUrl;
  return NextResponse.json({ ok: true, pista: { nombre: nombreCrudo, url } });
}

export async function DELETE(req: NextRequest) {
  const ctx = await contexto();
  if ("error" in ctx) return ctx.error;
  const body = await req.json().catch(() => null);
  const nombre = limpiarNombre(String(body?.nombre ?? ""));
  if (!nombre) return NextResponse.json({ error: "Falta el nombre de la pista." }, { status: 400 });
  const admin = clienteAdmin();
  const { error } = await admin.storage
    .from("videos-producto")
    .remove([`${carpetaDe(ctx.cuenta.id)}/${nombre}`]);
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  return NextResponse.json({ ok: true });
}
