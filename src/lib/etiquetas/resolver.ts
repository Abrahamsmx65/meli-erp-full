/**
 * Resuelve SKUs a los datos de su etiqueta (código Full, título, variante).
 *
 * Vive aparte porque lo usan tres salidas: la vista previa de la pantalla,
 * el TXT en ZPL para la impresora térmica y el PDF. Las tres tienen que
 * decir exactamente lo mismo.
 */
import { traerTodo, type DB } from "../datos/repos";
import { claveAplastada, claveComparacion, construirSkuMeli } from "../importar/sku";

export interface EtiquetaResuelta {
  sku: string;
  codigoFull: string | null;
  /** FNSKU de Amazon, si el mismo producto también se vende por FBA. */
  fnsku: string | null;
  /** El SKU tal como está dado de alta en Amazon (puede variar el orden). */
  skuAmazon: string | null;
  /** El título de la publicación de Amazon, que no es el de MELI. */
  tituloAmazon: string | null;
  titulo: string | null;
  color: string | null;
  talla: string | null;
  variante: string;
  cantidad: number;
  problema: string | null;
}

export interface DatoAmazon {
  fnsku: string;
  sku: string;
  titulo: string | null;
}

/**
 * Clave para amarrar el SKU de MELI con el de Amazon. No basta la clave
 * canónica: en Amazon algunos SKUs traen las mismas piezas en OTRO orden
 * ("GT125-25-BLK-MX" con la talla antes del color). Ordenar los pedazos
 * alfabéticamente hace que los dos órdenes caigan en la misma clave, y como
 * modelo, color y talla tienen que coincidir de todas formas, el riesgo de
 * un falso positivo es mínimo.
 */
export function claveOrdenada(s: string): string {
  return claveComparacion(s).split("-").sort().join("-");
}

/**
 * Los datos de Amazon por clave de SKU: FNSKU (del inventario FBA), el SKU
 * real de Amazon y su título (del catálogo de reportes). Cada clave entra
 * dos veces: canónica y con los pedazos ordenados. Si Amazon no está
 * conectado o las tablas están vacías, el mapa sale vacío y las etiquetas
 * de Amazon simplemente no están disponibles.
 */
export async function mapaAmazon(db: DB): Promise<Map<string, DatoAmazon>> {
  try {
    const [inventario, catalogo] = await Promise.all([
      traerTodo<{ seller_sku: string; fnsku: string | null }>(
        db,
        "amazon_inventario",
        "seller_sku, fnsku",
        (q) => q,
      ),
      traerTodo<{ seller_sku: string; fnsku: string | null; titulo: string | null }>(
        db,
        "amazon_skus",
        "seller_sku, fnsku, titulo",
        (q) => q,
      ).catch(() => [] as { seller_sku: string; fnsku: string | null; titulo: string | null }[]),
    ]);

    const titulos = new Map<string, string>();
    for (const f of catalogo ?? []) {
      if (f.titulo && !titulos.has(f.seller_sku)) titulos.set(f.seller_sku, f.titulo);
    }

    const mapa = new Map<string, DatoAmazon>();
    const anotar = (clave: string, dato: DatoAmazon) => {
      if (!mapa.has(clave)) mapa.set(clave, dato);
    };
    const registrar = (sku: string, fnsku: string | null) => {
      if (!fnsku) return;
      const dato: DatoAmazon = { fnsku, sku, titulo: titulos.get(sku) ?? null };
      anotar(claveComparacion(sku), dato);
      anotar(claveOrdenada(sku), dato);
    };
    for (const f of inventario ?? []) registrar(f.seller_sku, f.fnsku);
    for (const f of catalogo ?? []) registrar(f.seller_sku, f.fnsku);
    return mapa;
  } catch {
    return new Map();
  }
}

/** Busca el dato de Amazon de un SKU de MELI, con las dos claves. */
export function buscarAmazon(
  mapa: Map<string, DatoAmazon>,
  sku: string,
): DatoAmazon | null {
  return mapa.get(claveComparacion(sku)) ?? mapa.get(claveOrdenada(sku)) ?? null;
}

/* ---- Amarre de variantes de pedido (modelo + color + talla) -------------- */

export interface IndiceCatalogo {
  exacto: Map<string, any>;
  canonico: Map<string, any>;
  aplastado: Map<string, any>;
  ordenado: Map<string, any>;
}

/** Indexa el catálogo de MELI con los cuatro amarres. */
export function indexarCatalogo(catalogo: { sku: string }[]): IndiceCatalogo {
  const ix: IndiceCatalogo = {
    exacto: new Map(),
    canonico: new Map(),
    aplastado: new Map(),
    ordenado: new Map(),
  };
  for (const s of catalogo ?? []) {
    ix.exacto.set(s.sku.trim().toUpperCase(), s);
    const c = claveComparacion(s.sku);
    if (!ix.canonico.has(c)) ix.canonico.set(c, s);
    const a = claveAplastada(s.sku);
    if (!ix.aplastado.has(a)) ix.aplastado.set(a, s);
    const o = claveOrdenada(s.sku);
    if (!ix.ordenado.has(o)) ix.ordenado.set(o, s);
  }
  return ix;
}

/**
 * El color de la proforma a veces trae anotaciones que el SKU de MELI no
 * tiene: "BLK  (NEGRO)". Para amarrar y para nombres se usa sin paréntesis.
 */
export function sinAnotacion(color: string): string {
  const limpio = color.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  return limpio || color;
}

/**
 * Busca la variante de un pedido (modelo + color de proforma + talla) en el
 * catálogo de MELI: prueba el color tal cual y sin su anotación, con los
 * cuatro amarres (exacto, canónico, aplastado y con los pedazos ordenados).
 */
export function buscarVariante(
  ix: IndiceCatalogo,
  modelo: string,
  color: string,
  talla: string,
): { construido: string; encontrado: any | null } {
  const colores = [...new Set([color, sinAnotacion(color)])];
  for (const c of colores) {
    const construido = construirSkuMeli(modelo, c, talla);
    const dado =
      ix.exacto.get(construido) ??
      ix.canonico.get(claveComparacion(construido)) ??
      ix.aplastado.get(claveAplastada(construido)) ??
      ix.ordenado.get(claveOrdenada(construido));
    if (dado) return { construido, encontrado: dado };
  }
  return {
    construido: construirSkuMeli(modelo, colores[colores.length - 1], talla),
    encontrado: null,
  };
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
  const [catalogo, fnskus] = await Promise.all([
    traerTodo<any>(
      db,
      "skus",
      "sku, inventory_id, titulo, color, talla, logistica",
      (q) => q.eq("account_id", accountId),
    ),
    mapaAmazon(db),
  ]);

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
      // Producto solo-de-Amazon (las fundas: SKUs que empiezan con número y
      // no existen en MELI). Si el listado FBA lo conoce, su etiqueta de
      // Amazon sale completa y NO es un problema; solo no habrá lado MELI.
      const amazonSuelto = buscarAmazon(fnskus, sku);
      etiquetas.push({
        sku,
        codigoFull: null,
        fnsku: amazonSuelto?.fnsku ?? null,
        skuAmazon: amazonSuelto?.sku ?? null,
        tituloAmazon: amazonSuelto?.titulo ?? null,
        titulo: amazonSuelto?.titulo ?? null,
        color: null,
        talla: null,
        variante: "",
        cantidad,
        problema: amazonSuelto
          ? null
          : "Este SKU no está ni en el catálogo de Mercado Libre ni en el de Amazon.",
      });
      continue;
    }

    const amazon = buscarAmazon(fnskus, encontrado.sku);
    etiquetas.push({
      sku: encontrado.sku,
      codigoFull: encontrado.inventory_id ?? null,
      fnsku: amazon?.fnsku ?? null,
      skuAmazon: amazon?.sku ?? null,
      tituloAmazon: amazon?.titulo ?? null,
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
