/**
 * Cómo se ENSEÑA un producto en el catálogo (dueño, 19-oct-2026: «que el
 * catálogo tenga un formato más bonito»). Solo presentación: los datos los
 * arma el ERP.
 */

/** Siglas que se quedan en mayúsculas al suavizar un título GRITADO. */
const SIGLAS = new Set(["EVA", "TPE", "UGG", "PVC", "PU", "TPR", "MX", "USA"]);

/**
 * El título sin la marca al frente y sin palabras GRITADAS: «GETAC CHANCLAS
 * MUJER, SANDALIAS HOMBRE con Plantilla…» → «Chanclas mujer, sandalias
 * hombre con Plantilla…». La primera letra va en mayúscula.
 */
export function tituloCorto(titulo: string): string {
  const sinMarca = String(titulo ?? "")
    .replace(/^\s*GETAC\b[\s,.:-]*/i, "")
    .trim();
  const suave = sinMarca.replace(/\p{L}[\p{L}'’]*/gu, (w) => {
    if (w.length < 2 || w !== w.toLocaleUpperCase("es-MX")) return w;
    return SIGLAS.has(w) ? w : w.toLocaleLowerCase("es-MX");
  });
  return suave.charAt(0).toLocaleUpperCase("es-MX") + suave.slice(1);
}

/** «23 a 28» si las tallas son números seguidos; si no, la lista. */
export function rangoTallas(tallas: string[]): string {
  const limpias = tallas.map((t) => String(t).trim()).filter(Boolean);
  if (limpias.length < 3) return limpias.join(", ");
  const nums = limpias.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return limpias.join(", ");
  const seguidas = nums.every((n, i) => i === 0 || (n > nums[i - 1] && n - nums[i - 1] <= 1));
  return seguidas ? `${limpias[0]} a ${limpias[limpias.length - 1]}` : limpias.join(", ");
}

/**
 * La categoría como se agrupa y se enseña: en MAYÚSCULAS, un solo espacio
 * («Botas lluvia» y «BOTAS LLUVIA» son la misma). El ERP ya las guarda así;
 * esto cubre lo armado antes.
 */
export function categoriaVisible(c: string | null | undefined): string | null {
  const limpia = String(c ?? "").replace(/\s+/g, " ").trim();
  return limpia ? limpia.toLocaleUpperCase("es-MX") : null;
}
