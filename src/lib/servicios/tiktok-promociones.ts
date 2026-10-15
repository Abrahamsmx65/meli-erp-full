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
import { actividad, actualizarProductosDeActividad, buscarActividades, crearActividad, desactivarActividad } from "../tiktok/api";
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
  horasDeCiclica,
  tituloDeCiclica,
  ventanasQueFaltan,
  HORAS_MAX_CICLICA,
  relampagosDeActividad,
  ultimaRelampago,
  ventanasVivasDeRelampagos,
  type RelampagoDeProducto,
} from "../tiktok/promociones";

const CLAVE_CACHE_OFERTAS = "tiktok:promociones";
const EDAD_CACHE_OFERTAS_MS = 2 * 60_000;
/** Qué relámpago tiene cada producto (del detalle de cada actividad): 10 min, cae con cada oferta creada o desactivada. */
const CLAVE_CACHE_RELAMPAGOS = "tiktok:promociones:productos";
const EDAD_CACHE_RELAMPAGOS_MS = 10 * 60_000;
/** Cuántas ofertas ya vencidas se detallan para saber el último precio de un modelo que hoy no tiene relámpago. */
const VENCIDAS_A_DETALLAR = 12;
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
    // TikTok MX solo deja buscar por NOT_START, ONGOING, EXPIRED y
    // DEACTIVATED: con DRAFT contesta 17029001 «Invalid Parameter»
    // (15-oct-2026), así que los borradores no se leen desde aquí.
    const [vivas, vencidas] = await Promise.all([
      buscarActividades(cliente, { estados: ["ONGOING", "NOT_START"], paginas: 3 }),
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
  /** la cíclica de la que nace esta ventana (queda en `tiktok_promociones.ciclico_id`) */
  ciclicoId?: number | null;
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
  const ciclicoId = Number(pedido.ciclicoId) > 0 ? Number(pedido.ciclicoId) : null;
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
          nivel: ciclicoId ? "ciclica" : nivel,
          ciclico_id: ciclicoId,
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
      await invalidarApp(admin, accountId, "oferta creada", { claves: [CLAVE_CACHE_OFERTAS, CLAVE_CACHE_RELAMPAGOS] }).catch(() => undefined);
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
  await invalidarApp(admin, accountId, "oferta desactivada", { claves: [CLAVE_CACHE_OFERTAS, CLAVE_CACHE_RELAMPAGOS] }).catch(() => undefined);
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

// ---------------------------------------------------------------------------
// Qué relámpago tiene cada producto en TikTok
// ---------------------------------------------------------------------------

export interface RelampagosPorProducto {
  /** product_id → sus relámpagos (en curso, programadas y las últimas vencidas) */
  porProducto: Record<string, RelampagoDeProducto[]>;
  leidoEn: string;
  error: string | null;
}

async function leerRelampagosPorProducto(admin: any, accountId: string): Promise<RelampagosPorProducto> {
  const leidoEn = new Date().toISOString();
  const ofertas = await listarOfertas(admin, accountId);
  if (ofertas.error) return { porProducto: {}, leidoEn, error: ofertas.error };
  const cliente = await clienteDeCuenta(admin, accountId, 120_000);
  if (!cliente?.tienda.shopCipher) return { porProducto: {}, leidoEn, error: "TikTok Shop no está conectado." };
  const vivas = ofertas.ofertas.filter((o) => o.estado === "ONGOING" || o.estado === "NOT_START");
  const vencidas = ofertas.ofertas.filter((o) => o.estado !== "ONGOING" && o.estado !== "NOT_START").slice(0, VENCIDAS_A_DETALLAR);
  const porProducto: Record<string, RelampagoDeProducto[]> = {};
  const errores: string[] = [];
  const cola: OfertaResumen[] = [...vivas, ...vencidas];
  let cursor = 0;
  const obrero = async () => {
    while (cursor < cola.length) {
      const o = cola[cursor++];
      try {
        const detalle = await actividad(cliente, o.activityId);
        for (const { productId, relampago } of relampagosDeActividad(o, detalle)) (porProducto[productId] ??= []).push(relampago);
      } catch (err) {
        errores.push(`${o.titulo}: ${(err as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, cola.length) }, obrero));
  return { porProducto, leidoEn, error: errores.length ? errores.join(" · ") : null };
}

/** Las relámpagos de cada producto, masticadas 10 minutos. */
export async function relampagosPorProducto(admin: any, accountId: string): Promise<RelampagosPorProducto> {
  return conCacheApp(admin, accountId, CLAVE_CACHE_RELAMPAGOS, EDAD_CACHE_RELAMPAGOS_MS, () => leerRelampagosPorProducto(admin, accountId));
}

// ---------------------------------------------------------------------------
// Relámpagos CÍCLICOS: siempre programados, por modelo
// ---------------------------------------------------------------------------

export interface CiclicaGuardada {
  id: number;
  modelo: string;
  precio: number;
  horas: number;
  topePorTalla: number;
  topePorComprador: number;
  activo: boolean;
  ultimoError: string | null;
  programadoEn: string | null;
  /** las ventanas creadas que aún no terminan, de la más próxima a la más lejana */
  ventanas: { id: number; activityId: string | null; inicio: string; fin: string; estado: string }[];
  /** relámpagos del producto en TikTok que NO nacieron de la cíclica y siguen vivas (la cadena arranca después de ellas) */
  ajenas: RelampagoDeProducto[];
  /** la relámpago más reciente del producto en TikTok, con su precio */
  ultimaEnTikTok: RelampagoDeProducto | null;
  /** si el modelo sigue con producto activo en TikTok */
  enTikTok: boolean;
}

/** Lo que hace falta para cruzar una cíclica con lo que TikTok ya tiene: el producto de cada modelo y las relámpagos por producto. */
export interface ContextoRelampagos {
  productoDeModelo: Map<string, string>;
  porProducto: Record<string, RelampagoDeProducto[]>;
}

function relampagosDelModelo(ctx: ContextoRelampagos | undefined, modelo: string): RelampagoDeProducto[] {
  const productId = ctx?.productoDeModelo.get(modelo);
  return productId ? (ctx?.porProducto[productId] ?? []) : [];
}

const ESTADOS_VENTANA_VIVA = ["creada", "parcial", "creando"];

async function ventanasVivasDeCiclicas(db: DB, accountId: string, ids: number[]) {
  if (!ids.length) return new Map<number, CiclicaGuardada["ventanas"]>();
  const { data, error } = await db
    .from("tiktok_promociones")
    .select("id, ciclico_id, activity_id, inicio, fin, estado")
    .eq("account_id", accountId)
    .in("ciclico_id", ids)
    .in("estado", ESTADOS_VENTANA_VIVA)
    .gt("fin", new Date().toISOString())
    .order("inicio", { ascending: true });
  if (error) throw new Error(error.message);
  const salida = new Map<number, CiclicaGuardada["ventanas"]>();
  for (const r of data ?? []) {
    const lista = salida.get(Number(r.ciclico_id)) ?? [];
    lista.push({ id: Number(r.id), activityId: r.activity_id ?? null, inicio: r.inicio, fin: r.fin, estado: r.estado });
    salida.set(Number(r.ciclico_id), lista);
  }
  return salida;
}

/** Las cíclicas de la cuenta (activas y pausadas) con sus ventanas vivas. */
export async function ciclicasGuardadas(db: DB, accountId: string, enTikTok?: Set<string>, ctx?: ContextoRelampagos): Promise<CiclicaGuardada[]> {
  const { data, error } = await db
    .from("tiktok_promociones_ciclicas")
    .select("id, modelo, precio, horas, tope_por_talla, tope_por_comprador, activo, ultimo_error, programado_en")
    .eq("account_id", accountId)
    .order("modelo", { ascending: true });
  if (error) throw new Error(error.message);
  const filas = data ?? [];
  const ventanas = await ventanasVivasDeCiclicas(db, accountId, filas.map((f: any) => Number(f.id)));
  return filas.map((f: any) => {
    const propias = ventanas.get(Number(f.id)) ?? [];
    const propiasIds = new Set(propias.map((v) => v.activityId).filter(Boolean));
    const enTikTokDelModelo = relampagosDelModelo(ctx, String(f.modelo));
    const ajenas = enTikTokDelModelo.filter(
      (r) => !propiasIds.has(r.activityId) && (r.estado === "ONGOING" || r.estado === "NOT_START") && r.fin && Date.parse(r.fin) > Date.now(),
    );
    return {
      id: Number(f.id),
      modelo: String(f.modelo),
      precio: Number(f.precio),
      horas: Number(f.horas),
      topePorTalla: Number(f.tope_por_talla),
      topePorComprador: Number(f.tope_por_comprador),
      activo: Boolean(f.activo),
      ultimoError: f.ultimo_error ?? null,
      programadoEn: f.programado_en ?? null,
      ventanas: propias,
      ajenas,
      ultimaEnTikTok: ultimaRelampago(enTikTokDelModelo),
      enTikTok: enTikTok ? enTikTok.has(String(f.modelo)) : true,
    };
  });
}

export interface PedidoCiclica {
  modelo: string;
  precio: number;
  horas?: number | null;
  topePorTalla?: number | null;
  topePorComprador?: number | null;
}

/**
 * Da de alta o corrige una cíclica. Un cambio de PRECIO se lleva también a
 * las ventanas ya programadas que no han empezado (TikTok deja editar los
 * productos de una actividad); la que ya corre se queda con su precio.
 * Luego se programan en el acto las ventanas que falten.
 */
export async function guardarCiclica(admin: any, accountId: string, pedido: PedidoCiclica, usuario: string | null): Promise<CiclicaGuardada> {
  const modelo = String(pedido.modelo ?? "").trim().toUpperCase();
  const precio = Math.round(Number(pedido.precio) * 100) / 100;
  if (!modelo) throw new Error("Falta el modelo.");
  if (!(precio > 0)) throw new Error("El precio tiene que ser mayor a cero.");
  const horas = horasDeCiclica(pedido.horas);
  const topes = { porTalla: topeParaTikTok(pedido.topePorTalla), porComprador: topeParaTikTok(pedido.topePorComprador) };
  const { modelos: catalogo } = await modelosParaOferta(admin, accountId);
  const producto = catalogo.find((m) => m.modelo === modelo);
  if (!producto) throw new Error(`El ${modelo} no tiene producto activo en TikTok.`);

  const { data: previa } = await admin
    .from("tiktok_promociones_ciclicas")
    .select("id, precio, tope_por_talla, tope_por_comprador")
    .eq("account_id", accountId)
    .eq("modelo", modelo)
    .maybeSingle();
  const { data: fila, error } = await admin
    .from("tiktok_promociones_ciclicas")
    .upsert(
      {
        account_id: accountId,
        modelo,
        precio,
        horas,
        tope_por_talla: topes.porTalla,
        tope_por_comprador: topes.porComprador,
        activo: true,
        ultimo_error: null,
        actualizado_en: new Date().toISOString(),
        creado_por: usuario,
      },
      { onConflict: "account_id,modelo" },
    )
    .select("id")
    .single();
  if (error || !fila) throw new Error(`No se pudo guardar la cíclica: ${error?.message ?? "sin id"}`);
  const id = Number(fila.id);

  // El precio (o los topes) nuevos a las ventanas que aún no empiezan.
  const cambio =
    previa && (Number(previa.precio) !== precio || Number(previa.tope_por_talla) !== topes.porTalla || Number(previa.tope_por_comprador) !== topes.porComprador);
  if (cambio) {
    const ventanas = (await ventanasVivasDeCiclicas(admin, accountId, [id])).get(id) ?? [];
    const porEmpezar = ventanas.filter((v) => v.activityId && Date.parse(v.inicio) > Date.now());
    if (porEmpezar.length) {
      const cliente = await clienteDeCuenta(admin, accountId, 120_000);
      if (!cliente?.tienda.shopCipher) throw new Error("TikTok Shop no está conectado.");
      const lotes = lotesDeProductos([{ modelo, productId: producto.productId, precio, skuIds: producto.skuIds }], topes);
      for (const v of porEmpezar) {
        try {
          for (const lote of lotes) await actualizarProductosDeActividad(cliente, String(v.activityId), lote);
          await admin
            .from("tiktok_promociones")
            .update({ modelos: [{ modelo, precio, productId: producto.productId, variantes: producto.skuIds.length }], tope_por_talla: topes.porTalla, tope_por_comprador: topes.porComprador })
            .eq("id", v.id);
        } catch (err) {
          await admin
            .from("tiktok_promociones_ciclicas")
            .update({ ultimo_error: `No se pudo cambiar el precio de la ventana ${v.activityId}: ${(err as Error).message}` })
            .eq("id", id);
        }
      }
      await invalidarApp(admin, accountId, "cíclica corregida", { claves: [CLAVE_CACHE_OFERTAS, CLAVE_CACHE_RELAMPAGOS] }).catch(() => undefined);
    }
  }

  await programarCiclicas(admin, accountId, { soloId: id, presupuestoMs: 150_000 });
  const [guardada] = (await ciclicasGuardadas(admin, accountId)).filter((c) => c.id === id);
  if (!guardada) throw new Error("La cíclica se guardó pero no se pudo releer.");
  return guardada;
}

/**
 * Quita una cíclica: deja de reponer ventanas y DESACTIVA en TikTok las que
 * todavía no empiezan. La que ya corre termina sola (los compradores ya la
 * ven con ese precio).
 */
export async function quitarCiclica(admin: any, accountId: string, id: number): Promise<{ desactivadas: number; errores: string[] }> {
  const { data: fila } = await admin
    .from("tiktok_promociones_ciclicas")
    .select("id")
    .eq("account_id", accountId)
    .eq("id", id)
    .maybeSingle();
  if (!fila) throw new Error("Esa cíclica no existe.");
  await admin.from("tiktok_promociones_ciclicas").update({ activo: false, actualizado_en: new Date().toISOString() }).eq("id", id);
  const ventanas = (await ventanasVivasDeCiclicas(admin, accountId, [id])).get(id) ?? [];
  const porEmpezar = ventanas.filter((v) => v.activityId && Date.parse(v.inicio) > Date.now());
  const errores: string[] = [];
  let desactivadas = 0;
  if (porEmpezar.length) {
    const cliente = await clienteDeCuenta(admin, accountId, 120_000);
    if (!cliente?.tienda.shopCipher) throw new Error("TikTok Shop no está conectado.");
    for (const v of porEmpezar) {
      try {
        const r = await desactivarActividad(cliente, String(v.activityId));
        await admin.from("tiktok_promociones").update({ estado: "desactivada", respuesta: { desactivada: r } }).eq("id", v.id);
        desactivadas++;
      } catch (err) {
        errores.push(`${v.activityId}: ${(err as Error).message}`);
      }
    }
    await invalidarApp(admin, accountId, "cíclica quitada", { claves: [CLAVE_CACHE_OFERTAS, CLAVE_CACHE_RELAMPAGOS] }).catch(() => undefined);
  }
  return { desactivadas, errores };
}

export interface ResultadoProgramacion {
  revisadas: number;
  creadas: number;
  errores: string[];
  sinTiempo: boolean;
}

/**
 * Repone las ventanas que falten a cada cíclica activa (`ventanasQueFaltan`
 * con las vivas de `tiktok_promociones`), una actividad por ventana, con
 * presupuesto de tiempo: lo que no alcance lo recoge la siguiente corrida
 * del cron. Un modelo que ya no tiene producto activo en TikTok se anota y
 * se salta; un error de TikTok queda en `ultimo_error` sin frenar a los
 * demás.
 */
export async function programarCiclicas(
  admin: any,
  accountId: string,
  opciones: { soloId?: number; presupuestoMs?: number } = {},
): Promise<ResultadoProgramacion> {
  const arranque = Date.now();
  const presupuesto = opciones.presupuestoMs ?? 240_000;
  const salida: ResultadoProgramacion = { revisadas: 0, creadas: 0, errores: [], sinTiempo: false };
  let consulta = admin
    .from("tiktok_promociones_ciclicas")
    .select("id, modelo, precio, horas, tope_por_talla, tope_por_comprador")
    .eq("account_id", accountId)
    .eq("activo", true)
    .order("programado_en", { ascending: true, nullsFirst: true });
  if (opciones.soloId) consulta = consulta.eq("id", opciones.soloId);
  const { data: ciclicas, error } = await consulta;
  if (error) throw new Error(error.message);
  if (!ciclicas?.length) return salida;
  const { modelos: catalogo } = await modelosParaOferta(admin, accountId);
  const porModelo = new Map(catalogo.map((m) => [m.modelo, m]));
  const vivas = await ventanasVivasDeCiclicas(admin, accountId, ciclicas.map((c: any) => Number(c.id)));
  // Lo que el producto YA tiene en TikTok (una relámpago a mano, como la del
  // GT148 hasta el 19-oct) cuenta como ventana viva: la cadena arranca
  // cuando termine, nunca encimada (dueño, 15-oct-2026).
  const enTikTok = await relampagosPorProducto(admin, accountId);
  if (enTikTok.error) salida.errores.push(`Relámpagos en TikTok: ${enTikTok.error}`);

  for (const c of ciclicas) {
    if (Date.now() - arranque > presupuesto) {
      salida.sinTiempo = true;
      break;
    }
    const id = Number(c.id);
    const modelo = String(c.modelo);
    salida.revisadas++;
    const anotar = (ultimo_error: string | null) =>
      admin
        .from("tiktok_promociones_ciclicas")
        .update({ ultimo_error, programado_en: new Date().toISOString() })
        .eq("id", id);
    if (!porModelo.has(modelo)) {
      await anotar(`El ${modelo} ya no tiene producto activo en TikTok: no se programó nada.`);
      salida.errores.push(`${modelo}: sin producto activo en TikTok`);
      continue;
    }
    const propias = vivas.get(id) ?? [];
    const propiasIds = new Set(propias.map((v) => v.activityId).filter(Boolean));
    const ajenas = (enTikTok.porProducto[porModelo.get(modelo)!.productId] ?? []).filter((r) => !propiasIds.has(r.activityId));
    const programadas = [...propias.map((v) => ({ inicio: new Date(v.inicio), fin: new Date(v.fin) })), ...ventanasVivasDeRelampagos(ajenas)];
    const faltan = ventanasQueFaltan(programadas, Number(c.horas));
    let errorDeEsta: string | null = null;
    for (const v of faltan) {
      if (Date.now() - arranque > presupuesto) {
        salida.sinTiempo = true;
        break;
      }
      try {
        const r = await crearOferta(
          admin,
          accountId,
          {
            ciclicoId: id,
            titulo: tituloDeCiclica(modelo, v.inicio),
            inicio: v.inicio.toISOString(),
            horas: Math.round((v.fin.getTime() - v.inicio.getTime()) / 3_600_000),
            nivel: "normal",
            topePorTalla: Number(c.tope_por_talla),
            topePorComprador: Number(c.tope_por_comprador),
            modelos: [{ modelo, precio: Number(c.precio) }],
          },
          null,
        );
        if (r.errores.length) {
          errorDeEsta = `TikTok rechazó los productos de «${r.titulo}»: ${r.errores.join(" | ")}`;
          break;
        }
        salida.creadas++;
      } catch (err) {
        errorDeEsta = `«${tituloDeCiclica(modelo, v.inicio)}»: ${(err as Error).message}`;
        break;
      }
    }
    if (errorDeEsta) salida.errores.push(`${modelo}: ${errorDeEsta}`);
    await anotar(errorDeEsta);
  }
  return salida;
}
