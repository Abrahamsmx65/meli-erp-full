import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function sesion() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 }) };
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return { error: NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 }) };
  return { supabase, cuenta };
}

/** Alta de una equivalencia de color TikTok → Amazon para un modelo. */
export async function POST(req: NextRequest) {
  const s = await sesion();
  if ("error" in s) return s.error;
  const body = await req.json().catch(() => ({}));
  const modelo = String(body?.modelo ?? "").trim().toUpperCase();
  const colorTikTok = String(body?.colorTikTok ?? "").trim().toUpperCase();
  const colorAmazon = String(body?.colorAmazon ?? "").trim().toUpperCase();
  if (!modelo || !colorTikTok || !colorAmazon) {
    return NextResponse.json({ error: "Faltan modelo, color en TikTok y color en Amazon." }, { status: 400 });
  }
  const { error } = await s.supabase
    .from("tiktok_alias_amazon")
    .upsert({ account_id: s.cuenta.id, modelo, color_tiktok: colorTikTok, color_amazon: colorAmazon }, { onConflict: "account_id,modelo,color_tiktok" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const s = await sesion();
  if ("error" in s) return s.error;
  const body = await req.json().catch(() => ({}));
  const modelo = String(body?.modelo ?? "").trim().toUpperCase();
  const colorTikTok = String(body?.colorTikTok ?? "").trim().toUpperCase();
  if (!modelo || !colorTikTok) return NextResponse.json({ error: "Faltan modelo y color." }, { status: 400 });
  const { error } = await s.supabase
    .from("tiktok_alias_amazon")
    .delete()
    .eq("account_id", s.cuenta.id)
    .eq("modelo", modelo)
    .eq("color_tiktok", colorTikTok);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
