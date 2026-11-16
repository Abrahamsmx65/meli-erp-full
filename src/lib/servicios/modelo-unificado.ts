import { desglosarSku } from "../importar/desglose-sku";
import { desglosar as desglosarFunda } from "../yapanizcel/sku";

/**
 * Modelo unificado de un SKU: el modelo de calzado si lo es, y si no, el
 * diseño de la funda. "437-RmPad-2-navy" → 437; "GT114-NEGRO-25" → GT114;
 * "N-462-A06" → 462; "glass-A53" → GLASS.
 */
export function modeloUnificado(sku: string): string {
  const s = String(sku ?? "").trim();
  if (!s) return "";
  const calzado = (desglosarSku(s).modelo ?? s).toUpperCase();
  // Un modelo que empieza con número, o que es un prefijo suelto de una o
  // dos letras (N-462…), no es calzado: es un diseño de funda.
  if (/^\d/.test(calzado) || /^[A-Z]{1,2}$/.test(calzado)) {
    const d = desglosarFunda(s).diseno;
    return (d || calzado).toUpperCase();
  }
  return calzado;
}
