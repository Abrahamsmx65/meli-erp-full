import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { canjearCodigo, configuracionTikTok } from "@/lib/tiktok/client";
import { completarConexion } from "@/lib/servicios/tiktok";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Recibe el código de TikTok, guarda los tokens y resuelve tienda y bodega.
 *
 * El diagnóstico de esta ruta importa tanto como el canje: cuando algo sale
 * mal, TikTok redirige de vuelta con SU razón en la URL y sin código. La
 * primera versión ignoraba esa razón y siempre decía "no devolvió el
 * código", que es verdad pero no sirve para nada. Ahora se dice qué contestó
 * TikTok, y si no contestó nada reconocible, qué parámetros sí llegaron.
 */
export async function GET(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const destino = (msg: string, ok = false) =>
    NextResponse.redirect(
      new URL(`/tiktok?${ok ? "ok" : "error"}=${encodeURIComponent(msg)}`, base),
    );

  const params = req.nextUrl.searchParams;

  // Si TikTok rechazó la autorización, la razón viene aquí. Va primero:
  // decirle al usuario que "faltó el código" cuando TikTok explicó que el
  // redirect URI no coincide es mandarlo a buscar en el lugar equivocado.
  const errorTikTok = params.get("error") ?? params.get("error_code");
  if (errorTikTok) {
    const detalle = params.get("error_description") ?? params.get("message");
    return destino(`TikTok rechazó la conexión (${errorTikTok})${detalle ? `: ${detalle}` : "."}`);
  }

  // TikTok manda el código como `code` en el flujo de tienda y como
  // `auth_code` en algunas variantes de su panel. Se aceptan los dos.
  const code = params.get("code") ?? params.get("auth_code");
  const state = params.get("state");

  if (!code) {
    const llegaron = [...params.keys()];
    return destino(
      llegaron.length
        ? `TikTok no devolvió el código de autorización. Lo que llegó fue: ${llegaron.join(", ")}.`
        : "Se abrió el callback sin ningún parámetro. Esta dirección no se visita a mano: " +
          "entra a Almacén TikTok y usa el botón Conectar TikTok Shop.",
    );
  }

  const jar = await cookies();
  const esperado = jar.get("tiktok_state")?.value;
  if (!esperado || esperado !== state) {
    // Sin cookie casi siempre significa que la autorización se hizo desde
    // el panel de TikTok y no desde el botón del ERP: ese camino no puede
    // amarrarse a una sesión, y decir "expiró" mandaba a reintentar lo mismo.
    return destino(
      !esperado
        ? "Esta autorización no salió del ERP (llegó sin la cookie de seguridad). " +
          "No autorices desde el panel de TikTok: entra a Almacén TikTok y usa el botón " +
          "Conectar TikTok Shop, en este mismo navegador."
        : "El enlace de autorización expiró o no corresponde a esta sesión. " +
          "Vuelve a Almacén TikTok y dale otra vez a Conectar TikTok Shop.",
    );
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
