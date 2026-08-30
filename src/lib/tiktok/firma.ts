/**
 * Firma de las peticiones al API de TikTok Shop Partner.
 *
 * TikTok no usa OAuth a secas: además del access token, CADA llamada va
 * firmada con el app_secret. Si la firma no cuadra contesta 10001 y no dice
 * por qué, así que el algoritmo va aquí solo, sin red ni estado, y probado
 * contra el ejemplo de su documentación.
 *
 * La receta (v202309), en orden y sin saltarse un paso:
 *   1. De los parámetros de la URL se quitan `sign` y `access_token`.
 *   2. Los demás se ordenan por nombre, alfabéticamente.
 *   3. Se pegan uno tras otro como nombre+valor, sin separadores.
 *   4. Delante va la RUTA de la petición (sin dominio ni query).
 *   5. Detrás va el cuerpo crudo, tal cual se manda (salvo multipart).
 *   6. Todo eso se envuelve con el app_secret a los dos lados.
 *   7. HMAC-SHA256 de esa cadena, con el app_secret de llave, en hexadecimal.
 */
import { createHmac } from "node:crypto";

/**
 * Los dos que NUNCA entran en la firma. `access_token` va en el encabezado
 * y `sign` es justamente lo que se está calculando.
 */
const FUERA_DE_LA_FIRMA = new Set(["sign", "access_token"]);

/**
 * La cadena que se va a firmar. Se expone aparte de `firmar` porque cuando
 * TikTok contesta 10001 lo único que sirve es comparar esta cadena contra
 * la que ellos esperaban.
 */
export function cadenaAFirmar(
  ruta: string,
  params: Record<string, string | number | undefined>,
  cuerpo: string,
  appSecret: string,
): string {
  const ordenados = Object.entries(params)
    .filter(([k, v]) => !FUERA_DE_LA_FIRMA.has(k) && v !== undefined && v !== null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}${v}`)
    .join("");

  return `${appSecret}${ruta}${ordenados}${cuerpo}${appSecret}`;
}

/** La firma en hexadecimal, que es lo que va en el parámetro `sign`. */
export function firmar(
  ruta: string,
  params: Record<string, string | number | undefined>,
  cuerpo: string,
  appSecret: string,
): string {
  return createHmac("sha256", appSecret)
    .update(cadenaAFirmar(ruta, params, cuerpo, appSecret))
    .digest("hex");
}

/** TikTok pide el timestamp en SEGUNDOS, no en milisegundos. */
export function timestamp(ahora = Date.now()): number {
  return Math.floor(ahora / 1000);
}
