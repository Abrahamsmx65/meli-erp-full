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
import { conCacheYz, recalcularCacheYz } from "../yapanizcel/cache";
import { desglosar as desglosarFunda, esCalzado } from "../yapanizcel/sku";

export type Negocio = "calzado" | "fundas";

export interface ProductoConfig {
  modelo: string;
  titulo: string | null;
  colores: number;
  /** SKUs del modelo (tallas × colores en calzado; variantes en fundas) */
  tallas: number;
  categoria: string | null;
  costoMxn: number | null;
  /** de qué catálogo sale: el de calzado (MELI) o el de fundas (YAPANIZCEL) */
  negocio: Negocio;
}

export interface CatalogoProductos {
  productos: ProductoConfig[];
  categorias: string[];
  /** true si la tabla productos_config todavía no existe en la base */
  faltaMigracion: boolean;
  /**
   * Cuántos diseños de funda quedaron fuera por no tener costo capturado.
   * Se cuentan aunque no viajen: la pantalla ofrece verlos con ese número.
   */
  fundasSinCosto: number;
}

export interface ConfigProducto {
  categoria: string | null;
  costo: number | null;
}

/**
 * Los diseños de fundas de YAPANIZCEL (yz_skus), para capturarles costo en
 * el mismo lugar que al calzado. Decisión del dueño: un solo Productos y
 * costos para todo. Sin cuenta de fundas, lista vacía.
 */
type DisenosFundas = Map<string, { titulo: string | null; colores: Set<string>; tallas: number }>;

async function calcularDisenosFundas(db: DB, accountId: string): Promise<DisenosFundas> {
  const salida: DisenosFundas = new Map();
  const skus = await traerTodo<{ sku: string; titulo: string | null }>(db, "yz_skus", "sku, titulo", (q) => q.eq("account_id", accountId));
  for (const s of skus) {
    const d = desglosarFunda(s.sku);
    const diseno = d.diseno.toUpperCase();
    // Sin diseño numérico no es una funda; el calzado que vive en esa
    // cuenta ya está listado por su propio catálogo.
    if (!diseno || esCalzado(diseno)) continue;
    const p = salida.get(diseno) ?? { titulo: null, colores: new Set<string>(), tallas: 0 };
    p.tallas += 1;
    if (d.color) p.colores.add(d.color);
    if (!p.titulo && s.titulo) p.titulo = s.titulo;
    salida.set(diseno, p);
  }
  return salida;
}

/** Recalcula y guarda los diseños masticados (lo llama el cron de netos). */
export async function recalcularDisenosFundas(db: DB, accountId: string): Promise<DisenosFundas> {
  return recalcularCacheYz(db, accountId, "disenos", () => calcularDisenosFundas(db, accountId));
}

async function disenosDeFundas(db: DB): Promise<DisenosFundas> {
  try {
    const { data: cuenta } = await db.from("yz_cuentas").select("id").order("creado_en", { ascending: true }).limit(1).maybeSingle();
    if (!cuenta?.id) return new Map();

    // Masticado en yz_cache ("disenos"): armar esto baja el catálogo de
    // fundas COMPLETO (~18 mil variantes en 15 páginas) y se estaba pagando
    // en cada render de Productos y costos. Lo invalida la sincronización
    // del catálogo de fundas; se sirve aunque esté viejo (el cron refresca).
    return await conCacheYz(db, cuenta.id, "disenos", () => calcularDisenosFundas(db, cuenta.id));
  } catch {
    // Sin tablas de fundas (otra base) no pasa nada: solo calzado.
    return new Map();
  }
}

/**
 * El catálogo de Productos y costos.
 *
 * Por omisión NO se mandan los diseños de funda sin costo capturado: son
 * cientos, llegaron de rebote del catálogo de YAPANIZCEL y llenaban la
 * pantalla de renglones vacíos que estorban para encontrar lo que sí se
 * trabaja. Se cuentan aparte (`fundasSinCosto`) y se piden con
 * `conFundasSinCosto` cuando hace falta capturar un diseño nuevo, para que
 * nunca queden inalcanzables.
 */
export async function cargarProductos(
  db: DB,
  accountId: string,
  opts?: { conFundasSinCosto?: boolean },
): Promise<CatalogoProductos> {
  const [skus, fundas, { config, faltaMigracion }] = await Promise.all([
    traerTodo<any>(db, "skus", "sku, modelo, color, titulo", (q) => q.eq("account_id", accountId).eq("activo", true)),
    disenosDeFundas(db),
    leerConfig(db, accountId),
  ]);

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

  const armar = (modelo: string, p: { titulo: string | null; colores: Set<string>; tallas: number }, negocio: Negocio): ProductoConfig => {
    const c = config.get(modelo) ?? config.get(modelo.toUpperCase());
    return {
      modelo,
      titulo: p.titulo,
      colores: p.colores.size,
      tallas: p.tallas,
      categoria: c?.categoria ?? null,
      costoMxn: c?.costo ?? null,
      negocio,
    };
  };

  const productos: ProductoConfig[] = [
    ...[...porModelo.entries()].map(([modelo, p]) => armar(modelo, p, "calzado")),
    ...[...fundas.entries()].filter(([d]) => !porModelo.has(d)).map(([d, p]) => armar(d, p, "fundas")),
  ].sort((a, b) => a.negocio.localeCompare(b.negocio) || a.modelo.localeCompare(b.modelo, "es", { numeric: true }));

  // Las categorías de fundas que agrupan la Bodega de YAPANIZCEL (tipo →
  // diseño → SKU) se ofrecen siempre, para capturarlas de un jalón aquí.
  const base = fundas.size ? ["Fundas", "Tabletas", "Micas"] : [];
  const categorias = [...new Set([...base, ...productos.map((p) => p.categoria).filter(Boolean)])] as string[];
  categorias.sort((a, b) => a.localeCompare(b, "es"));

  // Se cuentan ANTES de filtrar: el chip de la pantalla necesita saber
  // cuántas hay escondidas.
  const fundasSinCosto = productos.filter((p) => p.negocio === "fundas" && p.costoMxn == null).length;
  const visibles = opts?.conFundasSinCosto
    ? productos
    : productos.filter((p) => p.negocio !== "fundas" || p.costoMxn != null);

  return { productos: visibles, categorias, faltaMigracion, fundasSinCosto };
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
