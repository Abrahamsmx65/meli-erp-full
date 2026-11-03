import { after, NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { refrescarCatalogoAmazon } from "@/lib/servicios/catalogo-amazon";
import { invalidarFuentesDePrecios } from "@/lib/servicios/tiktok-precios";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Lo que se decide por modelo para el precio de TikTok (el dueño o el rol de
 * TikTok: desde el 2-oct-2026 ese rol abre todas las secciones de TikTok).
 * · `{ modelo, precio }`: el precio que QUIERE poner (relámpago normal);
 *   `precio: null` lo borra y el modelo vuelve al calculado.
 * · `{ modelo, quitarRetencion }`: calcular el objetivo como si MELI sí
 *   retuviera el 10.5 % (IVA + ISR sobre la base sin IVA), que en reventa ya
 *   no retiene (dueño, 2-oct-2026).
 * Un renglón sin precio ni casilla se borra.
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
  if (!modelo || !/^[A-Z]{1,5}\d{2,6}(-\d+)?$/.test(modelo)) return NextResponse.json({ error: "Modelo inválido." }, { status: 400 });
  const traePrecio = body != null && Object.prototype.hasOwnProperty.call(body, "precio");
  const traeCasilla = body != null && Object.prototype.hasOwnProperty.call(body, "quitarRetencion");
  if (!traePrecio && !traeCasilla) return NextResponse.json({ error: "Nada que guardar." }, { status: 400 });
  const precioNuevo = body?.precio == null || body.precio === "" ? null : Number(body.precio);
  if (traePrecio && precioNuevo != null && (!Number.isFinite(precioNuevo) || precioNuevo <= 0)) {
    return NextResponse.json({ error: "Precio inválido." }, { status: 400 });
  }

  const admin = clienteAdmin();
  // El catálogo para creadores enseña el precio de esta lista: se rearma (sin Amazon).
  after(() => refrescarCatalogoAmazon(admin, cuenta.id, 50_000, { soloArmar: true }).catch(() => undefined));
  // Las fuentes masticadas de la pantalla de precios se refrescan en la siguiente visita.
  after(() => invalidarFuentesDePrecios(admin, cuenta.id, "precio de TikTok guardado").catch(() => undefined));
  const { data: actual } = await admin
    .from("tiktok_precios_objetivo")
    .select("precio, quitar_retencion")
    .eq("account_id", cuenta.id)
    .eq("modelo", modelo)
    .maybeSingle();
  const precio = traePrecio ? precioNuevo : actual?.precio != null ? Number(actual.precio) : null;
  const quitarRetencion = traeCasilla ? Boolean(body.quitarRetencion) : Boolean(actual?.quitar_retencion);

  if (precio == null && !quitarRetencion) {
    const { error } = await admin.from("tiktok_precios_objetivo").delete().eq("account_id", cuenta.id).eq("modelo", modelo);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, modelo, precio: null, quitarRetencion: false });
  }
  const { error } = await admin
    .from("tiktok_precios_objetivo")
    .upsert(
      { account_id: cuenta.id, modelo, precio, quitar_retencion: quitarRetencion, actualizado_en: new Date().toISOString() },
      { onConflict: "account_id,modelo" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, modelo, precio, quitarRetencion });
}
