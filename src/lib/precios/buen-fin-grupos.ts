/**
 * Agrupa por FAMILIA lo que MELI rechazó en Buen Fin (dueño, 23-oct-2026:
 * «agrupar por familias cuando son productos de muchas variantes pero llevan
 * mismo precio, para confirmar todo junto»). Una familia = mismo modelo,
 * misma promoción y los mismos precios (lo que queríamos y lo que MELI
 * acepta o ya tiene): GT277 en Buen Fin 26 con 12 publicaciones de $298.99
 * → $289.99 es UN renglón con un solo botón. El modelo y la promoción salen
 * de `donde` («MLM… · GT277 · Buen Fin 26»).
 */
export interface RenglonAgrupable {
  donde: string;
  detalle: string;
  aceptar?: { queriamos: number; precio: number | null; actual: number | null };
}

export interface FamiliaBuenFin<T extends RenglonAgrupable> {
  clave: string;
  modelo: string;
  promocion: string;
  renglones: T[];
}

export function partesDeDonde(donde: string): { item: string; modelo: string; promocion: string } {
  const [item = "", modelo = "", ...resto] = donde.split(" · ");
  return { item, modelo, promocion: resto.join(" · ") };
}

const comparar = new Intl.Collator("es", { numeric: true }).compare;

/**
 * `precioDe` decide qué precio entra a la clave (el que MELI acepta, el que
 * ya tiene, o ninguno para agrupar por mensaje).
 */
export function agruparPorFamilia<T extends RenglonAgrupable>(
  renglones: T[],
  precioDe: (r: T) => string,
): FamiliaBuenFin<T>[] {
  const grupos = new Map<string, FamiliaBuenFin<T>>();
  for (const r of renglones) {
    const { modelo, promocion } = partesDeDonde(r.donde);
    const clave = [modelo, promocion, precioDe(r)].join("|");
    const g = grupos.get(clave) ?? { clave, modelo, promocion, renglones: [] };
    g.renglones.push(r);
    grupos.set(clave, g);
  }
  return [...grupos.values()].sort((a, b) => comparar(a.modelo, b.modelo) || comparar(a.clave, b.clave));
}

export interface RenglonParaAceptar {
  itemId: string;
  promoId: string | null;
  tipo: string;
  offerId: string | null;
  accion: "inscribir" | "cambiar";
  precio: number;
  donde?: string;
}

/** Lo que la pantalla manda para aceptar a mano, ya revisado (calzado y fundas). */
export function renglonesParaAceptar(cuerpo: unknown): RenglonParaAceptar[] {
  const lista = (cuerpo as { renglones?: unknown } | null)?.renglones;
  return (Array.isArray(lista) ? lista : [])
    .map((x) => x as Record<string, unknown>)
    .filter((x) => typeof x.itemId === "string" && /^MLM\d+$/.test(x.itemId) && Number(x.precio) > 0)
    .map((x) => ({
      itemId: x.itemId as string,
      promoId: typeof x.promoId === "string" ? x.promoId : null,
      tipo: String(x.tipo ?? ""),
      offerId: typeof x.offerId === "string" ? x.offerId : null,
      accion: x.accion === "cambiar" ? "cambiar" : "inscribir",
      precio: Math.round(Number(x.precio) * 100) / 100,
      donde: typeof x.donde === "string" ? x.donde : undefined,
    }));
}
