import { NextResponse, type NextRequest } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { MCP_BASE, MCP_RECURSO, MCP_SCOPE, registrarCliente } from "@/lib/higgsfield/mcp";
import { REDIRECT_CONFIANZA } from "@/lib/higgsfield/cliente-oauth";

export const dynamic = "force-dynamic";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Arranca la conexión OAuth con la CUENTA de Higgsfield (mcp.higgsfield.ai):
 * registra el cliente, arma el reto PKCE y manda al usuario al login de
 * Higgsfield. Desde el 2-nov-2026 Higgsfield solo confía en redirects de
 * LOCALHOST (nuestro dominio contesta «not in the trusted list», probado el
 * 3-nov-2026 también con el documento de metadatos: su lista se aplica antes
 * de leerlo), así que en producción el navegador termina en una página de
 * localhost que no carga y el dueño PEGA esa dirección en la pantalla de
 * Videos; `/api/higgsfield/canjear` cambia el código por los tokens. En
 * desarrollo local el callback de siempre sí carga y guarda solo.
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.nextUrl.origin));

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return NextResponse.redirect(new URL("/ajustes", req.nextUrl.origin));
  }

  // El dominio REAL con el que entró el usuario, desde los headers del
  const redirectUri = REDIRECT_CONFIANZA;
  let clientId: string;
  try {
    clientId = await registrarCliente(redirectUri);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(24));

  const autorizar = new URL(`${MCP_BASE}/oauth2/authorize`);
  autorizar.searchParams.set("response_type", "code");
  autorizar.searchParams.set("client_id", clientId);
  autorizar.searchParams.set("redirect_uri", redirectUri);
  autorizar.searchParams.set("scope", MCP_SCOPE);
  autorizar.searchParams.set("state", state);
  autorizar.searchParams.set("code_challenge", challenge);
  autorizar.searchParams.set("code_challenge_method", "S256");
  autorizar.searchParams.set("resource", MCP_RECURSO);

  const res = NextResponse.redirect(autorizar);
  // Lo que el canje necesita viaja en una cookie httpOnly de 15 minutos:
  // da tiempo de entrar a Higgsfield, aprobar y pegar la dirección.
  res.cookies.set(
    "hf_oauth",
    JSON.stringify({ v: verifier, s: state, c: clientId, r: redirectUri }),
    { httpOnly: true, secure: true, sameSite: "lax", maxAge: 900, path: "/api/higgsfield" },
  );
  return res;
}
