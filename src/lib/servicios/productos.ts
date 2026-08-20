/**
 * Catálogo de productos a nivel MODELO: categoría y costo.
 *
 * Ninguno de los dos existe en MELI. La categoría (corcho, EVA, pantufla…)
 * es como el negocio agrupa; el costo es el final aterrizado en MXN por par
 * — el mismo para todos los colores y tallas del modelo (GT104-1 BLK cuesta
 * lo mismo que GT104-2 RED). Aplica igual para Mercado Libre y Amazon.
 *
 * En la base se guarda en productos_config con color = '' (el nivel modelo);
 * si algún día un color necesitara costo propio, su fila con color puesto
 * le gana a la del modelo.
 */
import { traerTodo, type DB } from "../datos/repos";

export interface ProductoConfig {
  modelo: string;
  titulo: string | null;
  colores: number;
  tallas: number;
  categoria: string | null;
  costoMxn: number | null;
}

export interface CatalogoProductos {
  productos: ProductoConfig[];
  categorias: string[];
  /** true si la tabla productos_config todavía no existe en la base */
  faltaMigracion: boolean;
}

export interface ConfigProducto {
  categoria: string | null;
  costo: number | null;
}

export async function cargarProductos(db: DB, accountId: string): Promise<CatalogoProductos> {
  const skus = await traerTodo<any>(db, "skus", "sku, modelo, color, titulo", (q) =>
    q.eq("account_id", accountId).eq("activo", true),
  );

  const porModelo = new Map<
    string,
    { titulo: string | null; colores: Set<string>; tallas: number }
  >();
  for (const s of skus) {
    const modelo = s.modelo ?? s.sku.split("-")[0] ?? "";
    if (!modelo) continue;
    const p = porModelo.get(modelo) ?? { titulo: null, colores: new Set<string>(), tallas: 0 };
    p.tallas += 1;
    if (s.color) p.colores.add(s.color);
    if (!p.titulo && s.titulo) p.titulo = s.titulo;
    porModelo.set(modelo, p);
  }

  const { config, faltaMigracion } = await leerConfig(db, accountId);

  const productos: ProductoConfig[] = [...porModelo.entries()]
    .map(([modelo, p]) => {
      const c = config.get(modelo);
      return {
        modelo,
        titulo: p.titulo,
        colores: p.colores.size,
        tallas: p.tallas,
        categoria: c?.categoria ?? null,
        costoMxn: c?.costo ?? null,
      };
    })
    .sort((a, b) => a.modelo.localeCompare(b.modelo));

  const categorias = [...new Set(productos.map((p) => p.categoria).filter(Boolean))] as string[];
  categorias.sort();

  return { productos, categorias, faltaMigracion };
}

/** Mapa modelo → {categoria, costo}, para calcular la ganancia. */
export async function configPorProducto(
  db: DB,
  accountId: string,
): Promise<Map<string, ConfigProducto>> {
  const { config } = await leerConfig(db, accountId);
  return config;
}

async function leerConfig(
  db: DB,
  accountId: string,
): Promise<{ config: Map<string, ConfigProducto>; faltaMigracion: boolean }> {
  const { data, error } = await db
    .from("productos_config")
    .select("modelo, color, categoria, costo_mxn")
    .eq("account_id", accountId);
  if (error) return { config: new Map(), faltaMigracion: true };

  const config = new Map<string, ConfigProducto>();
  // Primero las filas de nivel modelo (color vacío); una fila con color
  // puesto solo pisa al modelo si no hay nada más específico que hacer.
  const filas = (data ?? []).sort((a: any, b: any) =>
    (a.color ?? "") === "" ? -1 : (b.color ?? "") === "" ? 1 : 0,
  );
  for (const c of filas) {
    if (config.has(c.modelo) && (c.color ?? "") !== "") continue;
    config.set(c.modelo, {
      categoria: c.categoria ?? null,
      costo: c.costo_mxn == null ? null : Number(c.costo_mxn),
    });
  }
  return { config, faltaMigracion: false };
}
