import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { canjearCodigo, configuracionTikTok } from "@/lib/tiktok/client";
import { completarConexion } from "@/lib/servicios/tiktok";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Recibe el código de TikTok, guarda los tokens y resuelve tienda y bodega. */
export async function GET(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const destino = (msg: string, ok = false) =>
    NextResponse.redirect(
      new URL(`/tiktok?${ok ? "ok" : "error"}=${encodeURIComponent(msg)}`, base),
    );

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code) return destino("TikTok no devolvió el código de autorización.");

  const jar = await cookies();
  const esperado = jar.get("tiktok_state")?.value;
  if (!esperado || esperado !== state) {
    return destino("El enlace de autorización expiró o no corresponde a esta sesión.");
  }
  jar.delete("tiktok_state");

  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", base));

  const app = configuracionTikTok();
  if (!app) return destino("Faltan TIKTOK_APP_KEY y TIKTOK_APP_SECRET en el entorno.");

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return destino("Primero hay que conectar Mercado Libre: TikTok cuelga de esa cuenta.");

  try {
    const tokens = await canjearCodigo(app, code);
    const admin = clienteAdmin();
    const r = await completarConexion(admin, cuenta.id, app, tokens);

    if (r.avisos.length) return destino(`Conectado con avisos: ${r.avisos.join(" · ")}`, true);
    return destino("TikTok Shop conectado.", true);
  } catch (err) {
    return destino((err as Error).message);
  }
}
