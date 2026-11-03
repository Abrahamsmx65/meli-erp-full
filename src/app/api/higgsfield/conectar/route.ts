import { NextResponse, type NextRequest } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { MCP_BASE, MCP_RECURSO, MCP_SCOPE } from "@/lib/higgsfield/mcp";
import {
  RUTA_CALLBACK,
  clientIdDelErp,
  dominiosDelErp,
} from "@/lib/higgsfield/cliente-oauth";

export const dynamic = "force-dynamic";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Arranca la conexión OAuth con la CUENTA de Higgsfield (mcp.higgsfield.ai):
 * arma el reto PKCE y manda al usuario al login de Higgsfield. El callback
 * (/api/higgsfield/callback) guarda los tokens. El client_id es la URL del
 * documento de metadatos del ERP (`cliente-oauth.ts`): el registro dinámico
 * de antes murió el 2-nov-2026 cuando Higgsfield lo cerró a su lista fija
 * («redirect_uris contains an entry that is not in the trusted list»).
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
  // proxy de Vercel. NEXT_PUBLIC_APP_URL no se usa aquí a propósito: si trae
  // el valor de relleno del ejemplo, la redirección de OAuth se rompe.
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) {
    return NextResponse.json({ error: "No se pudo determinar el dominio." }, { status: 500 });
  }
  // El redirect_uri tiene que estar en el documento de metadatos (Higgsfield
  // lo valida contra él). Un host que no está ahí no puede conectar: el
  // callback de otro dominio ni siquiera vería la cookie del PKCE.
  if (!dominiosDelErp().includes(host) && !host.startsWith("localhost")) {
    return NextResponse.json(
      {
        error: `Conéctate desde el dominio de producción (${dominiosDelErp()[0]}); este dominio (${host}) no está en el documento del cliente OAuth.`,
      },
      { status: 400 },
    );
  }
  const redirectUri = `${proto}://${host}${RUTA_CALLBACK}`;
  const clientId = clientIdDelErp();

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
  // Lo que el callback necesita viaja en una cookie httpOnly de 10 minutos.
  res.cookies.set(
    "hf_oauth",
    JSON.stringify({ v: verifier, s: state, c: clientId, r: redirectUri }),
    { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/higgsfield" },
  );
  return res;
}
