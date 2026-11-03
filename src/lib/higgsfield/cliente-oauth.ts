import { MCP_SCOPE } from "./mcp";

/**
 * Identidad OAuth del ERP ante el MCP de Higgsfield por CLIENT ID METADATA
 * DOCUMENT: el `client_id` ES una URL nuestra que sirve este documento JSON
 * y el servidor OAuth puede leerlo de ahí para validar los redirect_uris.
 *
 * Hasta el 2-nov-2026 el ERP se registraba con registro dinámico (RFC 7591)
 * en cada conexión, pero Higgsfield cerró ese registro a una lista fija
 * (localhost, 127.0.0.1 y clientes conocidos como claude.ai): nuestro
 * dominio contesta «redirect_uris contains an entry that is not in the
 * trusted list». Y aunque su metadata anuncia
 * `client_id_metadata_document_supported`, se PROBÓ el 3-nov-2026 que su
 * `authorize` aplica la misma lista fija ANTES de leer este documento (con
 * redirect de localhost el client_id-URL avanza al login; con el nuestro
 * rechaza al instante sin pedir la URL): el documento se queda servido por
 * si algún día lo honran, pero la conexión real va por el flujo de PEGAR
 * (`/api/higgsfield/conectar` + `/api/higgsfield/canjear`): registro
 * dinámico con redirect de localhost —que sí confían—, el navegador termina
 * en una página que no carga y el dueño pega esa dirección en el ERP.
 */

export const RUTA_CLIENTE = "/api/higgsfield/cliente";
export const RUTA_CALLBACK = "/api/higgsfield/callback";

/**
 * El ÚNICO redirect que Higgsfield acepta para un cliente nuestro desde el
 * 2-nov-2026. En desarrollo el callback carga de verdad; en producción el
 * navegador se queda en una página que no existe y la dirección completa
 * (con ?code= y &state=) se pega en el ERP, que canjea el código.
 */
export const REDIRECT_CONFIANZA = `http://localhost:3000${RUTA_CALLBACK}`;

/**
 * Saca code y state de lo que el dueño pegó: la dirección completa de la
 * página que no cargó, o solo su parte de ?code=…&state=…. Tolerante a
 * espacios y a que el navegador agregue o quite pedazos.
 */
export function codigoPegado(texto: string): { code: string; state: string } | null {
  const limpio = texto.trim();
  if (!limpio) return null;
  const buscar = (crudo: string): { code: string; state: string } | null => {
    const params = new URLSearchParams(crudo);
    const code = params.get("code");
    const state = params.get("state");
    return code && state ? { code, state } : null;
  };
  try {
    const url = new URL(limpio);
    const encontrado = buscar(url.search.replace(/^\?/, ""));
    if (encontrado) return encontrado;
  } catch {
    // No era una URL completa; se intenta como puros parámetros.
  }
  const sinRuta = limpio.replace(/^[^?]*\?/, "");
  return buscar(sinRuta);
}

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
