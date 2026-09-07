/**
 * Sugerencias para ligar a mano lo que la normalización no alcanza.
 *
 * El criterio es deliberadamente simple: MISMO MODELO y MISMA TALLA (solo
 * los dígitos: "MX23" y "23" son la misma talla). El color es justo lo que
 * suele estar escrito distinto ("Negro" vs "BLK", "CAMEL" vs "BROWN"), así
 * que no filtra: se enseñan los candidatos y la persona decide. Un empate
 * nunca se resuelve solo.
 */
import { canonizar } from "../importar/sku";
import { partirSku } from "./despacho";

function tallaDigitos(talla: string | null | undefined): string {
  return String(talla ?? "").replace(/\D/g, "");
}

function pedazos(sku: string): { modelo: string; talla: string } {
  const { modelo, talla } = partirSku(sku);
  return { modelo: canonizar(modelo), talla: tallaDigitos(talla) };
}

/** Candidatos para un SKU: mismos modelo y talla, sin el SKU mismo, máx. `tope`. */
export function sugerirParecidos(sku: string, candidatos: string[], tope = 4): string[] {
  const base = pedazos(sku);
  if (!base.modelo || !base.talla) return [];
  const propio = canonizar(sku);
  const salida: string[] = [];
  for (const c of candidatos) {
    if (!c || canonizar(c) === propio) continue;
    const p = pedazos(c);
    if (p.modelo === base.modelo && p.talla === base.talla) salida.push(c);
    if (salida.length >= tope) break;
  }
  return salida;
}
