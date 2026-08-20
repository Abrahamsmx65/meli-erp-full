/**
 * Resuelve SKUs a los datos de su etiqueta (código Full, título, variante).
 *
 * Vive aparte porque lo usan tres salidas: la vista previa de la pantalla,
 * el TXT en ZPL para la impresora térmica y el PDF. Las tres tienen que
 * decir exactamente lo mismo.
 */
import { traerTodo, type DB } from "../datos/repos";
import { claveComparacion } from "../importar/sku";

export interface EtiquetaResuelta {
  sku: string;
  codigoFull: string | null;
  titulo: string | null;
  color: string | null;
  talla: string | null;
  variante: string;
  cantidad: number;
  problema: string | null;
}

function variante(color: string | null, talla: string | null): string {
  const p: string[] = [];
  if (color) p.push(color);
  if (talla) p.push(`Talla ${talla}`);
  return p.join(" · ");
}

export async function resolverEtiquetas(
  db: DB,
  accountId: string,
  pedidas: { sku?: unknown; cantidad?: unknown }[],
): Promise<EtiquetaResuelta[]> {
  // TODO el catálogo, paginado: una lectura directa corta en 1000 filas.
  const catalogo = await traerTodo<any>(
    db,
    "skus",
    "sku, inventory_id, titulo, color, talla, logistica",
    (q) => q.eq("account_id", accountId),
  );

  const exacto = new Map<string, any>();
  const flexible = new Map<string, any>();
  for (const s of catalogo ?? []) {
    exacto.set(s.sku.trim().toUpperCase(), s);
    const c = claveComparacion(s.sku);
    if (!flexible.has(c)) flexible.set(c, s);
  }

  const etiquetas: EtiquetaResuelta[] = [];
  for (const p of pedidas) {
    const sku = String(p?.sku ?? "").trim().toUpperCase();
    const cantidad = Math.max(0, Math.min(999, Math.round(Number(p?.cantidad) || 0)));
    if (!sku || cantidad <= 0) continue;

    const encontrado = exacto.get(sku) ?? flexible.get(claveComparacion(sku));
    if (!encontrado) {
      etiquetas.push({
        sku,
        codigoFull: null,
        titulo: null,
        color: null,
        talla: null,
        variante: "",
        cantidad,
        problema: "Este SKU no está en el catálogo de Mercado Libre.",
      });
      continue;
    }

    etiquetas.push({
      sku: encontrado.sku,
      codigoFull: encontrado.inventory_id ?? null,
      titulo: encontrado.titulo ?? null,
      color: encontrado.color ?? null,
      talla: encontrado.talla ?? null,
      variante: variante(encontrado.color, encontrado.talla),
      cantidad,
      problema: encontrado.inventory_id
        ? null
        : "Todavía no tiene código Full. Aparece cuando la publicación entra a Full; sincroniza y vuelve a intentar.",
    });
  }
  return etiquetas;
}
