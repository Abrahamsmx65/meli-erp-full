/**
 * Contenido de la marca en Amazon: qué modelos hay que trabajar.
 *
 * La lista NO se guarda en ningún lado: se arma en cada visita desde el
 * catálogo de Amazon (`amazon_listings`) recortada al rango que el negocio
 * trabaja hoy — del GT054 al GT300, más MY2307 y G650. Lo viejo y lo nuevo
 * quedan fuera a propósito; lo que sobre dentro del rango se oculta desde la
 * pantalla (`amazon_contenido.eliminado`), nunca borrando el catálogo.
 *
 * Un modelo tiene un ASIN POR TALLA Y COLOR (Amazon numera cada hijo), así
 * que aquí se agrupa dos veces: por modelo para la lista, y por color dentro
 * del modelo, que es el nivel en el que las imágenes y el contenido A+ son
 * los mismos.
 *
 * Mientras el catálogo no se haya refrescado ni una vez, se cae a
 * `amazon_skus` (lo que ya vendió alguna vez) para que la pantalla sirva
 * desde el primer día.
 *
 * Este módulo no escribe nada.
 */
import { traerTodo, type DB } from "../datos/repos";
import { conCacheApp } from "./cache-app";
import { claveGrupoFba, desglosarAmazon } from "./fba";

/**
 * Del GT054 para arriba, sin tope: lo que se publique mañana (GT301, GT450…)
 * entra solo, marcado como nuevo. Lo viejo (GT053 para abajo) se queda fuera,
 * y lo que sobre se quita a mano desde la pantalla.
 */
export const GT_MIN = 54;

/** Los que no son GT y sí van en la lista. */
export const MODELOS_EXTRA = new Set(["MY2307", "G650"]);

/** GT + dos a cuatro dígitos + una letra opcional de variante (GT148G). */
const RE_GT = /^GT(\d{2,4})[A-Z]?$/;

/** Dominio de Amazon por país de la cuenta, para armar el link al producto. */
const DOMINIOS: Record<string, string> = {
  MX: "www.amazon.com.mx",
  US: "www.amazon.com",
  CA: "www.amazon.ca",
  BR: "www.amazon.com.br",
  ES: "www.amazon.es",
};

export function dominioAmazon(pais: string | null | undefined): string {
  return DOMINIOS[(pais ?? "MX").trim().toUpperCase()] ?? DOMINIOS.MX;
}

/** ¿Este modelo entra a la lista de contenido? */
export function enRangoContenido(modelo: string): boolean {
  const m = (modelo ?? "").trim().toUpperCase();
  if (MODELOS_EXTRA.has(m)) return true;
  const g = RE_GT.exec(m);
  if (!g) return false;
  return Number(g[1]) >= GT_MIN;
}

/** El modelo de un SKU de Amazon, entendiendo el orden invertido. */
export function modeloDeSku(sku: string): string {
  return (desglosarAmazon(sku).modelo ?? sku).trim().toUpperCase();
}

/**
 * Link al producto. Solo tenemos ASINs HIJOS (uno por talla y color): Amazon
 * redirige /dp/{hijo} a la página de variaciones con esa variante puesta, así
 * que sirve — pero el hijo tiene que estar ACTIVO o la página sale "no
 * disponible".
 */
export function urlAmazon(asin: string | null, pais: string | null): string | null {
  return asin ? `https://${dominioAmazon(pais)}/dp/${asin}` : null;
}

/** Un renglón de catálogo, venga de amazon_listings o de amazon_skus. */
export interface FilaCatalogo {
  sellerSku: string;
  asin: string | null;
  titulo: string | null;
  /** Active | Inactive | Incomplete | null */
  estado: string | null;
  imagenUrl: string | null;
}

export interface ColorModelo {
  /** El código de bodega al que pertenece (en un grupo hay varios). */
  modelo: string;
  /** Tal como lo escribió Amazon: "BLK", "DK BROWN", "BLK/RED". */
  color: string;
  asin: string | null;
  url: string | null;
  imagenUrl: string | null;
  skus: number;
  activos: number;
}

export interface ModeloContenido {
  /** El primer código del grupo: es la llave del renglón. */
  modelo: string;
  /**
   * TODOS los códigos de bodega que viven en la misma publicación padre
   * (GT117…GT122 pueden ser un solo listado en Amazon). Con uno solo, el
   * renglón es ese modelo a secas.
   */
  codigos: string[];
  titulo: string | null;
  /** El ASIN al que apunta el link: el PADRE cuando ya se resolvió. */
  asin: string | null;
  url: string | null;
  skus: number;
  activos: number;
  activo: boolean;
  colores: ColorModelo[];
  /** La foto principal, para la miniatura del renglón. */
  imagenUrl: string | null;
  /** Todavía no se le ha anotado nada: llegó desde la última vez. */
  nuevo: boolean;
  categoria: string | null;
  prioridad: number;
  imagenes: boolean;
  aplus: boolean;
  notas: string;
  eliminado: boolean;
}

export interface CategoriaStore {
  nombre: string;
  creada: boolean;
  imagenes: boolean;
  paginaStore: boolean;
  notas: string;
  /** Cuántos modelos vivos la tienen asignada. */
  modelos: number;
}

export interface TotalesContenido {
  modelos: number;
  activos: number;
  inactivos: number;
  conImagenes: number;
  conAplus: number;
  sinCategoria: number;
  nuevos: number;
  eliminados: number;
}

/** Lo que sabemos del padre de un ASIN hijo. */
export interface Padre {
  parentAsin: string | null;
  titulo: string | null;
  /** La foto MAIN del padre: la miniatura del renglón. */
  imagenUrl: string | null;
}

export interface ContenidoAmazon {
  modelos: ModeloContenido[];
  categorias: CategoriaStore[];
  totales: TotalesContenido;
  /** true si todavía no se aplicó la migración 0032. */
  faltaMigracion: boolean;
  /** true si el catálogo nunca se ha traído: los datos salen de las ventas. */
  sinRefrescar: boolean;
}

export interface AnotacionModelo {
  modelo: string;
  categoria: string | null;
  prioridad: number;
  imagenes: boolean;
  aplus: boolean;
  notas: string;
  eliminado: boolean;
}

/** Una talla dentro de un color, para elegir el ASIN representativo. */
interface Talla {
  asin: string | null;
  talla: number;
  sellerSku: string;
  activo: boolean;
}

/** Las tallas ordenadas: primero las activas, luego de la más chica a la más grande. */
function mejor(tallas: Talla[]): Talla | null {
  const orden = [...tallas].sort(
    (a, b) =>
      Number(b.activo) - Number(a.activo) ||
      a.talla - b.talla ||
      a.sellerSku.localeCompare(b.sellerSku),
  );
  return orden.find((t) => t.asin) ?? orden[0] ?? null;
}

/**
 * Arma la lista a partir de las piezas ya leídas. Separado de la lectura para
 * poder probarlo sin base de datos.
 */
export function armarContenido(
  filas: FilaCatalogo[],
  anotaciones: AnotacionModelo[],
  categorias: Omit<CategoriaStore, "modelos">[],
  pais: string | null,
  opciones: { verEliminados?: boolean; padres?: Map<string, Padre> } = {},
): Omit<ContenidoAmazon, "faltaMigracion" | "sinRefrescar"> {
  const padres = opciones.padres ?? new Map<string, Padre>();
  interface Color {
    color: string;
    imagenUrl: string | null;
    skus: number;
    activos: number;
    tallas: Talla[];
  }
  interface Acumulado {
    titulo: string | null;
    skus: number;
    activos: number;
    colores: Map<string, Color>;
  }
  const porModelo = new Map<string, Acumulado>();

  for (const f of filas) {
    const sku = (f.sellerSku ?? "").trim();
    if (!sku) continue;
    const d = desglosarAmazon(sku);
    const modelo = (d.modelo ?? sku).trim().toUpperCase();
    if (!enRangoContenido(modelo)) continue;

    const activo = f.estado === "Active";
    const m =
      porModelo.get(modelo) ??
      ({ titulo: null, skus: 0, activos: 0, colores: new Map<string, Color>() } as Acumulado);
    m.skus += 1;
    if (activo) m.activos += 1;
    // El título más largo es el que trae la descripción completa; los cortos
    // vienen recortados por Amazon.
    if (f.titulo && (!m.titulo || f.titulo.length > m.titulo.length)) m.titulo = f.titulo;

    const color = (d.color ?? "").trim().toUpperCase() || "ÚNICO";
    // BLK/RED, BLK-RED y BLK RED son un solo color escrito por tres manos.
    const clave = claveGrupoFba(modelo, color);
    const c =
      m.colores.get(clave) ??
      ({ color, imagenUrl: null, skus: 0, activos: 0, tallas: [] } as Color);
    c.skus += 1;
    if (activo) c.activos += 1;
    if (f.imagenUrl && !c.imagenUrl) c.imagenUrl = f.imagenUrl;
    const talla = Number(d.talla);
    c.tallas.push({
      asin: f.asin,
      // Las tallas que no son número van al final, no al principio.
      talla: Number.isFinite(talla) ? talla : 999,
      sellerSku: sku,
      activo,
    });
    m.colores.set(clave, c);
    porModelo.set(modelo, m);
  }

  const anotado = new Map(anotaciones.map((a) => [a.modelo.trim().toUpperCase(), a]));
  const usoCategoria = new Map<string, number>();

  // Primero cada código de bodega por separado, con su padre elegido…
  interface Codigo {
    modelo: string;
    titulo: string | null;
    tituloPadre: string | null;
    padre: string | null;
    colores: ColorModelo[];
    skus: number;
    activos: number;
  }

  const codigos: Codigo[] = [...porModelo.entries()].map(([modelo, m]) => {
    const colores: ColorModelo[] = [...m.colores.values()]
      .map((c) => {
        const t = mejor(c.tallas);
        return {
          modelo,
          color: c.color,
          asin: t?.asin ?? null,
          url: urlAmazon(t?.asin ?? null, pais),
          imagenUrl: c.imagenUrl,
          skus: c.skus,
          activos: c.activos,
        };
      })
      .sort((x, y) => x.color.localeCompare(y.color, "es"));

    // El padre lo eligen los colores por mayoría: casi siempre es uno solo.
    const votos = new Map<string, number>();
    for (const c of colores) {
      const p = c.asin ? padres.get(c.asin)?.parentAsin : null;
      if (p) votos.set(p, (votos.get(p) ?? 0) + 1);
    }
    const padre =
      [...votos.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    const tituloPadre = padre
      ? (colores.map((c) => (c.asin ? padres.get(c.asin) : null)).find((p) => p?.parentAsin === padre)
          ?.titulo ?? null)
      : null;

    return { modelo, titulo: m.titulo, tituloPadre, padre, colores, skus: m.skus, activos: m.activos };
  });

  // …y luego los códigos que viven en la MISMA publicación padre se fusionan
  // en un renglón: GT117…GT122 pueden ser un solo listado en Amazon, y para
  // quien trabaja el contenido son UNA página, no seis. Sin padre resuelto,
  // cada código es su propio renglón.
  const grupos = new Map<string, Codigo[]>();
  for (const c of codigos) {
    const llave = c.padre ?? `~solo~${c.modelo}`;
    grupos.set(llave, [...(grupos.get(llave) ?? []), c]);
  }

  const todos: ModeloContenido[] = [...grupos.values()].map((miembros) => {
    miembros.sort((a, b) => a.modelo.localeCompare(b.modelo, "es", { numeric: true }));
    const lider = miembros[0];
    const claves = miembros.map((m) => m.modelo);

    const colores = miembros
      .flatMap((m) => m.colores)
      .sort(
        (x, y) =>
          x.modelo.localeCompare(y.modelo, "es", { numeric: true }) ||
          x.color.localeCompare(y.color, "es"),
      );

    // Las anotaciones de todos los miembros, fusionadas: lo palomeado en
    // cualquiera vale para el grupo (el A+ es de la publicación, no del
    // código), y al guardar se escribe en todos para que no haya desacuerdo.
    const anots = claves
      .map((c) => anotado.get(c))
      .filter((a): a is AnotacionModelo => a !== undefined);
    const categoria = anots.map((a) => a.categoria).find((c) => c) ?? null;
    const notas = anots.map((a) => a.notas).find((n) => n !== "") ?? "";
    const eliminado = anots.some((a) => a.eliminado);
    if (categoria && !eliminado) {
      usoCategoria.set(categoria, (usoCategoria.get(categoria) ?? 0) + 1);
    }

    const representativo =
      [...colores].sort((a, b) => b.activos - a.activos || a.color.localeCompare(b.color, "es"))[0] ??
      null;
    const asin = lider.padre ?? representativo?.asin ?? null;
    const activos = miembros.reduce((s, m) => s + m.activos, 0);

    return {
      modelo: lider.modelo,
      codigos: claves,
      // El título del padre viene limpio; el del hijo trae color y talla.
      titulo: miembros.map((m) => m.tituloPadre).find(Boolean) ??
        miembros.map((m) => m.titulo).find(Boolean) ?? null,
      asin,
      url: urlAmazon(asin, pais),
      skus: miembros.reduce((s, m) => s + m.skus, 0),
      activos,
      activo: activos > 0,
      colores,
      imagenUrl:
        miembros
          .flatMap((m) => m.colores)
          .map((c) => (c.asin ? padres.get(c.asin)?.imagenUrl : null))
          .find(Boolean) ??
        colores.map((c) => c.imagenUrl).find(Boolean) ??
        null,
      nuevo: anots.length === 0,
      categoria,
      prioridad: Math.max(0, ...anots.map((a) => a.prioridad)),
      imagenes: anots.some((a) => a.imagenes),
      aplus: anots.some((a) => a.aplus),
      notas,
      eliminado,
    };
  });

  const vivos = todos.filter((m) => !m.eliminado);
  const visibles = opciones.verEliminados ? todos : vivos;

  // Primero lo que trae prioridad puesta; lo demás en puro orden alfabético.
  // Los inactivos NO se van al fondo a propósito: quien trabaja la lista busca
  // por código (GT155, GT156, GT158…) y un hueco en la secuencia despista más
  // de lo que ayuda ver los activos juntos — el estado ya lo dice el chip.
  visibles.sort(
    (a, b) =>
      b.prioridad - a.prioridad || a.modelo.localeCompare(b.modelo, "es", { numeric: true }),
  );

  return {
    modelos: visibles,
    categorias: categorias
      .map((c) => ({ ...c, modelos: usoCategoria.get(c.nombre) ?? 0 }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    totales: {
      modelos: vivos.length,
      activos: vivos.filter((m) => m.activo).length,
      inactivos: vivos.filter((m) => !m.activo).length,
      conImagenes: vivos.filter((m) => m.imagenes).length,
      conAplus: vivos.filter((m) => m.aplus).length,
      sinCategoria: vivos.filter((m) => !m.categoria).length,
      nuevos: vivos.filter((m) => m.nuevo).length,
      eliminados: todos.length - vivos.length,
    },
  };
}

/** Los renglones del catálogo, con respaldo si nunca se ha refrescado. */
async function leerCatalogo(
  db: DB,
  amazonAccountId: string,
): Promise<{ filas: FilaCatalogo[]; sinRefrescar: boolean }> {
  const acotar = (q: any) => q.eq("account_id", amazonAccountId);

  const listings = await traerTodo<any>(
    db,
    "amazon_listings",
    "seller_sku, asin, titulo, estado, imagen_url",
    acotar,
  ).catch(() => [] as any[]);

  if (listings.length) {
    return {
      sinRefrescar: false,
      filas: listings.map((f) => ({
        sellerSku: String(f.seller_sku ?? ""),
        asin: f.asin ?? null,
        titulo: f.titulo ?? null,
        estado: f.estado ?? null,
        imagenUrl: f.imagen_url ?? null,
      })),
    };
  }

  // Respaldo: lo que ya vendió alguna vez. Sirve desde el primer deploy,
  // antes de que el catálogo se haya traído ni una vez.
  const skus = await traerTodo<any>(
    db,
    "amazon_skus",
    "seller_sku, asin, titulo, estado, activo",
    acotar,
  ).catch(() => [] as any[]);

  return {
    sinRefrescar: true,
    filas: skus.map((f) => ({
        sellerSku: String(f.seller_sku ?? ""),
        asin: f.asin ?? null,
        titulo: f.titulo ?? null,
        // `activo` trae default true y quedó desalineado; solo vale cuando no
        // hay estado que consultar.
        estado: f.estado ?? (f.activo === true ? "Active" : null),
        imagenUrl: null,
      })),
  };
}

/** Lee de la base y arma la pantalla. */
/**
 * El contenido masticado desde `app_cache` (30 min): el catálogo completo de
 * listings (~10 mil filas) se bajaba en cada render. Cada guardado de modelo
 * o categoría INVALIDA el caché (contenido-escribir.ts), así que lo recién
 * palomeado se ve al instante — la pantalla de edición nunca enseña viejo.
 */
export async function obtenerContenidoAmazon(
  db: DB,
  amazonAccountId: string,
  pais: string | null,
  opciones: { verEliminados?: boolean } = {},
): Promise<ContenidoAmazon> {
  const clave = `contenido:${pais ?? ""}:${opciones.verEliminados ? 1 : 0}`;
  return conCacheApp(db, amazonAccountId, clave, 30 * 60_000, () =>
    cargarContenidoAmazon(db, amazonAccountId, pais, opciones),
  );
}

export async function cargarContenidoAmazon(
  db: DB,
  amazonAccountId: string,
  pais: string | null,
  opciones: { verEliminados?: boolean } = {},
): Promise<ContenidoAmazon> {
  const [catalogo, anotaciones, categorias, padres] = await Promise.all([
    leerCatalogo(db, amazonAccountId),
    db
      .from("amazon_contenido")
      .select("modelo, categoria, prioridad, imagenes, aplus, notas, eliminado")
      .eq("account_id", amazonAccountId),
    db
      .from("amazon_categorias_store")
      .select("nombre, creada, imagenes, pagina_store, notas")
      .eq("account_id", amazonAccountId),
    leerPadres(db, amazonAccountId),
  ]);

  // Mientras la migración 0032 no esté aplicada la pantalla sirve de todos
  // modos: se ve el catálogo y no se puede palomear nada.
  const faltaMigracion = Boolean(anotaciones.error ?? categorias.error);

  const armado = armarContenido(
    catalogo.filas,
    ((anotaciones.data ?? []) as any[]).map((a) => ({
      modelo: String(a.modelo ?? ""),
      categoria: a.categoria ?? null,
      prioridad: Number(a.prioridad ?? 0),
      imagenes: a.imagenes === true,
      aplus: a.aplus === true,
      notas: a.notas ?? "",
      eliminado: a.eliminado === true,
    })),
    ((categorias.data ?? []) as any[]).map((c) => ({
      nombre: String(c.nombre ?? ""),
      creada: c.creada === true,
      imagenes: c.imagenes === true,
      paginaStore: c.pagina_store === true,
      notas: c.notas ?? "",
    })),
    pais,
    { ...opciones, padres },
  );

  return { ...armado, faltaMigracion, sinRefrescar: catalogo.sinRefrescar };
}

/**
 * El mapa hijo→padre que ya se resolvió. Si la tabla todavía no existe (falta
 * la migración 0033), la pantalla sigue sirviendo con los links a los hijos.
 */
async function leerPadres(db: DB, amazonAccountId: string): Promise<Map<string, Padre>> {
  const filas = await traerTodo<any>(
    db,
    "amazon_padres",
    "asin, parent_asin, titulo, imagen_url",
    (q) => q.eq("account_id", amazonAccountId),
  ).catch(() => [] as any[]);

  return new Map(
    filas.map((f) => [
      String(f.asin ?? ""),
      {
        parentAsin: f.parent_asin ?? null,
        titulo: f.titulo ?? null,
        imagenUrl: f.imagen_url ?? null,
      } as Padre,
    ]),
  );
}

/**
 * Un ASIN por modelo y color: los únicos cuyo padre vale la pena preguntar.
 * Las imágenes y el padre son del color, no de la talla, así que resolver los
 * cuarenta hijos de un modelo sería tirar cuota a la basura.
 */
export async function asinsRepresentativos(db: DB, amazonAccountId: string): Promise<string[]> {
  const catalogo = await leerCatalogo(db, amazonAccountId);
  const armado = armarContenido(catalogo.filas, [], [], null, { verEliminados: true });
  const asins = new Set<string>();
  for (const m of armado.modelos) {
    for (const c of m.colores) if (c.asin) asins.add(c.asin);
  }
  return [...asins];
}

/**
 * El grupo (publicación padre) al que pertenece un modelo, con los colores de
 * TODOS sus códigos: el ZIP de imágenes baja la publicación completa, no un
 * código suelto. Un color trae un solo ASIN representativo — las imágenes son
 * del color, no de la talla, y pedirle a Amazon los cuarenta hijos sería
 * tirar cuota a la basura.
 */
export async function grupoDeModelo(
  db: DB,
  amazonAccountId: string,
  modelo: string,
  pais: string | null,
): Promise<{ codigos: string[]; colores: ColorModelo[] } | null> {
  const objetivo = modelo.trim().toUpperCase();
  if (!enRangoContenido(objetivo)) return null;

  // El grupo puede juntar códigos que no comparten prefijo (GT117 y GT118):
  // hay que armar el catálogo completo, igual que la pantalla.
  const [catalogo, padres] = await Promise.all([
    leerCatalogo(db, amazonAccountId),
    leerPadres(db, amazonAccountId),
  ]);

  const armado = armarContenido(catalogo.filas, [], [], pais, { verEliminados: true, padres });
  const fila = armado.modelos.find((m) => m.codigos.includes(objetivo));
  return fila ? { codigos: fila.codigos, colores: fila.colores } : null;
}

/** Un ASIN hijo del catálogo, con su talla y color: un renglón del Excel de ASINs. */
export interface AsinModelo {
  modelo: string;
  color: string;
  talla: string;
  sellerSku: string;
  asin: string | null;
  estado: string | null;
  /** El ASIN padre cuando ya se resolvió (migración 0033). */
  padre: string | null;
}

/**
 * TODOS los ASINs hijos de los códigos de un grupo, uno por talla y color,
 * ordenados modelo → color → talla. Es la lista que se le pega al contenido
 * A+ cuando se crea: Amazon aplica el A+ por ASIN hijo, así que aquí no se
 * recorta a un representativo por color como en las imágenes. Los SKUs sin
 * ASIN también salen (con la celda vacía) para que se vea qué falta.
 */
export function asinsDeGrupo(
  filas: FilaCatalogo[],
  codigos: string[],
  padres: Map<string, Padre> = new Map(),
): AsinModelo[] {
  const objetivo = new Set(codigos.map((c) => c.trim().toUpperCase()));
  const lista: AsinModelo[] = [];
  for (const f of filas) {
    const sku = (f.sellerSku ?? "").trim();
    if (!sku) continue;
    const d = desglosarAmazon(sku);
    const modelo = (d.modelo ?? sku).trim().toUpperCase();
    if (!objetivo.has(modelo)) continue;
    const asin = (f.asin ?? "").trim() || null;
    lista.push({
      modelo,
      color: (d.color ?? "").trim().toUpperCase() || "ÚNICO",
      talla: (d.talla ?? "").trim(),
      sellerSku: sku,
      asin,
      estado: f.estado ?? null,
      padre: asin ? (padres.get(asin)?.parentAsin ?? null) : null,
    });
  }
  const numTalla = (t: string) => {
    const n = Number(t);
    return Number.isFinite(n) && t !== "" ? n : 999;
  };
  return lista.sort(
    (a, b) =>
      a.modelo.localeCompare(b.modelo, "es", { numeric: true }) ||
      claveGrupoFba(a.modelo, a.color).localeCompare(claveGrupoFba(b.modelo, b.color), "es") ||
      numTalla(a.talla) - numTalla(b.talla) ||
      a.sellerSku.localeCompare(b.sellerSku, "es"),
  );
}

/**
 * Los ASINs de la PUBLICACIÓN completa a la que pertenece un modelo: pedir
 * GT117 trae también los de GT118…GT122 si comparten padre, igual que el ZIP
 * de fotos. `null` si el modelo no está en la lista de contenido.
 */
export async function asinsDeModelo(
  db: DB,
  amazonAccountId: string,
  modelo: string,
  pais: string | null,
): Promise<{ codigos: string[]; asins: AsinModelo[] } | null> {
  const objetivo = modelo.trim().toUpperCase();
  if (!enRangoContenido(objetivo)) return null;

  const [catalogo, padres] = await Promise.all([
    leerCatalogo(db, amazonAccountId),
    leerPadres(db, amazonAccountId),
  ]);
  const armado = armarContenido(catalogo.filas, [], [], pais, { verEliminados: true, padres });
  const fila = armado.modelos.find((m) => m.codigos.includes(objetivo));
  if (!fila) return null;
  return { codigos: fila.codigos, asins: asinsDeGrupo(catalogo.filas, fila.codigos, padres) };
}

/** "GT117" solo, o "GT117-GT122" cuando la publicación junta varios códigos. */
export function etiquetaGrupo(codigos: string[]): string {
  if (codigos.length <= 1) return codigos[0] ?? "";
  return `${codigos[0]}-${codigos[codigos.length - 1]}`;
}
