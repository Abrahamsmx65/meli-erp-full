/**
 * Sugerencias para ligar a mano lo que la normalización no alcanza.
 *
 * El criterio es deliberadamente simple: MISMO MODELO y MISMA TALLA (solo
 * los dígitos: "MX23" y "23" son la misma talla). El color es justo lo que
 * suele estar escrito distinto ("Negro" vs "BLK", "CAMEL" vs "BROWN"), así
 * que no filtra: se enseñan los candidatos y la persona decide. Un empate
 * nunca se resuelve solo.
 */
import { canonizar, claveComparacion } from "../importar/sku";
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
  // El del MISMO nombre también se sugiere, y primero: si el renglón está
  // sin ligar a pesar de llamarse igual, es que la publicación quedó
  // amarrada a otro lado (a un nombre viejo, al de MELI) y ligarla aquí es
  // justo la corrección.
  const propio = claveComparacion(sku);
  const iguales: string[] = [];
  const parecidos: string[] = [];
  for (const c of candidatos) {
    if (!c || c === sku) continue;
    const p = pedazos(c);
    if (p.modelo !== base.modelo || p.talla !== base.talla) continue;
    (claveComparacion(c) === propio ? iguales : parecidos).push(c);
  }
  return [...iguales, ...parecidos].slice(0, tope);
}
