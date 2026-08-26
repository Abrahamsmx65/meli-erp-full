import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { pedirTokens } from "@/lib/higgsfield/mcp";

export const dynamic = "force-dynamic";

/**
 * Regreso del login de Higgsfield: valida el state, cambia el código por
 * tokens (con el verificador PKCE) y los guarda por cuenta. El refresh
 * token con offline_access mantiene viva la conexión sin volver a entrar.
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.nextUrl.origin));

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.redirect(new URL("/ajustes", req.nextUrl.origin));

  const destinoError = (mensaje: string) =>
    NextResponse.redirect(
      new URL(`/videos?higgsfield=error&detalle=${encodeURIComponent(mensaje)}`, req.nextUrl.origin),
    );

  const crudo = req.cookies.get("hf_oauth")?.value;
  if (!crudo) return destinoError("La sesión de conexión caducó; intenta de nuevo.");
  let guardado: { v: string; s: string; c: string; r: string };
  try {
    guardado = JSON.parse(crudo);
  } catch {
    return destinoError("Cookie de conexión ilegible.");
  }

  const codigo = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!codigo || state !== guardado.s) {
    return destinoError("Higgsfield no regresó un código válido.");
  }

  try {
    const tokens = await pedirTokens({
      clientId: guardado.c,
      codigo,
      codeVerifier: guardado.v,
      redirectUri: guardado.r,
    });

    const admin = clienteAdmin();
    const { error } = await admin.from("higgsfield_mcp").upsert({
      account_id: cuenta.id,
      client_id: guardado.c,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      expira_en: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
      actualizado_en: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    return destinoError((err as Error).message.slice(0, 200));
  }

  const res = NextResponse.redirect(new URL("/videos?higgsfield=conectado", req.nextUrl.origin));
  res.cookies.delete("hf_oauth");
  return res;
}
