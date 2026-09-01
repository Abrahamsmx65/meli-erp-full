import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { enRangoContenido } from "@/lib/servicios/contenido-amazon";

export const dynamic = "force-dynamic";

const TOPE_NOTAS = 2000;

/**
 * Guarda lo que se le anota a un modelo en /amazon/contenido: categoría de la
 * store, prioridad de trabajo, palomeos de imágenes y A+, notas, y el
 * "eliminar" que solo lo oculta de la lista.
 *
 * Se escribe únicamente lo que venga en el cuerpo: mandar solo la prioridad no
 * puede borrar las notas.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaAmazon(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "No hay ninguna cuenta de Amazon conectada." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const modelo = typeof body?.modelo === "string" ? body.modelo.trim().toUpperCase() : "";
  if (!modelo) return NextResponse.json({ error: "Falta el modelo." }, { status: 400 });
  if (!enRangoContenido(modelo)) {
    return NextResponse.json(
      { error: `${modelo} no está en la lista de contenido (GT054 a GT300, MY2307 y G650).` },
      { status: 400 },
    );
  }

  const fila: Record<string, unknown> = {
    account_id: cuenta.id,
    modelo,
    actualizado_en: new Date().toISOString(),
  };

  if ("categoria" in body) {
    const c = typeof body.categoria === "string" ? body.categoria.trim() : "";
    fila.categoria = c === "" ? null : c;
  }
  if ("prioridad" in body) {
    const p = Math.round(Number(body.prioridad));
    fila.prioridad = Number.isFinite(p) ? Math.min(5, Math.max(0, p)) : 0;
  }
  if ("imagenes" in body) fila.imagenes = body.imagenes === true;
  if ("aplus" in body) fila.aplus = body.aplus === true;
  if ("eliminado" in body) fila.eliminado = body.eliminado === true;
  if ("notas" in body) {
    fila.notas = typeof body.notas === "string" ? body.notas.slice(0, TOPE_NOTAS) : "";
  }

  const { error } = await supabase
    .from("amazon_contenido")
    .upsert(fila, { onConflict: "account_id,modelo" });

  if (error) {
    if (error.message.includes("amazon_contenido") && error.message.includes("does not exist")) {
      return NextResponse.json(
        { error: "Falta aplicar la migración 0032 en Supabase (tabla amazon_contenido)." },
        { status: 500 },
      );
    }
    // La llave foránea contra las categorías de la store.
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "Esa categoría ya no existe. Vuelve a cargar la página." },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
