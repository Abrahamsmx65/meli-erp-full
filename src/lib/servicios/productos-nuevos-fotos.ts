/**
 * Fotos de los productos nuevos: qué se guarda y cuándo se vuelve a
 * preguntar. Decisión del dueño: lo que ya tiene sus fotos se guarda y no se
 * revisa otra vez; solo se revisa lo que aún no las tiene, lo que nunca se
 * revisó y lo que cambió de publicaciones (un color nuevo, un ASIN nuevo).
 * "Revisar todo de nuevo" pasa por encima de eso.
 */
import { FOTOS_MINIMAS, type ProductoNuevo } from "./productos-nuevos";

export interface FotosProducto {
  clave: string;
  /** null = sin publicación en MELI (o MELI no contestó por ella) */
  meli: { fotos: number | null; itemId: string | null; estado: string | null };
  /** null = sin publicación en Amazon; `sinCuenta` cuando Amazon no está conectado */
  amazon: { fotos: number | null; asin: string | null };
  /** cuándo se le preguntó a MELI/Amazon por este producto (null: nunca o falló) */
  revisadoEn?: string | null;
}

export type FotosGuardada = FotosProducto & { huella: string };

/** Huella de lo publicado: si cambia, se vuelve a revisar. */
export function huellaPublicaciones(p: Pick<ProductoNuevo, "meli" | "amazon">): string {
  return [
    ...p.meli.publicaciones.map((x) => `${x.itemId ?? ""}:${x.variationId ?? ""}`).sort(),
    "|",
    ...[...p.amazon.asins].sort(),
  ].join(",");
}

export function tocaRevisar(
  p: Pick<ProductoNuevo, "meli" | "amazon">,
  guardado: FotosGuardada | undefined,
  amazonConectado: boolean,
  todo: boolean,
): boolean {
  if (todo || !guardado || !guardado.revisadoEn) return true;
  if (guardado.huella !== huellaPublicaciones(p)) return true;
  const publicadoMeli = p.meli.publicaciones.some((x) => x.itemId);
  if (publicadoMeli && (guardado.meli.fotos == null || guardado.meli.fotos < FOTOS_MINIMAS)) return true;
  const publicadoAmz = amazonConectado && p.amazon.asins.length > 0;
  if (publicadoAmz && (guardado.amazon.fotos == null || guardado.amazon.fotos < FOTOS_MINIMAS)) return true;
  return false;
}

/**
 * Lo ya revisado y GUARDADO (`nuevos:fotos`) que la pantalla puede enseñar al
 * abrir sin preguntarle a MELI ni a Amazon: solo de los productos de la lista
 * y solo si lo publicado no cambió desde la revisión (misma huella). Lo
 * demás sale «sin revisar» y se pregunta con el botón.
 */
export function fotosGuardadasVigentes(
  lista: Pick<ProductoNuevo, "clave" | "meli" | "amazon">[],
  guardadas: Record<string, FotosGuardada> | null | undefined,
): FotosProducto[] {
  if (!guardadas) return [];
  const salida: FotosProducto[] = [];
  for (const p of lista) {
    const g = guardadas[p.clave];
    if (!g || g.huella !== huellaPublicaciones(p)) continue;
    salida.push({ clave: p.clave, meli: g.meli, amazon: g.amazon, revisadoEn: g.revisadoEn ?? null });
  }
  return salida;
}
