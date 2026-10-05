import { after, NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { refrescarCatalogoAmazon } from "@/lib/servicios/catalogo-amazon";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * El back del catálogo completo para creadores (dueño, 5-oct-2026):
 * · `{ modelo, oculto }` lo esconde o lo vuelve a enseñar en `/catalogo`.
 * · `{ modelo, categoria }` cambia su categoría en Productos y costos
 *   (`productos_config`, la fuente única: también la usan cortes y ventas);
 *   el costo no se toca. Categoría vacía = sin categoría.
 * Después se rearma el catálogo con lo ya leído de Amazon (sin preguntarle).
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const modelo = String(body?.modelo ?? "").trim().toUpperCase();
  if (!/^[A-Z]{1,5}\d{2,6}$/.test(modelo)) return NextResponse.json({ error: "Modelo inválido." }, { status: 400 });
  const traeOculto = Object.prototype.hasOwnProperty.call(body ?? {}, "oculto");
  const traeCategoria = Object.prototype.hasOwnProperty.call(body ?? {}, "categoria");
  if (!traeOculto && !traeCategoria) return NextResponse.json({ error: "Nada que guardar." }, { status: 400 });

  const admin = clienteAdmin();
  const ahora = new Date().toISOString();
  if (traeOculto) {
    const { error } = await admin
      .from("tienda_catalogo_ajustes")
      .upsert({ account_id: cuenta.id, modelo, oculto: Boolean(body.oculto), actualizado_en: ahora }, { onConflict: "account_id,modelo" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (traeCategoria) {
    const categoria = String(body.categoria ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || null;
    const { data: actual } = await admin
      .from("productos_config")
      .select("modelo")
      .eq("account_id", cuenta.id)
      .eq("modelo", modelo)
      .eq("color", "")
      .maybeSingle();
    const { error } = actual
      ? await admin.from("productos_config").update({ categoria, actualizado_en: ahora }).eq("account_id", cuenta.id).eq("modelo", modelo).eq("color", "")
      : await admin.from("productos_config").insert({ account_id: cuenta.id, modelo, color: "", categoria, costo_mxn: null, actualizado_en: ahora });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  after(async () => {
    try {
      await refrescarCatalogoAmazon(admin, cuenta.id, 50_000, { soloArmar: true });
    } catch {
      /* el cron de la tienda lo rearma en la siguiente hora */
    }
  });
  return NextResponse.json({ ok: true, modelo });
}
