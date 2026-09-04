import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { canjearCodigo } from "@/lib/meli/auth";
import { MeliClient } from "@/lib/meli/client";
import { obtenerUsuario } from "@/lib/meli/sync";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { credencialesApp } from "@/lib/yapanizcel/cuenta";

export const dynamic = "force-dynamic";

/** Recibe el código de MELI y guarda la cuenta de YAPANIZCEL con sus tokens. */
export async function GET(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const destino = (msg: string, ok = false) =>
    NextResponse.redirect(new URL(`/yapanizcel/ajustes?${ok ? "ok" : "error"}=${encodeURIComponent(msg)}`, base));

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const errorMeli = req.nextUrl.searchParams.get("error");

  if (errorMeli) return destino(`Mercado Libre rechazó la conexión: ${errorMeli}`);
  if (!code) return destino("Mercado Libre no devolvió el código de autorización.");

  const jar = await cookies();
  const esperado = jar.get("meli_yz_state")?.value;
  if (!esperado || esperado !== state) {
    return destino("El enlace de autorización expiró o no corresponde a esta sesión. Inténtalo otra vez.");
  }
  jar.delete("meli_yz_state");

  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", base));

  const app = credencialesApp();
  if (!app) return destino("Faltan las credenciales de la app de MELI de YAPANIZCEL en el entorno.");

  try {
    const tokens = await canjearCodigo({ clientId: app.clientId, clientSecret: app.clientSecret, redirectUri: app.redirectUri, code });
    const cliente = new MeliClient({ clientId: app.clientId, clientSecret: app.clientSecret, credenciales: tokens });
    const perfil = await obtenerUsuario(cliente);

    const admin = clienteAdmin();
    const { data: cuenta, error: errCuenta } = await admin
      .from("yz_cuentas")
      .upsert(
        {
          owner_id: user.id,
          meli_user_id: perfil.id,
          nickname: perfil.nickname,
          site_id: perfil.siteId,
          actualizado_en: new Date().toISOString(),
        },
        { onConflict: "owner_id,meli_user_id" },
      )
      .select("id")
      .single();
    if (errCuenta || !cuenta) throw new Error(errCuenta?.message ?? "No se pudo guardar la cuenta.");

    const { error: errTok } = await admin.from("yz_tokens").upsert(
      {
        account_id: cuenta.id,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expira_en: new Date(tokens.expiraEn).toISOString(),
        actualizado_en: new Date().toISOString(),
      },
      { onConflict: "account_id" },
    );
    if (errTok) throw new Error(errTok.message);

    return destino(`Conectado como ${perfil.nickname}. Ya puedes sincronizar.`, true);
  } catch (err) {
    return destino((err as Error).message);
  }
}

/**
 * Los AVISOS (webhooks) de la app de MELI de YAPANIZCEL llegan aquí por
 * POST: en el Dev Center la URL de notificaciones quedó apuntando al
 * callback. Sin este manejador Next contestaba 405, MELI lo tomaba como
 * fallo y REINTENTABA cada aviso una y otra vez: ~2 millones de POST al
 * día contra esta ruta, que pasaban por el middleware y saturaban todo.
 *
 * YAPANIZCEL no procesa avisos (sincroniza por cron y por tramos), así que
 * el aviso se acepta y se descarta: un 200 rápido es lo único que hace que
 * MELI deje de insistir. Lo correcto de fondo es quitar o cambiar la URL
 * de notificaciones en la app de MELI de YAPANIZCEL.
 */
export async function POST() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
