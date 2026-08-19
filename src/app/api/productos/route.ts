import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";

export const dynamic = "force-dynamic";

/** Guarda la categoría y el costo de un producto (modelo + color). */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const modelo = typeof body?.modelo === "string" ? body.modelo.trim() : "";
  // El costo y la categoría son POR MODELO: mismo precio todos los colores.
  const color = "";
  if (!modelo) return NextResponse.json({ error: "Falta el modelo." }, { status: 400 });

  const categoria =
    typeof body?.categoria === "string" && body.categoria.trim() ? body.categoria.trim() : null;
  const costoCrudo = Number(body?.costoMxn);
  const costoMxn = Number.isFinite(costoCrudo) && costoCrudo > 0 ? costoCrudo : null;

  const { error } = await supabase.from("productos_config").upsert(
    {
      account_id: cuenta.id,
      modelo,
      color,
      categoria,
      costo_mxn: costoMxn,
      actualizado_en: new Date().toISOString(),
    },
    { onConflict: "account_id,modelo,color" },
  );
  if (error) {
    const falta = error.message.includes("productos_config");
    return NextResponse.json(
      {
        error: falta
          ? "Falta aplicar la migración 0011 en Supabase (tabla productos_config)."
          : error.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
