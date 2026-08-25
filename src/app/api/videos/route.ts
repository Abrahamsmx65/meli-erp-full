import { NextResponse, after, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { generarVideo, credencialesHiggsfield } from "@/lib/higgsfield/client";
import { construirEntradaDop } from "@/lib/higgsfield/presets";
import { dispararVideos } from "@/lib/servicios/disparar-videos";

export const dynamic = "force-dynamic";

/**
 * Encola un video de producto con Higgsfield.
 *
 * La fila se guarda ANTES de llamar a Higgsfield: si la llamada truena, el
 * intento queda registrado como fallido con su motivo, visible en la tabla,
 * en lugar de desaparecer en silencio.
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

  let entrada;
  try {
    entrada = construirEntradaDop({
      prompt: String(body?.prompt ?? ""),
      imagenUrl: String(body?.imagenUrl ?? ""),
      modelo: String(body?.modelo ?? "dop-turbo"),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const { data: fila, error: errIns } = await supabase
    .from("videos_producto")
    .insert({
      account_id: cuenta.id,
      item_id: body?.itemId ? String(body.itemId) : null,
      sku: body?.sku ? String(body.sku) : null,
      titulo: body?.titulo ? String(body.titulo) : null,
      imagen_url: entrada.input_images[0].image_url,
      prompt: entrada.prompt,
      preset: body?.preset ? String(body.preset) : null,
      modelo: entrada.model,
    })
    .select("id")
    .single();

  if (errIns || !fila) {
    return NextResponse.json({ error: errIns?.message ?? "No se pudo guardar." }, { status: 500 });
  }

  try {
    const res = await generarVideo(entrada);
    await supabase
      .from("videos_producto")
      .update({
        request_id: res.request_id,
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
