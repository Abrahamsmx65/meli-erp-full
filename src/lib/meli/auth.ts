/**
 * OAuth de Mercado Libre.
 *
 * Flujo: mandamos al usuario a autorizar -> MELI regresa un `code` a nuestra
 * redirect URI -> lo cambiamos por un par access/refresh token.
 *
 * Detalle importante: MELI ROTA el refresh token en cada renovación. El viejo
 * deja de servir en cuanto se usa, así que siempre hay que guardar el nuevo.
 */
import { MELI_API, MeliError, type Credenciales } from "./client";

/** Dominio de autorización por sitio. */
const DOMINIO_AUTH: Record<string, string> = {
  MLM: "https://auth.mercadolibre.com.mx",
  MLA: "https://auth.mercadolibre.com.ar",
  MLB: "https://auth.mercadolivre.com.br",
  MLC: "https://auth.mercadolibre.cl",
  MCO: "https://auth.mercadolibre.com.co",
  MPE: "https://auth.mercadolibre.com.pe",
  MLU: "https://auth.mercadolibre.com.uy",
};

export function urlAutorizacion(opts: {
  clientId: string;
  redirectUri: string;
  siteId?: string;
  state: string;
}): string {
  const base = DOMINIO_AUTH[opts.siteId ?? "MLM"] ?? DOMINIO_AUTH.MLM;
  const u = new URL(`${base}/authorization`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("state", opts.state);
  return u.toString();
}

export interface ResultadoToken extends Credenciales {
  meliUserId: number;
  scope?: string;
}

export async function canjearCodigo(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<ResultadoToken> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    redirect_uri: opts.redirectUri,
  });

  const res = await fetch(`${MELI_API}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    cache: "no-store",
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    throw new MeliError(
      `No se pudo canjear el código: ${JSON.stringify(json)}`,
      res.status,
      json,
      "/oauth/token",
    );
  }

  return {
    accessToken: String(json.access_token),
    refreshToken: String(json.refresh_token),
    expiraEn: Date.now() + Number(json.expires_in ?? 21600) * 1000,
    meliUserId: Number(json.user_id),
    scope: json.scope ? String(json.scope) : undefined,
  };
}
