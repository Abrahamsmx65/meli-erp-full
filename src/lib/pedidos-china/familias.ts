/**
 * FAMILIAS DE MODELOS: varios números de modelo que la fábrica hace como UN
 * solo zapato y se piden JUNTOS (pedido del dueño, 20-oct-2026: «tengo un
 * modelo que es el GT117 a GT122, quiero juntarlo todo para que se pida
 * junto»). GT117 BROWN, GT118 BLK, GT119 OLIVE, GT120 GREY, GT121 NAVY y
 * GT122 BLK son el mismo modelo en seis colores: en MELI viven en una sola
 * publicación y Mingtai los manda en un solo IN.
 *
 * Motor puro (pruebas en `familias.test.ts`). La tabla `modelos_familias`
 * guarda modelo → familia por cuenta; aquí solo se arma el mapa y se agrupa.
 */
import { canonizar } from "../importar/sku";

/** modelo canónico → nombre de la familia */
export type MapaFamilias = Map<string, string>;

export interface FilaFamilia {
  modelo: string;
  familia: string;
}

export interface Familia {
  familia: string;
  modelos: string[];
}

export function armarMapaFamilias(filas: FilaFamilia[]): MapaFamilias {
  const m: MapaFamilias = new Map();
  for (const f of filas) {
    const k = canonizar(f.modelo);
    const nombre = String(f.familia ?? "").trim().toUpperCase();
    if (k && nombre) m.set(k, nombre);
  }
  return m;
}

/** La familia del modelo, o null si va solo. */
export function familiaDe(mapa: MapaFamilias | null | undefined, modelo: string): string | null {
  if (!mapa?.size) return null;
  return mapa.get(canonizar(modelo)) ?? null;
}

/** Con qué nombre se agrupa el modelo: su familia o él mismo. */
export function grupoDeModelo(mapa: MapaFamilias | null | undefined, modelo: string): string {
  return familiaDe(mapa, modelo) ?? modelo.toUpperCase();
}

/** Las familias como lista (modelos en orden natural), para la pantalla. */
export function listarFamilias(mapa: MapaFamilias): Familia[] {
  const porFamilia = new Map<string, string[]>();
  for (const [modelo, familia] of mapa) {
    const g = porFamilia.get(familia);
    if (g) g.push(modelo);
    else porFamilia.set(familia, [modelo]);
  }
  return [...porFamilia.entries()]
    .map(([familia, modelos]) => ({
      familia,
      modelos: modelos.sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
    }))
    .sort((a, b) => a.familia.localeCompare(b.familia, "en", { numeric: true }));
}

/**
 * Nombre que se propone para una familia nueva: el primer y el último modelo
 * («GT117-GT122»); uno solo, él mismo.
 */
export function nombreDeFamilia(modelos: string[]): string {
  const ms = [...new Set(modelos.map(canonizar).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "en", { numeric: true }),
  );
  if (!ms.length) return "";
  if (ms.length === 1) return ms[0];
  return `${ms[0]}-${ms[ms.length - 1]}`;
}

/**
 * Agrupa elementos con modelo por familia, conservando el orden en que
 * aparecen: los de una misma familia caen en el grupo de la primera vez que
 * salió uno de ellos. Un modelo sin familia es su propio grupo.
 */
export function agruparPorFamilia<T extends { modelo: string }>(
  elementos: T[],
  mapa: MapaFamilias | null | undefined,
): { nombre: string; familia: string | null; elementos: T[] }[] {
  const grupos: { nombre: string; familia: string | null; elementos: T[] }[] = [];
  const indice = new Map<string, number>();
  for (const e of elementos) {
    const familia = familiaDe(mapa, e.modelo);
    const nombre = familia ?? canonizar(e.modelo);
    const clave = familia ? `f:${familia}` : `m:${nombre}`;
    const i = indice.get(clave);
    if (i == null) {
      indice.set(clave, grupos.length);
      grupos.push({ nombre, familia, elementos: [e] });
    } else grupos[i].elementos.push(e);
  }
  return grupos;
}

/** Valida el alta de una familia: nombre y al menos dos modelos distintos. */
export function validarFamilia(familia: string, modelos: string[]): { familia: string; modelos: string[] } {
  const nombre = String(familia ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  const ms = [...new Set(modelos.map((m) => canonizar(String(m ?? ""))).filter(Boolean))];
  if (!nombre) throw new Error("Ponle nombre a la familia (por ejemplo GT117-GT122).");
  if (nombre.length > 40) throw new Error("El nombre de la familia es demasiado largo.");
  if (ms.length < 2) throw new Error("Una familia necesita al menos dos modelos.");
  for (const m of ms) {
    if (!/^[A-Z]{1,4}\d{2,5}(?:-\d{1,2})?[A-Z]?$/.test(m)) throw new Error(`«${m}» no parece un modelo (GT117, MY2307…).`);
  }
  return { familia: nombre, modelos: ms };
}
