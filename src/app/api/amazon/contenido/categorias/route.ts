import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaAmazon } from "@/lib/servicios/amazon";

export const dynamic = "force-dynamic";

const TOPE_NOMBRE = 80;
const TOPE_NOTAS = 2000;

/**
 * Las categorías de la store de Amazon: alta, palomeos, renombrar y borrar.
 *
 * Son lista propia (no las de productos_config, que agrupan por material para
 * costear): aquí se lleva cuáles ya se crearon, cuáles ya tienen imágenes y
 * cuáles ya tienen su página en la tienda.
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
  const accion = typeof body?.accion === "string" ? body.accion : "guardar";
  const nombre =
    typeof body?.nombre === "string" ? body.nombre.trim().slice(0, TOPE_NOMBRE) : "";
  if (!nombre) return NextResponse.json({ error: "Falta el nombre de la categoría." }, { status: 400 });

  const falta = (error: { message: string }) =>
    error.message.includes("amazon_categorias_store") && error.message.includes("does not exist");

  if (accion === "borrar") {
    // Los modelos que la tenían se quedan sin categoría (lo hace la llave
    // foránea), no con el nombre de algo que ya no existe.
    const { error } = await supabase
      .from("amazon_categorias_store")
      .delete()
      .eq("account_id", cuenta.id)
      .eq("nombre", nombre);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (accion === "renombrar") {
    const nuevo =
      typeof body?.nuevoNombre === "string" ? body.nuevoNombre.trim().slice(0, TOPE_NOMBRE) : "";
    if (!nuevo) return NextResponse.json({ error: "Falta el nombre nuevo." }, { status: 400 });
    // El `on update cascade` arrastra a los modelos que la tenían puesta.
    const { error } = await supabase
      .from("amazon_categorias_store")
      .update({ nombre: nuevo, actualizado_en: new Date().toISOString() })
      .eq("account_id", cuenta.id)
      .eq("nombre", nombre);
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: `Ya existe una categoría "${nuevo}".` }, { status: 400 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const fila: Record<string, unknown> = {
    account_id: cuenta.id,
    nombre,
    actualizado_en: new Date().toISOString(),
  };
  if ("creada" in body) fila.creada = body.creada === true;
  if ("imagenes" in body) fila.imagenes = body.imagenes === true;
  if ("paginaStore" in body) fila.pagina_store = body.paginaStore === true;
  if ("notas" in body) {
    fila.notas = typeof body.notas === "string" ? body.notas.slice(0, TOPE_NOTAS) : "";
  }

  const { error } = await supabase
    .from("amazon_categorias_store")
    .upsert(fila, { onConflict: "account_id,nombre" });
  if (error) {
    return NextResponse.json(
      {
        error: falta(error)
          ? "Falta aplicar la migración 0032 en Supabase (tabla amazon_categorias_store)."
          : error.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
