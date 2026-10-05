/**
 * El catálogo COMPLETO para creadores (todo el calzado de Amazon, activo o
 * inactivo, con fotos y por categoría), masticado por atrás para la tienda
 * (`tienda/` → `/catalogo`). Pedido del dueño, 5-oct-2026.
 *
 *  · De `amazon_listings` salen modelos, colores y tallas; por color se le
 *    preguntan al catálogo de Amazon hasta `ASINS_POR_COLOR` ASINs, los
 *    activos primero (`fichasDeCatalogo`: fotos, clasificación y título en
 *    una sola llamada por cada 20).
 *  · Lo que Amazon contesta se guarda por ASIN en `app_cache` clave
 *    `catalogo-amazon:asins` y se relee cada `DIAS_RELEER`: la primera vez
 *    son miles de ASINs y se avanza por lotes con el tiempo que haya; lo ya
 *    leído no se vuelve a pedir.
 *  · El resultado (`armarCatalogoAmazon`) va a `app_cache` clave
 *    `catalogo-amazon` y la tienda solo lee ese renglón.
 */
import { traerTodo } from "../datos/repos";
import { Cliente as ClienteAmazon, cuentasAmazon } from "../amazon/spapi";
import { fichasDeCatalogo } from "../amazon/catalogo";
import { agruparAmazon, armarCatalogoAmazon, type FichaGuardada } from "../tienda/catalogo-amazon";
import { configPorProducto } from "./productos";
import { guardarCacheApp, leerCacheAppGuardado } from "./cache-app";

export const CLAVE_CATALOGO_AMAZON = "catalogo-amazon";
export const CLAVE_FICHAS = "catalogo-amazon:asins";
export const DIAS_RELEER = 7;
/** ASINs por tanda antes de guardar lo avanzado (si la función muere, no se pierde). */
const TANDA = 200;

interface FichasGuardadas {
  /** asin → ficha + cuándo se leyó (ms) */
  asins: Record<string, FichaGuardada & { en: number }>;
}

export interface ResultadoCatalogoAmazon {
  modelos: number;
  productos: number;
  asinsLeidos: number;
  asinsPendientes: number;
  avisos: string[];
}

export async function refrescarCatalogoAmazon(admin: any, accountId: string, presupuestoMs: number): Promise<ResultadoCatalogoAmazon> {
  const inicio = Date.now();
  const avisos: string[] = [];
  const [listings, padres, config, guardado] = await Promise.all([
    traerTodo<any>(admin, "amazon_listings", "seller_sku, asin, estado, titulo", (q) => q.order("seller_sku", { ascending: true })),
    traerTodo<any>(admin, "amazon_padres", "asin, titulo, parent_asin", (q) => q.order("asin", { ascending: true })).catch(() => [] as any[]),
    configPorProducto(admin, accountId).catch(() => new Map()),
    leerCacheAppGuardado<FichasGuardadas>(admin, accountId, CLAVE_FICHAS).catch(() => null),
  ]);
  const previas = guardado && guardado.estado === "encontrado" ? guardado.valor.datos?.asins : null;
  const fichas: FichasGuardadas = { asins: { ...(previas ?? {}) } };

  const modelos = agruparAmazon(listings ?? []);
  const limite = Date.now() - DIAS_RELEER * 86_400_000;
  const porLeer = [...new Set(modelos.flatMap((m) => m.colores.flatMap((c) => c.asins)))].filter(
    (a) => !fichas.asins[a] || fichas.asins[a].en < limite,
  );
  // Lo nunca leído primero.
  porLeer.sort((a, b) => (fichas.asins[a]?.en ?? 0) - (fichas.asins[b]?.en ?? 0));

  let leidos = 0;
  const cuenta = (await cuentasAmazon(admin))[0] ?? null;
  if (!cuenta) avisos.push("Amazon no está conectado: el catálogo se arma con lo ya leído.");
  else if (porLeer.length) {
    const cliente = new ClienteAmazon(cuenta, inicio + presupuestoMs - 20_000);
    for (let i = 0; i < porLeer.length; i += TANDA) {
      if (Date.now() - inicio > presupuestoMs - 40_000) break;
      const tanda = porLeer.slice(i, i + TANDA);
      try {
        const r = await fichasDeCatalogo(cliente, tanda);
        const ahora = Date.now();
        // Solo se anota lo que Amazon contestó: un lote cortado por tiempo se vuelve a pedir.
        for (const [a, f] of r) fichas.asins[a] = { f: f.imagenes, c: f.clasificacion, t: f.titulo, en: ahora };
        leidos += r.size;
        await guardarCacheApp(admin, accountId, CLAVE_FICHAS, fichas, Date.now() - inicio);
      } catch (err) {
        avisos.push(`Catálogo de Amazon: ${(err as Error).message}`);
        break;
      }
    }
  }

  const categoriaDe = new Map<string, string | null>();
  for (const [modelo, cfg] of config as Map<string, { categoria?: string | null }>) {
    categoriaDe.set(String(modelo).toUpperCase(), cfg?.categoria ?? null);
  }
  const tituloPadre = new Map<string, string | null>();
  const tituloDeParent = new Map<string, string | null>();
  for (const p of padres ?? []) if (p.parent_asin && p.titulo && !tituloDeParent.has(p.parent_asin)) tituloDeParent.set(p.parent_asin, p.titulo);
  for (const p of padres ?? []) tituloPadre.set(p.asin, p.titulo ?? (p.parent_asin ? (tituloDeParent.get(p.parent_asin) ?? null) : null));

  const mapa = new Map<string, FichaGuardada>(Object.entries(fichas.asins));
  const productos = armarCatalogoAmazon(modelos, mapa, categoriaDe, tituloPadre);
  const pendientes = Math.max(0, porLeer.length - leidos);
  await guardarCacheApp(
    admin,
    accountId,
    CLAVE_CATALOGO_AMAZON,
    { generado: new Date().toISOString(), modelos: modelos.length, asinsPendientes: pendientes, productos },
    Date.now() - inicio,
  );
  const resultado = { modelos: modelos.length, productos: productos.length, asinsLeidos: leidos, asinsPendientes: pendientes, avisos };
  await admin.from("tiktok_sync_log").insert({
    account_id: accountId,
    tarea: "catalogo-amazon",
    inicio: new Date(inicio).toISOString(),
    fin: new Date().toISOString(),
    estado: avisos.length ? "con avisos" : "ok",
    detalle: resultado,
  });
  return resultado;
}
