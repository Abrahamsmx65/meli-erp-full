import { NextResponse, type NextRequest } from "next/server";
import { rolDeSesion } from "@/lib/acceso/roles";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * El precio que el dueño QUIERE poner en TikTok para un modelo (relámpago
 * normal): `{ modelo, precio }` lo guarda, `{ modelo, precio: null }` lo
 * borra y el modelo vuelve al calculado desde el relámpago de MELI. Solo el
 * dueño.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  if (rolDeSesion(user) !== "dueño") return NextResponse.json({ error: "Solo el dueño." }, { status: 403 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const modelo = String(body?.modelo ?? "").trim().toUpperCase();
  if (!modelo || !/^[A-Z]{1,5}\d{2,6}(-\d+)?$/.test(modelo)) return NextResponse.json({ error: "Modelo inválido." }, { status: 400 });
  const precio = body?.precio == null || body.precio === "" ? null : Number(body.precio);
  if (precio != null && (!Number.isFinite(precio) || precio <= 0)) return NextResponse.json({ error: "Precio inválido." }, { status: 400 });

  const admin = clienteAdmin();
  if (precio == null) {
    const { error } = await admin.from("tiktok_precios_objetivo").delete().eq("account_id", cuenta.id).eq("modelo", modelo);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, modelo, precio: null });
  }
  const { error } = await admin
    .from("tiktok_precios_objetivo")
    .upsert({ account_id: cuenta.id, modelo, precio, actualizado_en: new Date().toISOString() }, { onConflict: "account_id,modelo" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, modelo, precio });
}
