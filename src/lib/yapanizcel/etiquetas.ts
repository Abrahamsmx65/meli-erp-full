/**
 * Etiquetas de Mercado Envíos Full para las FUNDAS (cuenta de YAPANIZCEL).
 *
 * Es la misma etiqueta que la del calzado —barras del código Full, el
 * código en negritas, título en dos líneas, variante y "SKU: …"— y sale por
 * los MISMOS generadores (`etiquetas/pdf.ts`, `etiquetas/zpl.ts`), pero el
 * catálogo es otro: `yz_skus`, de la otra cuenta de MELI. Aquí no hay
 * Amazon ni FNSKU: solo el lado de Mercado Libre, por decisión del dueño.
 *
 * La variante que se imprime sale del SKU (`desglosar`): el modelo del
 * celular y, si lo trae, el color. Es lo que el catálogo guarda en
 * `yz_skus.modelo` y `yz_skus.color`.
 */
import type { DB } from "../datos/repos";
import type { DatosEtiqueta } from "../etiquetas/zpl";
import { todo } from "./db";
import { claveAplastada, claveCanonica } from "./sku";

export interface FilaCatalogoYz {
  sku: string;
  inventory_id: string | null;
  titulo: string | null;
  modelo: string | null;
  color: string | null;
}

export interface EtiquetaYz {
  sku: string;
  codigoFull: string | null;
  /** Siempre null: las fundas no llevan etiqueta de Amazon desde aquí. */
  fnsku: null;
  titulo: string | null;
  variante: string;
  cantidad: number;
  problema: string | null;
}

/** "IP15PM - BLUE": modelo del celular y color, como los guarda el catálogo. */
export function varianteFunda(modelo: string | null, color: string | null): string {
  const p: string[] = [];
  if (modelo) p.push(modelo.trim());
  if (color) p.push(color.trim());
  return p.filter(Boolean).join(" - ");
}

/**
 * Amarra lo pedido contra el catálogo: exacto → canónico → aplastado, los
 * mismos niveles SEGUROS del amarre de bodega (`yapanizcel/sku.ts`). Un
 * SKU tecleado con o sin `-MX`, con guiones de más o con minúsculas
 * encuentra su publicación igual.
 */
export function armarEtiquetasYz(
  catalogo: FilaCatalogoYz[],
  pedidas: { sku?: unknown; cantidad?: unknown }[],
): EtiquetaYz[] {
  const exacto = new Map<string, FilaCatalogoYz>();
  const canonico = new Map<string, FilaCatalogoYz>();
  const aplastado = new Map<string, FilaCatalogoYz>();
  for (const s of catalogo) {
    if (!s.sku) continue;
    exacto.set(s.sku.trim().toUpperCase(), s);
    const c = claveCanonica(s.sku);
    if (!canonico.has(c)) canonico.set(c, s);
    const a = claveAplastada(s.sku);
    if (!aplastado.has(a)) aplastado.set(a, s);
  }

  const etiquetas: EtiquetaYz[] = [];
  for (const p of pedidas) {
    const sku = String(p?.sku ?? "").trim().toUpperCase();
    const cantidad = Math.max(0, Math.min(999, Math.round(Number(p?.cantidad) || 0)));
    if (!sku || cantidad <= 0) continue;

    const dado =
      exacto.get(sku) ?? canonico.get(claveCanonica(sku)) ?? aplastado.get(claveAplastada(sku));
    if (!dado) {
      etiquetas.push({
        sku,
        codigoFull: null,
        fnsku: null,
        titulo: null,
        variante: "",
        cantidad,
        problema: "Este SKU no está en el catálogo de Mercado Libre de YAPANIZCEL.",
      });
      continue;
    }

    etiquetas.push({
      sku: dado.sku,
      codigoFull: dado.inventory_id ?? null,
      fnsku: null,
      titulo: dado.titulo ?? null,
      variante: varianteFunda(dado.modelo, dado.color),
      cantidad,
      problema: dado.inventory_id
        ? null
        : "Todavía no tiene código Full. Aparece cuando la publicación entra a Full; sincroniza fundas y vuelve a intentar.",
    });
  }
  return etiquetas;
}

/** Lo que va impreso, en la forma que entienden el PDF y el ZPL de MELI. */
export function datosDeEtiquetaYz(e: EtiquetaYz): DatosEtiqueta {
  return {
    codigo: e.codigoFull ?? "",
    titulo: (e.titulo ?? e.sku).slice(0, 60),
    variante: e.variante,
    pie: `SKU: ${e.sku}`,
    cantidad: e.cantidad,
  };
}

/** Resuelve contra el catálogo completo de la cuenta (paginado: pasa de 1000). */
export async function resolverEtiquetasYz(
  db: DB,
  accountId: string,
  pedidas: { sku?: unknown; cantidad?: unknown }[],
): Promise<EtiquetaYz[]> {
  const catalogo = await todo<FilaCatalogoYz>(
    db,
    "yz_skus",
    "sku, inventory_id, titulo, modelo, color",
    (q) => q.eq("account_id", accountId),
  );
  return armarEtiquetasYz(catalogo, pedidas);
}
