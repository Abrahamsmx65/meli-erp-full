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
import { ESTADO_ACTIVO, interpretarProducto, seVende } from "../tienda/catalogo";
import { clienteDeCuenta } from "./tiktok";

export const HORAS_RELEER = 12;

export interface ResultadoCatalogoTienda {
  conectado: boolean;
  leidos: number;
  fallidos: number;
  pendientes: number;
  activos: number;
  preciosActualizados: number;
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
  opciones: { todo?: boolean } = {},
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
      const precio = precioPorSku.has(id) ? precioPorSku.get(id)! : null;
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

  const resultado: ResultadoCatalogoTienda = {
    conectado: true,
    leidos,
    fallidos,
    pendientes: Math.max(0, porLeer.length - leidos - fallidos),
    activos: activosTikTok.size,
    preciosActualizados: cambiosVariante.length,
    avisos,
  };
  if (leidos || fallidos || cambiosVariante.length || apagar.length) {
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
