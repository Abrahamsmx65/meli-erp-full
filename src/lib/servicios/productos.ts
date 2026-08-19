/**
 * Catálogo de productos a nivel modelo + color: categoría y costo.
 *
 * Ninguno de los dos existe en MELI. La categoría (corcho, EVA, pantufla…)
 * es como el negocio agrupa; el costo es el final aterrizado en MXN por par
 * —igual para todas las tallas del mismo color— y con él se calcula la
 * ganancia contra lo que MELI de verdad deposita.
 */
import { traerTodo, type DB } from "../datos/repos";

export interface ProductoConfig {
  modelo: string;
  color: string;
  titulo: string | null;
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

export async function cargarProductos(db: DB, accountId: string): Promise<CatalogoProductos> {
  const skus = await traerTodo<any>(db, "skus", "sku, modelo, color, titulo", (q) =>
    q.eq("account_id", accountId).eq("activo", true),
  );

  const porProducto = new Map<string, { modelo: string; color: string; titulo: string | null; tallas: number }>();
  for (const s of skus) {
    const modelo = s.modelo ?? s.sku.split("-")[0] ?? "";
    const color = s.color ?? "";
    const clave = `${modelo}|${color}`;
    const p = porProducto.get(clave) ?? { modelo, color, titulo: s.titulo ?? null, tallas: 0 };
    p.tallas += 1;
    if (!p.titulo && s.titulo) p.titulo = s.titulo;
    porProducto.set(clave, p);
  }

  let config = new Map<string, { categoria: string | null; costo: number | null }>();
  let faltaMigracion = false;
  const { data, error } = await db
    .from("productos_config")
    .select("modelo, color, categoria, costo_mxn")
    .eq("account_id", accountId);
  if (error) {
    // La tabla puede no existir todavía (migración 0011 pendiente).
    faltaMigracion = true;
  } else {
    config = new Map(
      (data ?? []).map((c: any) => [
        `${c.modelo}|${c.color ?? ""}`,
        { categoria: c.categoria ?? null, costo: c.costo_mxn == null ? null : Number(c.costo_mxn) },
      ]),
    );
  }

  const productos: ProductoConfig[] = [...porProducto.values()]
    .map((p) => {
      const c = config.get(`${p.modelo}|${p.color}`);
      return {
        modelo: p.modelo,
        color: p.color,
        titulo: p.titulo,
        tallas: p.tallas,
        categoria: c?.categoria ?? null,
        costoMxn: c?.costo ?? null,
      };
    })
    .sort((a, b) => a.modelo.localeCompare(b.modelo) || a.color.localeCompare(b.color));

  const categorias = [...new Set(productos.map((p) => p.categoria).filter(Boolean))] as string[];
  categorias.sort();

  return { productos, categorias, faltaMigracion };
}

/** Mapa producto (modelo|color) → {categoria, costo}, para la ganancia. */
export async function configPorProducto(
  db: DB,
  accountId: string,
): Promise<Map<string, { categoria: string | null; costo: number | null }>> {
  const { data, error } = await db
    .from("productos_config")
    .select("modelo, color, categoria, costo_mxn")
    .eq("account_id", accountId);
  if (error) return new Map();
  return new Map(
    (data ?? []).map((c: any) => [
      `${c.modelo}|${c.color ?? ""}`,
      { categoria: c.categoria ?? null, costo: c.costo_mxn == null ? null : Number(c.costo_mxn) },
    ]),
  );
}
