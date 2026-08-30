import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Manda al usuario a autorizar la app en TikTok Shop.
 *
 * La URL de autorización NO vive en el dominio del API sino en el de
 * servicios (`services.tiktokshop.com`), y sale del panel de la app: cada
 * integración tiene la suya. Por eso se toma de `TIKTOK_AUTH_URL` en vez de
 * armarla, que es lo que hace fallar a medio mundo con "invalid app".
 */
export async function GET(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;

  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", base));

  const authUrl = process.env.TIKTOK_AUTH_URL;
  if (!authUrl || !process.env.TIKTOK_APP_KEY) {
    return NextResponse.json(
      {
        error:
          "Faltan TIKTOK_APP_KEY / TIKTOK_APP_SECRET / TIKTOK_AUTH_URL en las variables de entorno.",
      },
      { status: 500 },
    );
  }

  // El `state` amarra el callback a esta sesión: sin él, cualquiera podría
  // completar el flujo con un código ajeno.
  const state = randomUUID();
  const jar = await cookies();
  jar.set("tiktok_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  const url = new URL(authUrl);
  url.searchParams.set("service_id", process.env.TIKTOK_SERVICE_ID ?? "");
  url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}
