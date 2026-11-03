import { MCP_SCOPE } from "./mcp";

/**
 * Identidad OAuth del ERP ante el MCP de Higgsfield por CLIENT ID METADATA
 * DOCUMENT: el `client_id` ES una URL nuestra que sirve este documento JSON
 * y Higgsfield lo lee de ahí para validar los redirect_uris.
 *
 * Hasta el 2-nov-2026 el ERP se registraba con registro dinámico (RFC 7591)
 * en cada conexión, pero Higgsfield cerró ese registro a una lista fija
 * (localhost y los callbacks de clientes conocidos): nuestro dominio de
 * Vercel contesta «redirect_uris contains an entry that is not in the
 * trusted list». Su metadata anuncia `client_id_metadata_document_supported`,
 * que es justo el camino para una app web con dominio propio.
 */

export const RUTA_CLIENTE = "/api/higgsfield/cliente";
export const RUTA_CALLBACK = "/api/higgsfield/callback";

/**
 * Los dominios del ERP que pueden iniciar la conexión. El de producción real
 * (de Vercel) va primero y es el CANÓNICO: el client_id siempre apunta ahí,
 * entre quien entre y por el alias que entre, porque Higgsfield lee el
 * documento desde su servidor sin saber por cuál dominio entró el usuario.
 */
export function dominiosDelErp(): string[] {
  const dominios = new Set<string>();
  const prod = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim();
  if (prod) dominios.add(prod.replace(/^https?:\/\//, ""));
  dominios.add("meli-erp-full.vercel.app");
  dominios.add("meli-erp-full-getac.vercel.app");
  return [...dominios];
}

/** El client_id del ERP: la URL canónica del documento de metadatos. */
export function clientIdDelErp(): string {
  return `https://${dominiosDelErp()[0]}${RUTA_CLIENTE}`;
}

/**
 * El documento de metadatos del cliente. Por la especificación, su
 * `client_id` DEBE ser exactamente la URL donde se sirve, y el
 * `redirect_uri` de cada autorización debe estar en `redirect_uris`.
 */
export function documentoCliente(): Record<string, unknown> {
  const dominios = dominiosDelErp();
  return {
    client_id: clientIdDelErp(),
    client_name: "GETAC ERP",
    client_uri: `https://${dominios[0]}`,
    redirect_uris: [
      ...dominios.map((d) => `https://${d}${RUTA_CALLBACK}`),
      // Desarrollo local (la especificación permite loopback en http).
      `http://localhost:3000${RUTA_CALLBACK}`,
    ],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: MCP_SCOPE,
  };
}
