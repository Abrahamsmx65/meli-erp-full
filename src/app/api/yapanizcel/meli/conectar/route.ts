import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { urlAutorizacion } from "@/lib/meli/auth";
import { clienteServidor } from "@/lib/supabase/server";
import { credencialesApp } from "@/lib/yapanizcel/cuenta";

export const dynamic = "force-dynamic";

/** Manda al usuario a autorizar la app de YAPANIZCEL en Mercado Libre. */
export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_APP_URL));

  const app = credencialesApp();
  if (!app) {
    return NextResponse.json(
      { error: "Faltan MELI_YZ_CLIENT_ID / MELI_YZ_CLIENT_SECRET en las variables de entorno." },
      { status: 500 },
    );
  }

  // El `state` amarra el callback a esta sesión. Cookie propia para no
  // chocar con la del ERP de calzado si se conectan las dos seguidas.
  const state = randomUUID();
  const jar = await cookies();
  jar.set("meli_yz_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return NextResponse.redirect(
    urlAutorizacion({ clientId: app.clientId, redirectUri: app.redirectUri, siteId: app.siteId, state }),
  );
}
