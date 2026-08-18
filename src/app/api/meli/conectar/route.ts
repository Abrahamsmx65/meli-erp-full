import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { urlAutorizacion } from "@/lib/meli/auth";
import { clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Manda al usuario a autorizar la app en Mercado Libre. */
export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_APP_URL));

  const clientId = process.env.MELI_CLIENT_ID;
  const redirectUri = process.env.MELI_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "Faltan MELI_CLIENT_ID o MELI_REDIRECT_URI en las variables de entorno." },
      { status: 500 },
    );
  }

  // El `state` amarra el callback a esta sesión: sin él, cualquiera podría
  // completar el flujo con un código ajeno.
  const state = randomUUID();
  const jar = await cookies();
  jar.set("meli_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return NextResponse.redirect(
    urlAutorizacion({
      clientId,
      redirectUri,
      siteId: process.env.MELI_SITE_ID ?? "MLM",
      state,
    }),
  );
}
