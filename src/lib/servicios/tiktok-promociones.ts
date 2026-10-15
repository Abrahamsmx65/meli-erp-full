/**
 * Ofertas relámpago de TikTok desde el panel: lo que se lee y escribe en la
 * base y en el API de promociones. Las reglas puras viven en
 * `tiktok/promociones.ts`.
 *
 *   · `modelosParaOferta`: los modelos ACTIVOS en TikTok con su producto, sus
 *     variantes y los tres precios de Precios para TikTok (live, normal,
 *     campaña), la misma cuenta que el catálogo de creadores.
 *   · `listarOfertas`: las actividades de la tienda que TikTok tiene (en
 *     curso, programadas, borradores y las últimas vencidas), masticadas 2
 *     minutos, más la constancia local de lo que el ERP creó.
 *   · `crearOferta`: crea la actividad FLASHSALE por variante y le mete los
 *     modelos con su precio y sus topes, por lotes de 300 variantes; deja la
 *     constancia en `tiktok_promociones` con lo que contestó TikTok.
 */
import { conCandado, RecursoOcupadoError, traerTodo, type DB } from "../datos/repos";
import { preciosTikTokPorModelo, type PreciosTikTok } from "../tienda/catalogo-amazon";
import { fechaMx } from "./ventas-monitor";
import { conCacheApp, invalidarApp } from "./cache-app";
import { clienteDeCuenta } from "./tiktok";
import { actualizarProductosDeActividad, buscarActividades, crearActividad, desactivarActividad } from "../tiktok/api";
import {
  cuerpoDeActividad,
  HORAS_POR_OMISION,
  lotesDeProductos,
  MINUTOS_DE_ARRANQUE,
  ordenarOfertas,
  productosParaOferta,
  resumirActividad,
  tituloDeOferta,
  topeParaTikTok,
  ventanaDeOferta,
  type ModeloEnOferta,
  type NivelOferta,
  type OfertaResumen,
  type ProductoParaOferta,
} from "../tiktok/promociones";

const CLAVE_CACHE_OFERTAS = "tiktok:promociones";
const EDAD_CACHE_OFERTAS_MS = 2 * 60_000;
const RECURSO_OFERTA = "tiktok-promocion";

export interface ModeloParaOferta extends ProductoParaOferta {
  niveles: PreciosTikTok | null;
}

/** Los modelos activos en TikTok con su producto, sus variantes y los precios de la estrategia. */
export async function modelosParaOferta(admin: DB, accountId: string): Promise<{ modelos: ModeloParaOferta[]; avisos: string[] }> {
  const avisos: string[] = [];
  const [skus, relampago, objetivos] = await Promise.all([
    traerTodo<any>(admin, "tiktok_skus", "sku_id, product_id, seller_sku, sku_interno, estado, precio, titulo", (q) =>
      q.eq("account_id", accountId).eq("activo", true).eq("estado", "ACTIVATE"),
    ),
    admin
      .rpc("meli_neto_relampago_por_modelo", { p_account: accountId, p_desde: fechaMx(29) })
      .then((r: any) => (r?.error ? null : ((r?.data ?? []) as any[]))),
    traerTodo<any>(admin, "tiktok_precios_objetivo", "modelo, precio, quitar_retencion", (q) => q.eq("account_id", accountId)).catch(() => [] as any[]),
  ]);
  if (!relampago) avisos.push("Sin el relámpago de MELI: solo hay precio sugerido en los modelos con «Mi precio».");
  const precios = preciosTikTokPorModelo(relampago ?? [], objetivos ?? []);
  const titulos = new Map<string, string>();
  for (const s of skus ?? []) if (s.product_id && s.titulo && !titulos.has(String(s.product_id))) titulos.set(String(s.product_id), String(s.titulo));
  const productos = productosParaOferta(
    (skus ?? []).map((s: any) => ({
      skuId: String(s.sku_id ?? ""),
      productId: String(s.product_id ?? ""),
      sellerSku: s.seller_sku ?? null,
      skuInterno: s.sku_interno ?? null,
      estado: s.estado ?? null,
      precio: s.precio != null ? Number(s.precio) : null,
    })),
    titulos,
  );
  return { modelos: productos.map((p) => ({ ...p, niveles: precios.get(p.modelo) ?? null })), avisos };
}

export interface OfertaGuardada {
  id: number;
  activityId: string | null;
  titulo: string;
  nivel: string | null;
  inicio: string;
  fin: string;
  topePorTalla: number;
  topePorComprador: number;
  modelos: { modelo: string; precio: number; variantes: number }[];
  estado: string;
  error: string | null;
  creadoEn: string;
}

/** La constancia local de las últimas ofertas creadas desde el ERP. */
export async function ofertasGuardadas(db: DB, accountId: string, limite = 40): Promise<OfertaGuardada[]> {
  const { data, error } = await db
    .from("tiktok_promociones")
    .select("id, activity_id, titulo, nivel, inicio, fin, tope_por_talla, tope_por_comprador, modelos, estado, error, creado_en")
    .eq("account_id", accountId)
    .order("creado_en", { ascending: false })
    .limit(limite);
  if (error) throw new Error(`tiktok_promociones: ${error.message}`);
  return ((data ?? []) as any[]).map((r) => ({
    id: Number(r.id),
    activityId: r.activity_id ?? null,
    titulo: String(r.titulo ?? ""),
    nivel: r.nivel ?? null,
    inicio: String(r.inicio),
    fin: String(r.fin),
    topePorTalla: Number(r.tope_por_talla ?? -1),
    topePorComprador: Number(r.tope_por_comprador ?? -1),
    modelos: Array.isArray(r.modelos) ? r.modelos.map((m: any) => ({ modelo: String(m.modelo), precio: Number(m.precio), variantes: Number(m.variantes ?? 0) })) : [],
    estado: String(r.estado ?? ""),
    error: r.error ?? null,
    creadoEn: String(r.creado_en),
  }));
}

export interface OfertasDeTikTok {
  ofertas: OfertaResumen[];
  error: string | null;
  leidoEn: string;
}

async function leerOfertasDeTikTok(admin: any, accountId: string): Promise<OfertasDeTikTok> {
  const leidoEn = new Date().toISOString();
  const cliente = await clienteDeCuenta(admin, accountId, 60_000);
  if (!cliente?.tienda.shopCipher) return { ofertas: [], error: "TikTok Shop no está conectado.", leidoEn };
  try {
    const [vivas, vencidas] = await Promise.all([
      buscarActividades(cliente, { estados: ["ONGOING", "NOT_START", "DRAFT"], paginas: 3 }),
      buscarActividades(cliente, { estados: ["EXPIRED", "DEACTIVATED"], paginas: 1 }),
    ]);
    const ofertas = ordenarOfertas([...vivas.actividades, ...vencidas.actividades].map(resumirActividad)).filter((o) => o.activityId);
    return { ofertas, error: null, leidoEn };
  } catch (err) {
    return { ofertas: [], error: (err as Error).message, leidoEn };
  }
}

/** Las ofertas que TikTok tiene hoy, masticadas 2 minutos (crear o desactivar las invalida). */
export async function listarOfertas(admin: any, accountId: string, opciones: { forzar?: boolean } = {}): Promise<OfertasDeTikTok> {
  if (opciones.forzar) await invalidarApp(admin, accountId, "ofertas de TikTok", { claves: [CLAVE_CACHE_OFERTAS] }).catch(() => undefined);
  return conCacheApp(admin, accountId, CLAVE_CACHE_OFERTAS, EDAD_CACHE_OFERTAS_MS, () => leerOfertasDeTikTok(admin, accountId));
}

export interface PedidoDeOferta {
  titulo?: string | null;
  /** ISO; vacío = dentro de `MINUTOS_DE_ARRANQUE` minutos */
  inicio?: string | null;
  horas?: number | null;
  nivel?: NivelOferta | null;
  topePorTalla?: number | null;
  topePorComprador?: number | null;
  modelos: { modelo: string; precio: number }[];
}

export interface ResultadoOferta {
  id: number;
  activityId: string;
  titulo: string;
  estado: string;
  modelos: number;
  variantes: number;
  /** lotes de productos que TikTok no aceptó, con su mensaje */
  errores: string[];
  avisos: string[];
}

/**
 * Crea la oferta en TikTok: la actividad y, lote por lote, sus productos.
 * Si TikTok rechaza un lote después de crear la actividad, la constancia
 * queda como `parcial` con el mensaje real y la actividad sigue en TikTok
 * (se completa o se desactiva desde la pantalla). Un solo clic a la vez.
 */
export async function crearOferta(admin: any, accountId: string, pedido: PedidoDeOferta, usuario: string | null): Promise<ResultadoOferta> {
  const nivel: NivelOferta = pedido.nivel === "live" || pedido.nivel === "campana" ? pedido.nivel : "normal";
  const inicio = pedido.inicio ? new Date(pedido.inicio) : new Date(Date.now() + MINUTOS_DE_ARRANQUE * 60_000);
  const horas = Number(pedido.horas) > 0 ? Number(pedido.horas) : HORAS_POR_OMISION;
  const ventana = ventanaDeOferta(inicio, horas);
  const titulo = String(pedido.titulo ?? "").trim() || tituloDeOferta(inicio, nivel);
  const topes = { porTalla: topeParaTikTok(pedido.topePorTalla), porComprador: topeParaTikTok(pedido.topePorComprador) };

  const pedidos = new Map<string, number>();
  for (const m of pedido.modelos ?? []) {
    const modelo = String(m.modelo ?? "").trim().toUpperCase();
    const precio = Number(m.precio);
    if (modelo && precio > 0) pedidos.set(modelo, Math.round(precio * 100) / 100);
  }
  if (!pedidos.size) throw new Error("Marca al menos un modelo con precio.");
  const { modelos: catalogo } = await modelosParaOferta(admin, accountId);
  const porModelo = new Map(catalogo.map((m) => [m.modelo, m]));
  const modelos: ModeloEnOferta[] = [];
  const sinProducto: string[] = [];
  for (const [modelo, precio] of pedidos) {
    const p = porModelo.get(modelo);
    if (!p) sinProducto.push(modelo);
    else modelos.push({ modelo, productId: p.productId, precio, skuIds: p.skuIds });
  }
  if (sinProducto.length) throw new Error(`Sin producto activo en TikTok: ${sinProducto.join(", ")}.`);
  const lotes = lotesDeProductos(modelos, topes);
  const cuerpo = cuerpoDeActividad(titulo, ventana);

  try {
    return await conCandado(admin, accountId, RECURSO_OFERTA, 180, async () => {
      const cliente = await clienteDeCuenta(admin, accountId, 170_000);
      if (!cliente?.tienda.shopCipher) throw new Error("TikTok Shop no está conectado.");
      const { data: fila, error } = await admin
        .from("tiktok_promociones")
        .insert({
          account_id: accountId,
          titulo: cuerpo.title,
          tipo: "FLASHSALE",
          nivel,
          inicio: new Date(ventana.beginTime * 1000).toISOString(),
          fin: new Date(ventana.endTime * 1000).toISOString(),
          tope_por_talla: topes.porTalla,
          tope_por_comprador: topes.porComprador,
          modelos: modelos.map((m) => ({ modelo: m.modelo, precio: m.precio, productId: m.productId, variantes: m.skuIds.length })),
          estado: "creando",
          creado_por: usuario,
        })
        .select("id")
        .single();
      if (error || !fila) throw new Error(`No se pudo guardar la constancia: ${error?.message ?? "sin id"}`);
      const id = Number(fila.id);
      const respuesta: Record<string, unknown> = { cuerpo, lotes: [] as unknown[] };
      const errores: string[] = [];
      const avisos: string[] = [];
      let activityId = "";
      try {
        const creada = await crearActividad(cliente, cuerpo);
        activityId = String(creada.activity_id);
        respuesta.actividad = creada;
        for (let i = 0; i < lotes.length; i++) {
          try {
            const r = await actualizarProductosDeActividad(cliente, activityId, lotes[i]);
            (respuesta.lotes as unknown[]).push({ lote: i + 1, ok: true, r });
            for (const w of r?.warnings ?? []) if (w?.message) avisos.push(String(w.message));
          } catch (err) {
            const m = (err as Error).message;
            errores.push(`Lote ${i + 1} de ${lotes.length} (${lotes[i].length} productos): ${m}`);
            (respuesta.lotes as unknown[]).push({ lote: i + 1, ok: false, error: m });
          }
        }
      } catch (err) {
        const m = (err as Error).message;
        await admin
          .from("tiktok_promociones")
          .update({ estado: "error", error: m, respuesta })
          .eq("id", id);
        throw err;
      }
      const estado = errores.length ? (errores.length === lotes.length ? "sin_productos" : "parcial") : "creada";
      await admin
        .from("tiktok_promociones")
        .update({ activity_id: activityId, estado, error: errores.length ? errores.join(" | ") : null, respuesta })
        .eq("id", id);
      await invalidarApp(admin, accountId, "oferta creada", { claves: [CLAVE_CACHE_OFERTAS] }).catch(() => undefined);
      return {
        id,
        activityId,
        titulo: String(cuerpo.title),
        estado,
        modelos: modelos.length,
        variantes: modelos.reduce((a, m) => a + m.skuIds.length, 0),
        errores,
        avisos,
      };
    });
  } catch (err) {
    if (err instanceof RecursoOcupadoError) throw new Error("Ya se está creando una oferta; espera a que termine.");
    throw err;
  }
}

/** Desactiva una oferta en TikTok (deja de enseñarse) y lo anota en la constancia si la hay. */
export async function desactivarOferta(admin: any, accountId: string, activityId: string): Promise<void> {
  const id = String(activityId ?? "").trim();
  if (!id) throw new Error("Falta la oferta.");
  const cliente = await clienteDeCuenta(admin, accountId, 60_000);
  if (!cliente?.tienda.shopCipher) throw new Error("TikTok Shop no está conectado.");
  const r = await desactivarActividad(cliente, id);
  await admin
    .from("tiktok_promociones")
    .update({ estado: "desactivada", respuesta: { desactivada: r } })
    .eq("account_id", accountId)
    .eq("activity_id", id);
  await invalidarApp(admin, accountId, "oferta desactivada", { claves: [CLAVE_CACHE_OFERTAS] }).catch(() => undefined);
}

/** Vuelve a crear una oferta guardada con los mismos modelos y precios, desde ahora (o la fecha que se diga). */
export async function repetirOferta(
  admin: any,
  accountId: string,
  id: number,
  usuario: string | null,
  opciones: { inicio?: string | null; horas?: number | null } = {},
): Promise<ResultadoOferta> {
  const { data: fila, error } = await admin
    .from("tiktok_promociones")
    .select("nivel, modelos, tope_por_talla, tope_por_comprador, inicio, fin")
    .eq("account_id", accountId)
    .eq("id", id)
    .maybeSingle();
  if (error || !fila) throw new Error("Esa oferta no está en la constancia.");
  const horasOriginales = Math.round((Date.parse(fila.fin) - Date.parse(fila.inicio)) / 3_600_000);
  return crearOferta(
    admin,
    accountId,
    {
      inicio: opciones.inicio ?? null,
      horas: opciones.horas ?? (horasOriginales > 0 ? horasOriginales : HORAS_POR_OMISION),
      nivel: (fila.nivel as NivelOferta) ?? "normal",
      topePorTalla: fila.tope_por_talla,
      topePorComprador: fila.tope_por_comprador,
      modelos: (Array.isArray(fila.modelos) ? fila.modelos : []).map((m: any) => ({ modelo: String(m.modelo), precio: Number(m.precio) })),
    },
    usuario,
  );
}
