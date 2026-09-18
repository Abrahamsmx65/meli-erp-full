/**
 * Cómo se enseña el inventario del Almacén TikTok (pedido del dueño,
 * 18-sep-2026: «tienes todo revuelto, me gustaría que esté ordenado por
 * SKU alfabéticamente y que también se pueda buscar y que arriba salga el
 * total de la búsqueda»). Motor puro para la pantalla: ordena, filtra y
 * suma. La urgencia (lo que TikTok aún no sabe) ya la gritan las fichas
 * de arriba y Pendientes; la tabla es para ENCONTRAR un SKU.
 */

export interface RenglonInventario {
  sku: string;
  titulo: string | null;
  saldo: number;
  apartado: number;
  disponible: number;
  ventas30: number;
}

/** Alfabético con números naturales: GT102 antes que GT134, talla 23 antes que 24. */
export function ordenarPorSku<T extends { sku: string }>(renglones: T[]): T[] {
  return [...renglones].sort((a, b) => a.sku.localeCompare(b.sku, "es", { numeric: true, sensitivity: "base" }));
}

/** Se busca por pedazos: "gt134 blk 24" encuentra GT134-BLK-24-MX; el título también cuenta. */
export function filtrarInventario<T extends { sku: string; titulo?: string | null }>(renglones: T[], busqueda: string): T[] {
  const partes = normalizar(busqueda).split(/\s+/).filter(Boolean);
  if (!partes.length) return renglones;
  return renglones.filter((r) => {
    const texto = normalizar(`${r.sku} ${r.titulo ?? ""}`);
    return partes.every((p) => texto.includes(p));
  });
}

export function totalesDeInventario(renglones: RenglonInventario[]) {
  return renglones.reduce(
    (t, r) => ({
      skus: t.skus + 1,
      saldo: t.saldo + r.saldo,
      apartado: t.apartado + r.apartado,
      disponible: t.disponible + r.disponible,
      ventas30: t.ventas30 + r.ventas30,
    }),
    { skus: 0, saldo: 0, apartado: 0, disponible: 0, ventas30: 0 },
  );
}

function normalizar(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[-_/]+/g, " ");
}
