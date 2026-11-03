/**
 * La llave con que Industher lee la información del ERP
 * (`/api/integracion/*`): header `x-api-key` = CORRIDAS_API_KEY, comparada
 * en tiempo constante. Una sola llave para corridas y contenedores.
 */
import { timingSafeEqual } from "node:crypto";

export function llaveIntegracionValida(presentada: string | null): boolean {
  const esperada = (process.env.CORRIDAS_API_KEY ?? "").trim();
  const dada = (presentada ?? "").trim();
  if (!esperada || !dada) return false;
  const a = Buffer.from(dada);
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}
