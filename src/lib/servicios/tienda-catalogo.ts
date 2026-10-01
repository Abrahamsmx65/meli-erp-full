/**
 * Copia a la base el catálogo de TikTok Shop para la tienda en línea de
 * GETAC (`tienda_productos`, `tienda_variantes`, migración 0101).
 *
 * Regla de arquitectura: la tienda NUNCA le pregunta a TikTok en el clic
 * del comprador; lee lo que este trabajo dejó masticado. Corre en el cron
 * de TikTok con presupuesto de tiempo y desde el botón de la pantalla.
 *
 *  · Producto por producto (`GET /product/202309/products/{id}`, ~1/s):
 *    fotos, descripción, colores y tallas. Lo nunca leído primero, luego
 *    lo más viejo; cada producto se relee a las `HORAS_RELEER`.
 *  · El PRECIO y el amarre se copian en CADA corrida desde `tiktok_skus`
 *    (que el sync de 15 min ya trae): un cambio de precio en TikTok llega a
 *    la página sin esperar la relectura del producto.
 *  · Un producto que TikTok ya no tiene activo sale de la tienda.
 */
import { traerTodo, type DB } from "../datos/repos";
import { producto as productoTikTok } from "../tiktok/api";
import { ESTADO_ACTIVO, emparejarAmazon, interpretarProducto, seVende } from "../tienda/catalogo";
import { Cliente as ClienteAmazon, cuentasAmazon } from "../amazon/spapi";
import { fichasCapturadasPorSku } from "../amazon/fotos-publicacion";
import { imagenesDeAsins } from "../amazon/catalogo";
import { esPaginaDeCaptcha, imagenesDeTiendaAmazon } from "../tienda/amazon-store";
import { configPorProducto } from "./productos";
import { leerTiendaAmazon } from "./tienda-banners";
import { clienteDeCuenta } from "./tiktok";

export const HORAS_RELEER = 12;

export interface ResultadoCatalogoTienda {
  conectado: boolean;
  leidos: number;
  fallidos: number;
  pendientes: number;
  activos: number;
  preciosActualizados: number;
  /** productos a los que esta corrida les puso fotos de Amazon */
  fotosAmazon?: number;
  avisos: string[];
}

async function guardar(db: DB, tabla: string, filas: any[], onConflict: string) {
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await db.from(tabla).upsert(filas.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${tabla}: ${error.message}`);
  }
}

export async function refrescarCatalogoTienda(
  admin: any,
  accountId: string,
  presupuestoMs = 60_000,
  opciones: { todo?: boolean; sinAmazon?: boolean } = {},
): Promise<ResultadoCatalogoTienda> {
  const inicio = Date.now();
  const avisos: string[] = [];
  const eq = (q: any) => q.eq("account_id", accountId);

  const [skus, productos, variantes] = await Promise.all([
    traerTodo<any>(admin, "tiktok_skus", "sku_id, product_id, seller_sku, sku_interno, precio, estado", (q) =>
      eq(q).eq("activo", true),
    ),
    traerTodo<any>(admin, "tienda_productos", "product_id, leido_en, activo", eq),
    traerTodo<any>(admin, "tienda_variantes", "sku_id, product_id, sku_interno, precio, activo", eq),
  ]);

  // Lo que TikTok tiene ACTIVO (según el catálogo del sync de 15 min).
  const activosTikTok = new Set<string>();
  const porSkuId = new Map<string, string>();
  const porSellerSku = new Map<string, string>();
  const precioPorSku = new Map<string, number | null>();
  for (const s of skus ?? []) {
    if (s.product_id && String(s.estado ?? "") === ESTADO_ACTIVO) activosTikTok.add(String(s.product_id));
    if (s.sku_interno) {
      porSkuId.set(String(s.sku_id), String(s.sku_interno));
      if (s.seller_sku) porSellerSku.set(String(s.seller_sku).trim(), String(s.sku_interno));
    }
    precioPorSku.set(String(s.sku_id), s.precio != null ? Number(s.precio) : null);
  }

  // 1. Precio y amarre de lo ya copiado, sin preguntarle a TikTok.
  const cambiosVariante = (variantes ?? [])
    .map((v: any) => {
      const id = String(v.sku_id);
      // Un precio vacío en tiktok_skus NO borra el que se leyó del producto.
      const precio = precioPorSku.get(id) ?? (v.precio != null ? Number(v.precio) : null);
      const interno = porSkuId.get(id) ?? v.sku_interno ?? null;
      const activo = precioPorSku.has(id);
      if (Number(v.precio ?? NaN) === Number(precio ?? NaN) && (v.sku_interno ?? null) === interno && Boolean(v.activo) === activo) {
        return null;
      }
      return { account_id: accountId, sku_id: id, product_id: v.product_id, precio, sku_interno: interno, activo };
    })
    .filter(Boolean) as any[];
  if (cambiosVariante.length) await guardar(admin, "tienda_variantes", cambiosVariante, "account_id,sku_id");

  // 2. Lo que TikTok ya no tiene activo sale de la tienda.
  const apagar = (productos ?? [])
    .filter((p: any) => p.activo && !activosTikTok.has(String(p.product_id)))
    .map((p: any) => String(p.product_id));
  if (apagar.length) {
    for (let i = 0; i < apagar.length; i += 300) {
      await admin
        .from("tienda_productos")
        .update({ activo: false, actualizado_en: new Date().toISOString() })
        .eq("account_id", accountId)
        .in("product_id", apagar.slice(i, i + 300));
    }
  }

  // 3. Qué productos leer completos.
  const leidoEn = new Map<string, number>((productos ?? []).map((p: any) => [String(p.product_id), Date.parse(p.leido_en)]));
  const limite = Date.now() - HORAS_RELEER * 3_600_000;
  const porLeer = [...activosTikTok]
    .filter((id) => opciones.todo || !leidoEn.has(id) || (leidoEn.get(id) ?? 0) < limite)
    .sort((a, b) => (leidoEn.get(a) ?? 0) - (leidoEn.get(b) ?? 0));

  const cliente = porLeer.length ? await clienteDeCuenta(admin, accountId, presupuestoMs) : null;
  if (porLeer.length && !cliente) {
    return {
      conectado: false,
      leidos: 0,
      fallidos: 0,
      pendientes: porLeer.length,
      activos: activosTikTok.size,
      preciosActualizados: cambiosVariante.length,
      avisos: ["TikTok Shop no está conectado."],
    };
  }

  let leidos = 0;
  let fallidos = 0;
  for (const id of porLeer) {
    if (Date.now() - inicio > presupuestoMs - 5_000) break;
    try {
      const crudo = await productoTikTok(cliente!, id);
      const p = interpretarProducto(crudo, { porSkuId, porSellerSku });
      const ahora = new Date().toISOString();
      if (!p) {
        await admin
          .from("tienda_productos")
          .upsert(
            { account_id: accountId, product_id: id, titulo: id, activo: false, leido_en: ahora, actualizado_en: ahora },
            { onConflict: "account_id,product_id" },
          );
        fallidos++;
        continue;
      }
      await guardar(
        admin,
        "tienda_productos",
        [
          {
            account_id: accountId,
            product_id: p.productId,
            modelo: p.modelo,
            titulo: p.titulo,
            descripcion: p.descripcion,
            imagenes: p.imagenes,
            estado_tiktok: p.estadoTikTok,
            activo: seVende(p),
            leido_en: ahora,
            actualizado_en: ahora,
          },
        ],
        "account_id,product_id",
      );
      const vivas = new Set(p.variantes.map((v) => v.skuId));
      await guardar(
        admin,
        "tienda_variantes",
        p.variantes.map((v) => ({
          account_id: accountId,
          sku_id: v.skuId,
          product_id: p.productId,
          sku_interno: v.skuInterno,
          seller_sku: v.sellerSku,
          color: v.color,
          talla: v.talla,
          precio: v.precio,
          precio_lista: v.precioLista,
          imagen: v.imagen,
          activo: Boolean(v.skuInterno),
        })),
        "account_id,sku_id",
      );
      const muertas = (variantes ?? [])
        .filter((v: any) => String(v.product_id) === p.productId && !vivas.has(String(v.sku_id)))
        .map((v: any) => String(v.sku_id));
      if (muertas.length) {
        await admin.from("tienda_variantes").update({ activo: false }).eq("account_id", accountId).in("sku_id", muertas);
      }
      leidos++;
    } catch (err) {
      fallidos++;
      if (avisos.length < 5) avisos.push(`Producto ${id}: ${(err as Error).message}`);
    }
  }

  // Fotos de Amazon y categoría con el tiempo que quede.
  let amazon: ResultadoAmazonTienda | null = null;
  const restante = presupuestoMs - (Date.now() - inicio);
  if (!opciones.sinAmazon && restante > 15_000) {
    try {
      amazon = await enriquecerConAmazon(admin, accountId, restante - 5_000, opciones);
      avisos.push(...amazon.avisos);
    } catch (err) {
      avisos.push(`Fotos de Amazon: ${(err as Error).message}`);
    }
  }

  // Banners de la tienda de marca de Amazon (una vez al día; el botón fuerza).
  if (!opciones.sinAmazon && presupuestoMs - (Date.now() - inicio) > 30_000) {
    try {
      const b = await leerTiendaAmazon(admin, accountId, { forzar: opciones.todo });
      if (!b.omitido && !b.imagenes) avisos.push(...b.avisos.slice(0, 2));
    } catch (err) {
      avisos.push(`Banners de Amazon: ${(err as Error).message}`);
    }
  }

  const resultado: ResultadoCatalogoTienda = {
    conectado: true,
    leidos,
    fallidos,
    pendientes: Math.max(0, porLeer.length - leidos - fallidos),
    activos: activosTikTok.size,
    preciosActualizados: cambiosVariante.length,
    fotosAmazon: amazon?.productos ?? 0,
    avisos,
  };
  if (leidos || fallidos || cambiosVariante.length || apagar.length || amazon?.productos) {
    await admin.from("tiktok_sync_log").insert({
      account_id: accountId,
      tarea: "tienda-catalogo",
      inicio: new Date(inicio).toISOString(),
      fin: new Date().toISOString(),
      estado: avisos.length ? "con avisos" : "ok",
      detalle: { ...resultado, apagados: apagar.length },
    });
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// Las MISMAS fotos de Amazon, por color, y la categoría del modelo
// (decisión del dueño, 1-oct-2026). Las fotos salen de la ficha capturada
// en Amazon (Listings Items: principal y other_1…8, en su orden), igual que
// en «Productos nuevos» de TikTok; si la ficha no trae fotos, la imagen
// principal del reporte (`amazon_listings.imagen_url`). Se relee cada
// `HORAS_RELEER_AMAZON`.
// ---------------------------------------------------------------------------

export const HORAS_RELEER_AMAZON = 24;

export interface ResultadoAmazonTienda {
  productos: number;
  pendientes: number;
  avisos: string[];
}

export async function enriquecerConAmazon(
  admin: any,
  accountId: string,
  presupuestoMs: number,
  opciones: { todo?: boolean } = {},
): Promise<ResultadoAmazonTienda> {
  const inicio = Date.now();
  const avisos: string[] = [];
  const eq = (q: any) => q.eq("account_id", accountId);
  const [productos, variantes, listings, config] = await Promise.all([
    traerTodo<any>(admin, "tienda_productos", "product_id, modelo, categoria, amazon_leido_en", (q) => eq(q).eq("activo", true)),
    traerTodo<any>(admin, "tienda_variantes", "sku_id, product_id, sku_interno, color", (q) => eq(q).eq("activo", true)),
    traerTodo<any>(admin, "amazon_listings", "seller_sku, asin, imagen_url", (q) => q).catch(() => [] as any[]),
    configPorProducto(admin, accountId).catch(() => new Map()),
  ]);

  // La categoría de Productos y costos, por modelo (barato: siempre).
  const categoriaDe = new Map<string, string | null>();
  for (const [modelo, cfg] of config as Map<string, { categoria?: string | null }>) {
    categoriaDe.set(String(modelo).toUpperCase(), cfg?.categoria ?? null);
  }
  const categorias = (productos ?? [])
    .map((p: any) => {
      const cat = p.modelo ? (categoriaDe.get(String(p.modelo).toUpperCase()) ?? null) : null;
      return cat && cat !== p.categoria ? { account_id: accountId, product_id: p.product_id, categoria: cat } : null;
    })
    .filter(Boolean) as any[];
  if (categorias.length) await guardar(admin, "tienda_productos", categorias, "account_id,product_id");

  const limite = Date.now() - HORAS_RELEER_AMAZON * 3_600_000;
  const porLeer = (productos ?? [])
    .filter((p: any) => opciones.todo || !p.amazon_leido_en || Date.parse(p.amazon_leido_en) < limite)
    .map((p: any) => String(p.product_id));
  if (!porLeer.length) return { productos: 0, pendientes: 0, avisos };

  const asinDe = new Map<string, string>();
  const imagenDe = new Map<string, string>();
  for (const l of listings ?? []) {
    const sku = String(l.seller_sku ?? "").toUpperCase();
    if (l.asin) asinDe.set(sku, String(l.asin));
    if (l.imagen_url) imagenDe.set(sku, String(l.imagen_url));
  }
  const pareo = emparejarAmazon(
    (variantes ?? [])
      .filter((v: any) => porLeer.includes(String(v.product_id)))
      .map((v: any) => ({ productId: String(v.product_id), color: v.color, skuInterno: v.sku_interno })),
    (listings ?? []).map((l: any) => String(l.seller_sku)),
  );

  const cuenta = (await cuentasAmazon(admin))[0] ?? null;
  const cliente = cuenta ? new ClienteAmazon(cuenta, Date.now() + presupuestoMs) : null;
  if (!cliente) avisos.push("Amazon no está conectado: la tienda se queda con las fotos de TikTok.");

  let hechos = 0;
  for (const productId of porLeer) {
    if (Date.now() - inicio > presupuestoMs - 15_000) break;
    const colores = pareo.get(productId) ?? new Map<string, string[]>();

    // 1. Fotos por COLOR del catálogo de Amazon por ASIN (las mismas de
    //    «Contenido de Amazon»): MAIN y luego PT01, PT02… de ESE color.
    const asinsPorColor = new Map<string, string[]>();
    for (const [color, skus] of colores) {
      asinsPorColor.set(color, skus.map((s) => asinDe.get(s.toUpperCase())).filter(Boolean) as string[]);
    }
    const todosAsins = [...new Set([...asinsPorColor.values()].flat())];
    let porAsin = new Map<string, { link: string }[]>();
    if (cliente && todosAsins.length) {
      try {
        porAsin = await imagenesDeAsins(cliente, todosAsins);
      } catch (err) {
        if (avisos.length < 5) avisos.push(`Catálogo de Amazon (${productId}): ${(err as Error).message}`);
      }
    }
    // 2. Puntos clave de la ficha capturada (necesita el Seller ID).
    let bullets: string[] = [];
    const skusFicha = [...colores.values()].map((l) => l[0]).filter(Boolean);
    if (cliente && cuenta?.sellingPartnerId && skusFicha.length) {
      try {
        const fichas = await fichasCapturadasPorSku(cliente, cuenta.sellingPartnerId, skusFicha.slice(0, 5));
        for (const f of fichas.values()) if (!bullets.length && f.bullets.length) bullets = f.bullets.slice(0, 6);
      } catch {
        /* los puntos clave son opcionales */
      }
    }
    const fotos: Record<string, string[]> = {};
    for (const [color, asins] of asinsPorColor) {
      for (const asin of asins) {
        const lista = (porAsin.get(asin) ?? []).map((i) => i.link);
        if (lista.length) {
          fotos[color] = lista;
          break;
        }
      }
      if (!fotos[color]) {
        const img = (colores.get(color) ?? []).map((s) => imagenDe.get(s.toUpperCase())).find(Boolean);
        if (img) fotos[color] = [img];
      }
    }
    // 3. Contenido A+ de la página del producto en Amazon.
    const asinAplus = todosAsins[0] ?? null;
    let aplus: string[] | null = null;
    if (asinAplus) {
      const r = await aplusDeAsin(asinAplus);
      if (r.imagenes) aplus = r.imagenes;
      else if (avisos.length < 5 && r.motivo) avisos.push(`A+ ${asinAplus}: ${r.motivo}`);
    }

    const cambios: Record<string, unknown> = { fotos_amazon: fotos, bullets, asin: asinAplus, amazon_leido_en: new Date().toISOString() };
    if (aplus) cambios.aplus = aplus;
    await admin.from("tienda_productos").update(cambios).eq("account_id", accountId).eq("product_id", productId);
    hechos++;
  }
  return { productos: hechos, pendientes: porLeer.length - hechos, avisos };
}

/**
 * Las imágenes A+ de un producto, leídas de su página en Amazon desde el
 * servidor del ERP (la API de A+ no da URLs públicas de sus imágenes).
 * Captcha o error: null y el motivo; se conserva lo anterior.
 */
export async function aplusDeAsin(asin: string): Promise<{ imagenes: string[] | null; motivo?: string }> {
  try {
    const r = await fetch(`https://www.amazon.com.mx/dp/${encodeURIComponent(asin)}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept-Language": "es-MX,es;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const html = await r.text();
    if (!r.ok) return { imagenes: null, motivo: `HTTP ${r.status}` };
    if (esPaginaDeCaptcha(html)) return { imagenes: null, motivo: "Amazon pidió captcha" };
    // Solo el bloque A+ (aplus-media); nada de las fotos del producto ni de anuncios.
    const imagenes = imagenesDeTiendaAmazon(html)
      .map((i) => i.url)
      .filter((u) => /\/images\/S\/aplus-media/.test(u));
    return { imagenes };
  } catch (err) {
    return { imagenes: null, motivo: (err as Error).message };
  }
}
