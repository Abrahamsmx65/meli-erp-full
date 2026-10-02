/**
 * Catálogo para INFLUENCERS: todo lo que GETAC tiene en TikTok Shop, activo
 * e inactivo, para que cada creador elija qué quiere promocionar (pedido
 * del dueño, 2-oct-2026). No se vende desde aquí: la selección se manda por
 * WhatsApp o se copia. Motor puro (probado en influencers.test.ts).
 */
import { compararTallas, type Producto, type Variante } from "./tienda";

export interface ColorInfluencer {
  color: string;
  fotos: string[];
  tallas: string[];
  /** tallas con existencia hoy en el almacén de TikTok */
  tallasConStock: string[];
}

export interface ProductoInfluencer {
  productId: string;
  modelo: string | null;
  titulo: string;
  categoria: string | null;
  /** activo en TikTok Shop (los inactivos también se pueden elegir) */
  activo: boolean;
  precioDesde: number | null;
  precioHasta: number | null;
  bullets: string[];
  colores: ColorInfluencer[];
  pares: number;
}

export function armarCatalogoInfluencers(
  productos: (Producto & { activo: boolean })[],
  variantes: (Variante & { product_id: string })[],
  existencia: Map<string, number>,
): ProductoInfluencer[] {
  const porProducto = new Map<string, (Variante & { product_id: string })[]>();
  for (const v of variantes) {
    const l = porProducto.get(v.product_id) ?? [];
    l.push(v);
    porProducto.set(v.product_id, l);
  }
  const salida: ProductoInfluencer[] = [];
  for (const p of productos) {
    const colores = new Map<string, { tallas: Set<string>; conStock: Set<string>; imagen: string | null }>();
    const precios: number[] = [];
    let pares = 0;
    for (const v of porProducto.get(p.product_id) ?? []) {
      const nombre = (v.color ?? "").trim() || "Único";
      const talla = (v.talla ?? "").trim() || "Única";
      const c = colores.get(nombre) ?? { tallas: new Set<string>(), conStock: new Set<string>(), imagen: null };
      c.tallas.add(talla);
      const hay = v.sku_interno ? Math.max(0, existencia.get(v.sku_interno) ?? 0) : 0;
      if (hay > 0) c.conStock.add(talla);
      pares += hay;
      if (!c.imagen && v.imagen) c.imagen = v.imagen;
      if (v.precio != null && Number(v.precio) > 0) precios.push(Number(v.precio));
      colores.set(nombre, c);
    }
    if (!colores.size) continue;
    const lista: ColorInfluencer[] = [...colores]
      .map(([color, c]) => {
        const deAmazon = p.fotos_amazon?.[color] ?? [];
        const fotos = deAmazon.length ? deAmazon : [...(c.imagen ? [c.imagen] : []), ...p.imagenes.filter((u) => u !== c.imagen)];
        return {
          color,
          fotos: fotos.slice(0, 8),
          tallas: [...c.tallas].sort(compararTallas),
          tallasConStock: [...c.conStock].sort(compararTallas),
        };
      })
      .sort((a, b) => Number(b.tallasConStock.length > 0) - Number(a.tallasConStock.length > 0) || a.color.localeCompare(b.color, "es"));
    salida.push({
      productId: p.product_id,
      modelo: p.modelo,
      titulo: p.titulo,
      categoria: p.categoria ?? null,
      activo: p.activo,
      precioDesde: precios.length ? Math.min(...precios) : null,
      precioHasta: precios.length ? Math.max(...precios) : null,
      bullets: (p.bullets ?? []).slice(0, 4),
      colores: lista,
      pares,
    });
  }
  // Activos primero; dentro, por modelo en orden natural (GT102 antes de GT134).
  return salida.sort(
    (a, b) => Number(b.activo) - Number(a.activo) || String(a.modelo ?? a.titulo).localeCompare(String(b.modelo ?? b.titulo), "es", { numeric: true }),
  );
}

export interface Eleccion {
  productId: string;
  modelo: string | null;
  titulo: string;
  color: string;
  talla: string | null;
}

/** El mensaje que el influencer manda por WhatsApp (o copia) con lo que eligió. */
export function mensajeDeSeleccion(quien: string, elecciones: Eleccion[], urlCatalogo: string): string {
  const renglones = elecciones.map(
    (e, i) => `${i + 1}. ${e.modelo ? `${e.modelo} · ` : ""}${e.titulo} — color ${e.color}${e.talla ? `, talla ${e.talla}` : ""}`,
  );
  return [
    `Hola GETAC, soy ${quien.trim() || "(tu nombre / usuario de TikTok)"}.`,
    `Me interesan estos productos para promocionar:`,
    ...renglones,
    "",
    `Catálogo: ${urlCatalogo}`,
  ].join("\n");
}
