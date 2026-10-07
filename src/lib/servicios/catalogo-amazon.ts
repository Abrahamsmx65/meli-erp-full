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
 *    `catalogo-amazon` y la tienda solo lee ese renglón. Lleva TODO, también
 *    lo oculto desde el back (`tienda_catalogo_ajustes`), con los pares en
 *    bodega y en el mar de `inventario_cache` y el precio que tendría en
 *    TikTok según Precios para TikTok (`preciosTikTokPorModelo`, 30 días de
 *    MELI como esa pantalla); la página filtra lo oculto.
 *  · `soloArmar` rearma con lo ya leído sin preguntarle nada a Amazon: lo
 *    usa el back al ocultar un modelo o cambiarle la categoría.
 *  · `todo` relee TODOS los ASINs aunque estén frescos, los más viejos
 *    primero: es la pasada NOCTURNA de las 2:00 de México
 *    (`/api/cron/catalogo-amazon`, 08:00Z; pedido del dueño, 6-oct-2026:
 *    «que el catálogo de Amazon se lea cada noche a las 2am»), para que una
 *    foto que se cargue en Amazon durante el día salga al día siguiente y
 *    no hasta la semana. Lo que no alcance en los 5 minutos queda con su
 *    fecha vieja y lo toma la noche siguiente.
 */
import { traerTodo } from "../datos/repos";
import { Cliente as ClienteAmazon, cuentasAmazon } from "../amazon/spapi";
import { fichasDeCatalogo } from "../amazon/catalogo";
import { agruparAmazon, armarCatalogoAmazon, preciosTikTokPorModelo, stockPorModelo, type FichaGuardada } from "../tienda/catalogo-amazon";
import { fechaMx } from "./ventas-monitor";
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

export async function refrescarCatalogoAmazon(
  admin: any,
  accountId: string,
  presupuestoMs: number,
  opciones: { soloArmar?: boolean; todo?: boolean } = {},
): Promise<ResultadoCatalogoAmazon> {
  const inicio = Date.now();
  const avisos: string[] = [];
  const [listings, padres, config, guardado, ajustes, inventario, relampago, objetivos, kardex] = await Promise.all([
    traerTodo<any>(admin, "amazon_listings", "seller_sku, asin, estado, titulo", (q) => q.order("seller_sku", { ascending: true })),
    traerTodo<any>(admin, "amazon_padres", "asin, titulo, parent_asin", (q) => q.order("asin", { ascending: true })).catch(() => [] as any[]),
    configPorProducto(admin, accountId).catch(() => new Map()),
    leerCacheAppGuardado<FichasGuardadas>(admin, accountId, CLAVE_FICHAS).catch(() => null),
    traerTodo<any>(admin, "tienda_catalogo_ajustes", "modelo, oculto", (q) => q.eq("account_id", accountId).order("modelo", { ascending: true })).catch(
      () => [] as any[],
    ),
    admin
      .from("inventario_cache")
      .select("renglones:datos->datos->renglones")
      .eq("account_id", accountId)
      .maybeSingle()
      .then((r: any) => (Array.isArray(r?.data?.renglones) ? r.data.renglones : null)),
    // Lo mismo que lee Precios para TikTok (30 días de MELI por omisión).
    admin
      .rpc("meli_neto_relampago_por_modelo", { p_account: accountId, p_desde: fechaMx(29) })
      .then((r: any) => (r?.error ? null : ((r?.data ?? []) as any[]))),
    traerTodo<any>(admin, "tiktok_precios_objetivo", "modelo, precio, quitar_retencion", (q) => q.eq("account_id", accountId).order("modelo", { ascending: true })).catch(
      () => [] as any[],
    ),
    traerTodo<any>(admin, "tiktok_inventario", "sku, saldo", (q) => q.eq("account_id", accountId).order("sku", { ascending: true })).catch(() => null),
  ]);
  if (!kardex) avisos.push("Sin el kardex de TikTok: su bodega sale en cero.");
  if (!relampago) avisos.push("Sin el relámpago de MELI: solo salen los precios capturados en «Mi precio».");
  const precios = preciosTikTokPorModelo(relampago ?? [], objetivos ?? []);
  if (!inventario) avisos.push("Sin la vista de inventario: bodega y mar salen en cero.");
  const ocultos = new Set<string>((ajustes ?? []).filter((a: any) => a.oculto).map((a: any) => String(a.modelo).toUpperCase()));
  const stock = stockPorModelo(inventario ?? [], kardex ?? []);
  const previas = guardado && guardado.estado === "encontrado" ? guardado.valor.datos?.asins : null;
  const fichas: FichasGuardadas = { asins: { ...(previas ?? {}) } };

  const modelos = agruparAmazon(listings ?? []);
  const limite = opciones.todo ? Number.POSITIVE_INFINITY : Date.now() - DIAS_RELEER * 86_400_000;
  const porLeer = [...new Set(modelos.flatMap((m) => m.colores.flatMap((c) => c.asins)))].filter(
    (a) => !fichas.asins[a] || fichas.asins[a].en < limite,
  );
  // Lo nunca leído primero.
  porLeer.sort((a, b) => (fichas.asins[a]?.en ?? 0) - (fichas.asins[b]?.en ?? 0));

  let leidos = 0;
  const cuenta = opciones.soloArmar ? null : ((await cuentasAmazon(admin))[0] ?? null);
  if (opciones.soloArmar) {
    /* el back: solo rearmar con lo ya leído */
  } else if (!cuenta) avisos.push("Amazon no está conectado: el catálogo se arma con lo ya leído.");
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
  const productos = armarCatalogoAmazon(modelos, mapa, categoriaDe, tituloPadre, { ocultos, stock, precios });
  const pendientes = Math.max(0, porLeer.length - leidos);
  await guardarCacheApp(
    admin,
    accountId,
    CLAVE_CATALOGO_AMAZON,
    { generado: new Date().toISOString(), modelos: modelos.length, asinsPendientes: pendientes, productos },
    Date.now() - inicio,
  );
  const resultado = { modelos: modelos.length, productos: productos.length, asinsLeidos: leidos, asinsPendientes: pendientes, avisos };
  if (opciones.soloArmar) return resultado;
  await admin.from("tiktok_sync_log").insert({
    account_id: accountId,
    tarea: "catalogo-amazon",
    inicio: new Date(inicio).toISOString(),
    fin: new Date().toISOString(),
    estado: avisos.length ? "con avisos" : "ok",
    detalle: { ...resultado, origen: opciones.todo ? "nocturno" : "hora", asinsPorLeer: porLeer.length },
  });
  return resultado;
}
