/**
 * Números: quién manda entre el sheet y lo capturado en el ERP, campo por
 * campo (dueño, 18-oct-2026: «si hice un cambio en el sistema, toma ese
 * precio y no el del sheet»). El ÚLTIMO cambio manda:
 *  - un campo editado en el ERP (`editados_erp`) se respeta mientras el
 *    sheet siga diciendo lo mismo que la vez anterior (`valores_sheet`);
 *  - si el dueño lo cambia en el sheet, el sheet vuelve a mandar y la marca
 *    se quita.
 */

export const CAMPOS_NUMEROS = [
  "envio_meli",
  "precio_relampago",
  "pv_normal",
  "retencion",
  "envio_amazon",
  "pvp_deal",
  "tiktok_extra",
  "tiktok_comision",
  "tiktok_oferta",
] as const;

export type CampoNumeros = (typeof CAMPOS_NUMEROS)[number];
export type ValorNumeros = number | boolean | null;
export type ValoresNumeros = Record<CampoNumeros, ValorNumeros>;

export interface GuardadoNumeros {
  valores: ValoresNumeros;
  editados: string[];
  /** lo que dijo el sheet la última vez; null = nunca leído con esta regla */
  sheet: Partial<Record<CampoNumeros, ValorNumeros>> | null;
}

const norm = (v: unknown): ValorNumeros => {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function mismoValor(a: unknown, b: unknown): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x == null || y == null) return x == null && y == null;
  if (typeof x === "boolean" || typeof y === "boolean") return Boolean(x) === Boolean(y);
  return Math.abs(x - y) < 0.000001;
}

/** Al leer el sheet: qué se escribe y qué marcas quedan. */
export function mezclarConSheet(
  sheet: ValoresNumeros,
  previo: GuardadoNumeros | null,
): { valores: ValoresNumeros; editados: string[]; respetados: CampoNumeros[] } {
  const valores = { ...sheet };
  const editados: string[] = [];
  const respetados: CampoNumeros[] = [];
  if (!previo) return { valores, editados, respetados };
  for (const c of CAMPOS_NUMEROS) {
    if (!previo.editados.includes(c)) continue;
    const antes = previo.sheet && c in previo.sheet ? previo.sheet[c] : undefined;
    // Sin lectura anterior el sheet no "cambió": manda el ERP.
    const sheetCambio = antes !== undefined && !mismoValor(antes, sheet[c]);
    if (sheetCambio) continue;
    valores[c] = previo.valores[c];
    editados.push(c);
    if (!mismoValor(previo.valores[c], sheet[c])) respetados.push(c);
  }
  return { valores, editados, respetados };
}

/** Al guardar en el ERP: los campos que cambian quedan marcados como del ERP. */
export function marcarEditados(nuevo: ValoresNumeros, previo: GuardadoNumeros | null): string[] {
  const marcas = new Set(previo?.editados ?? []);
  for (const c of CAMPOS_NUMEROS) {
    if (previo && mismoValor(previo.valores[c], nuevo[c])) continue;
    // Igual a lo que dice el sheet = ya no hay diferencia que defender.
    if (previo?.sheet && c in previo.sheet && mismoValor(previo.sheet[c], nuevo[c])) marcas.delete(c);
    else marcas.add(c);
  }
  return CAMPOS_NUMEROS.filter((c) => marcas.has(c));
}
