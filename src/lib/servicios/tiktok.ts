/**
 * TikTok Shop de punta a punta: pedidos, kardex y disponibilidad publicada.
 *
 * Este canal es ENVÍO PROPIO, y eso cambia todo respecto a Full y a FBA. Ahí
 * el marketplace guarda el stock y lo descuenta él; el ERP solo lee. Aquí el
 * almacén es nuestro, así que el ERP es el que LLEVA la cuenta y el que se la
 * dicta a TikTok. El ciclo completo, en una vuelta:
 *
 *   1. se bajan los pedidos que se movieron desde la última corrida;
 *   2. los que ya se enviaron generan su SALIDA en el kardex (una sola vez);
 *   3. los pagados sin enviar quedan APARTADOS (no bajan el saldo todavía);
 *   4. se recalcula el disponible = saldo - apartado;
 *   5. se le ESCRIBE ese disponible a TikTok, solo para lo que cambió.
 *
 * El paso 5 es el que hace que esto sirva: sin él el kardex sería un cuaderno
 * bonito y las publicaciones seguirían vendiendo pares que ya no existen.
 */
import { adquirirCandado, liberarCandado, traerTodo, type DB } from "../datos/repos";
import { configuracionIndusther, sincronizarInventarioIndusther } from "./industher";
import { sincronizarSaldoDesdeBodega, type ResultadoBodegaTikTok } from "./tiktok-bodega";
import { empujarSalidasAl3pl, registrarSalidasDeCorte } from "./tiktok-3pl";
import { agregarVentasDiarias } from "../tiktok/ventas";
import { indexarCatalogo } from "../etiquetas/resolver";
import { amarrarSkuTikTok } from "../tiktok/amarre";
import {
  bodegas,
  catalogo,
  enviarPaquete,
  etiquetaDePaquete,
  horariosDeRecoleccion,
  liquidacionDePedido,
  paquetesDePedido,
  pedidosActualizados,
  pedidosPorId,
  publicarStock,
  tiendasAutorizadas,
  type DiagnosticoPedidos,
  type OpcionesEnvio,
  type PedidoTikTok,
} from "../tiktok/api";
import {
  Cliente,
  configuracionTikTok,
  ErrorTikTok,
  tiendaTikTok,
  type CredencialesApp,
} from "../tiktok/client";
import {
  apartadosPorSku,
  disponibleParaCompradores,
  escriturasContraTikTok,
  movimientosPendientes,
  saldosDesdeMovimientos,
  type Movimiento,
  type RenglonPedido,
  type TipoMovimiento,
} from "../tiktok/kardex";

/**
 * Cuánto hacia atrás mira la primera sincronización de una tienda recién
 * conectada. Después de esa, se arranca desde donde quedó el cursor.
 */
const DIAS_PRIMERA_CORRIDA = 90;

/** Un traslape sobre el cursor, para no perder un pedido que se movió justo
 *  mientras corría la sincronización anterior. Repetirlo no cuesta: el
 *  kardex es idempotente por referencia. */
const TRASLAPE_MS = 10 * 60_000;

export interface MovimientoManual {
  sku: string;
  tipo: TipoMovimiento;
  cantidad: number;
  motivo?: string | null;
  referencia?: string | null;
  nota?: string | null;
  fecha?: string;
}

// ---------------------------------------------------------------------------
// El kardex, contra la base
// ---------------------------------------------------------------------------

/**
 * Registra movimientos y deja el saldo al día.
 *
 * El `onConflict ... ignoreDuplicates` junto con el índice único de la
 * migración es lo que impide el doble descuento: si dos corridas se enciman
 * y las dos ven el mismo pedido enviado, la segunda no inserta nada.
 */
export async function registrarMovimientos(
  db: DB,
  accountId: string,
  movs: MovimientoManual[],
  creadoPor?: string | null,
): Promise<{ registrados: number; skus: string[] }> {
  const filas = movs
    .filter((m) => m.sku && Number.isFinite(m.cantidad) && m.cantidad >= 0)
    .map((m) => ({
      account_id: accountId,
      sku: m.sku,
      tipo: m.tipo,
      cantidad: Math.round(m.cantidad),
      motivo: m.motivo ?? null,
      referencia: m.referencia ?? null,
      nota: m.nota ?? null,
      fecha: m.fecha ?? new Date().toISOString(),
      creado_por: creadoPor ?? null,
    }));

  if (!filas.length) return { registrados: 0, skus: [] };

  const { error } = await db
    .from("tiktok_movimientos")
    .upsert(filas, {
      onConflict: "account_id,tipo,referencia,sku",
      ignoreDuplicates: true,
    });
  if (error) throw new Error(`No se pudo registrar el movimiento: ${error.message}`);

  const skus = [...new Set(filas.map((f) => f.sku))];
  await recalcularSaldos(db, accountId, skus);
  return { registrados: filas.length, skus };
}

/**
 * Vuelve a sumar el kardex y deja `tiktok_inventario` al día.
 *
 * Se recalcula desde los movimientos en vez de ir sumando sobre el saldo
 * guardado a propósito: así un movimiento capturado con fecha vieja, o un
 * ajuste de conteo, acomodan el saldo solos, y nunca hay dos verdades.
 */
export async function recalcularSaldos(
  db: DB,
  accountId: string,
  soloEstosSkus?: string[],
): Promise<Map<string, number>> {
  const filtro = (q: any) => {
    const base = q.eq("account_id", accountId);
    return soloEstosSkus?.length ? base.in("sku", soloEstosSkus) : base;
  };

  const [movs, items] = await Promise.all([
    traerTodo<any>(db, "tiktok_movimientos", "sku, tipo, cantidad, fecha, id", filtro),
    traerTodo<any>(db, "tiktok_orden_items", "sku_interno, cantidad, estado", (q) =>
      q.eq("account_id", accountId),
    ),
  ]);

  const saldos = saldosDesdeMovimientos(
    (movs ?? []).map((m): Movimiento => ({
      sku: m.sku,
      tipo: m.tipo,
      cantidad: m.cantidad,
      fecha: m.fecha,
    })),
  );

  const apartados = apartadosPorSku(
    (items ?? []).map((i): RenglonPedido => ({
      orderId: "",
      skuInterno: i.sku_interno ?? null,
      cantidad: i.cantidad ?? 0,
      estado: i.estado ?? null,
    })),
  );

  // Un SKU con apartado pero sin movimientos también tiene que aparecer: es
  // justo el caso de "se vendió algo que no está capturado", y esconderlo
  // dejaría la falla invisible.
  const todos = new Set<string>([...saldos.keys()]);
  for (const sku of apartados.keys()) {
    if (!soloEstosSkus?.length || soloEstosSkus.includes(sku)) todos.add(sku);
  }

  const filas = [...todos].map((sku) => ({
    account_id: accountId,
    sku,
    saldo: saldos.get(sku) ?? 0,
    apartado: apartados.get(sku) ?? 0,
    actualizado_en: new Date().toISOString(),
  }));

  if (filas.length) {
    // `publicado` no va en el upsert: lo escribe solo quien publica de
    // verdad, para que un recálculo no finja que TikTok ya se enteró.
    const { error } = await db
      .from("tiktok_inventario")
      .upsert(filas, { onConflict: "account_id,sku" });
    if (error) throw new Error(`No se pudo guardar el saldo: ${error.message}`);
  }

  return saldos;
}

// ---------------------------------------------------------------------------
// Sincronización con TikTok
// ---------------------------------------------------------------------------

export interface ResultadoSync {
  conectado: boolean;
  /** la foto de la bodega TikTok en Industher, si el API ya la reporta */
  bodega: ResultadoBodegaTikTok | null;
  pedidos: number;
  salidas: number;
  devoluciones: number;
  skusCatalogo: number;
  sinAmarre: number;
  publicados: number;
  fallosPublicacion: number;
  avisos: string[];
}

const VACIO: ResultadoSync = {
  conectado: false,
  bodega: null,
  pedidos: 0,
  salidas: 0,
  devoluciones: 0,
  skusCatalogo: 0,
  sinAmarre: 0,
  publicados: 0,
  fallosPublicacion: 0,
  avisos: [],
};

/** Abre un cliente listo para hablar con TikTok, o null si no hay tienda. */
export async function clienteDeCuenta(
  admin: any,
  accountId: string,
  limiteMs = 280_000,
): Promise<Cliente | null> {
  const app = configuracionTikTok();
  if (!app) return null;

  const tienda = await tiendaTikTok(admin, accountId);
  if (!tienda) return null;

  return new Cliente(app, tienda, Date.now() + limiteMs, async (t) => {
    await admin
      .from("tiktok_tokens")
      .update({
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        expira_en: new Date(t.access_token_expire_in * 1000).toISOString(),
        refresh_expira_en: new Date(t.refresh_token_expire_in * 1000).toISOString(),
        actualizado_en: new Date().toISOString(),
      })
      .eq("account_id", accountId);
  });
}

/**
 * Una vuelta completa. Cada paso guarda lo suyo antes de pasar al siguiente:
 * si el API se cae a la mitad, lo ya bajado no se pierde y la próxima corrida
 * retoma desde el cursor.
 */
/**
 * El amarre TikTok -> ERP de una cuenta: catálogo real de MELI más los
 * amarres a mano. Se arma una vez por corrida y sirve a todo.
 */
async function amarradorDeCuenta(admin: any, accountId: string) {
  const [skusErp, mapeoRaw] = await Promise.all([
    traerTodo<any>(admin, "skus", "sku", (q) => q.eq("account_id", accountId).eq("activo", true)),
    traerTodo<any>(admin, "tiktok_mapeo_sku", "sku_tiktok, sku_interno", (q) =>
      q.eq("account_id", accountId),
    ),
  ]);
  const indice = indexarCatalogo(skusErp ?? []);
  const manual = new Map(
    (mapeoRaw ?? []).map((m: any) => [String(m.sku_tiktok).toUpperCase(), m.sku_interno]),
  );
  return (sellerSku: string | null) => amarrarSkuTikTok(sellerSku, indice, manual);
}

/**
 * Guarda pedidos y renglones, y lleva al kardex lo que ya salió. Es el mismo
 * camino para la corrida completa, para un aviso del webhook y para la
 * confirmación de envío desde el ERP: un solo lugar donde un pedido se
 * vuelve movimiento.
 */
async function procesarPedidos(
  admin: any,
  accountId: string,
  pedidos: PedidoTikTok[],
  amarrar: (s: string | null) => { skuInterno: string | null },
): Promise<{ salidas: number; devoluciones: number; sinAmarre: number }> {
  if (!pedidos.length) return { salidas: 0, devoluciones: 0, sinAmarre: 0 };

  await admin.from("tiktok_ordenes").upsert(
    pedidos.map((p) => ({
      account_id: accountId,
      order_id: p.orderId,
      estado: p.estado,
      fecha_creacion: p.creadoEn,
      fecha_actualizacion: p.actualizadoEn,
      fecha_envio: p.enviadoEn,
      total: p.total,
      moneda: p.moneda,
      paqueteria: p.paqueteria,
      guia: p.guia,
      shipping_type: p.shippingType,
      paquetes: p.paquetes,
      es_muestra: p.esMuestra,
      detalle: { destinatario: p.destinatario },
      sincronizado_en: new Date().toISOString(),
    })),
    { onConflict: "account_id,order_id" },
  );

  const renglones: RenglonPedido[] = [];
  const filasItems: any[] = [];
  let sinAmarre = 0;

  for (const p of pedidos) {
    for (const r of p.renglones) {
      const a = amarrar(r.sellerSku);
      if (!a.skuInterno) sinAmarre++;
      filasItems.push({
        account_id: accountId,
        line_item_id: r.lineItemId,
        order_id: p.orderId,
        sku_id: r.skuId,
        seller_sku: r.sellerSku,
        sku_interno: a.skuInterno,
        titulo: r.titulo,
        cantidad: r.cantidad,
        precio: r.precio,
        estado: r.estado,
      });
      renglones.push({
        orderId: p.orderId,
        skuInterno: a.skuInterno,
        cantidad: r.cantidad,
        estado: r.estado,
        fecha: p.enviadoEn ?? p.actualizadoEn ?? p.creadoEn,
      });
    }
  }

  await guardarEnLotes(admin, "tiktok_orden_items", filasItems, "account_id,line_item_id");

  const ordenIds = [...new Set(pedidos.map((p) => p.orderId))];
  const yaRegistrados = await referenciasRegistradas(admin, accountId, ordenIds);
  const { movimientos } = movimientosPendientes(renglones, yaRegistrados);

  if (movimientos.length) {
    await registrarMovimientos(
      admin,
      accountId,
      movimientos.map((m) => ({
        sku: m.sku,
        tipo: m.tipo,
        cantidad: m.cantidad,
        motivo: m.motivo,
        referencia: m.referencia,
        fecha: m.fecha,
      })),
    );
  }

  return {
    salidas: movimientos.filter((m) => m.tipo === "salida").length,
    devoluciones: movimientos.filter((m) => m.tipo === "devolucion").length,
    sinAmarre,
  };
}

/** El recurso del candado: una sola sincronización de TikTok por cuenta a la vez. */
const CANDADO_TIKTOK = "tiktok-sync";

/**
 * Corre una tarea con el candado de TikTok. Cron, webhook, botón y corte
 * pueden coincidir; el kardex aguanta (es idempotente), pero dos corridas
 * encimadas duplican llamadas a TikTok y pueden cruzar escrituras. Con
 * `esperarMs` la tarea espera un rato a que el candado se libere (el corte
 * y el webhook lo necesitan); sin él, se rinde de inmediato (el cron: la
 * siguiente corrida lo recoge).
 */
async function conCandadoTikTok<T>(
  admin: any,
  accountId: string,
  ttlSegundos: number,
  esperarMs: number,
  tarea: () => Promise<T>,
): Promise<T | null> {
  const limite = Date.now() + esperarMs;
  let token = await adquirirCandado(admin, accountId, CANDADO_TIKTOK, ttlSegundos);
  while (!token && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 2_000));
    token = await adquirirCandado(admin, accountId, CANDADO_TIKTOK, ttlSegundos);
  }
  if (!token) return null;
  try {
    return await tarea();
  } finally {
    await liberarCandado(admin, accountId, CANDADO_TIKTOK, token).catch(() => false);
  }
}

export interface ResultadoPedidosPorId {
  pedidos: number;
  salidas: number;
  devoluciones: number;
  publicados: number;
  avisos: string[];
  /** true si no se pudo correr porque otra sincronización tenía el candado */
  ocupado?: boolean;
}

/**
 * Pedidos concretos, de inmediato: lo que dispara un aviso de TikTok o una
 * confirmación de envío. Jala, mueve el kardex y republica. No toca el
 * catálogo ni Industher: eso lo hace la corrida completa.
 */
export async function sincronizarPedidosPorId(
  admin: any,
  accountId: string,
  ids: string[],
): Promise<ResultadoPedidosPorId> {
  const r = await conCandadoTikTok(admin, accountId, 120, 30_000, () =>
    sincronizarPedidosPorIdSinCandado(admin, accountId, ids),
  );
  return r ?? { pedidos: 0, salidas: 0, devoluciones: 0, publicados: 0, avisos: ["Otra sincronización de TikTok está en curso; se reintenta."], ocupado: true };
}

async function sincronizarPedidosPorIdSinCandado(
  admin: any,
  accountId: string,
  ids: string[],
): Promise<ResultadoPedidosPorId> {
  const cliente = await clienteDeCuenta(admin, accountId, 60_000);
  if (!cliente || !cliente.tienda.shopCipher) {
    return { pedidos: 0, salidas: 0, devoluciones: 0, publicados: 0, avisos: ["TikTok Shop no está conectado."] };
  }
  const avisos: string[] = [];
  const amarrar = await amarradorDeCuenta(admin, accountId);

  let pedidos: PedidoTikTok[] = [];
  try {
    pedidos = await pedidosPorId(cliente, [...new Set(ids)]);
  } catch (err) {
    avisos.push(`Pedidos: ${(err as Error).message}`);
  }

  const r = await procesarPedidos(admin, accountId, pedidos, amarrar);
  await recalcularSaldos(admin, accountId);
  if (pedidos.length) await reconstruirVentasDiarias(admin, accountId).catch(() => undefined);
  const pub = await publicarDisponibilidad(admin, accountId, cliente);
  avisos.push(...pub.avisos);

  return { pedidos: pedidos.length, salidas: r.salidas, devoluciones: r.devoluciones, publicados: pub.publicados, avisos };
}

export async function sincronizarTikTok(
  admin: any,
  accountId: string,
  opciones: { limiteMs?: number; soloPedidos?: boolean } = {},
): Promise<ResultadoSync> {
  // El botón y la captura a mano esperan un poco; el cron se rinde y vuelve
  // en 15 minutos.
  const r = await conCandadoTikTok(admin, accountId, 290, opciones.soloPedidos ? 30_000 : 0, () =>
    sincronizarTikTokSinCandado(admin, accountId, opciones),
  );
  return r ?? { ...VACIO, conectado: true, avisos: ["Otra sincronización de TikTok está en curso."] };
}

async function sincronizarTikTokSinCandado(
  admin: any,
  accountId: string,
  opciones: { limiteMs?: number; soloPedidos?: boolean } = {},
): Promise<ResultadoSync> {
  let cliente = await clienteDeCuenta(admin, accountId, opciones.limiteMs);
  if (!cliente) return { ...VACIO, avisos: ["TikTok Shop no está conectado."] };

  const avisos: string[] = [];
  const inicio = new Date().toISOString();

  // Si la conexión quedó a medias (sin cipher o sin bodega), se intenta
  // completar aquí con el token guardado. Sin cipher no vale la pena seguir:
  // todas las rutas de tienda contestarían 106013.
  if (!cliente.tienda.shopCipher || !cliente.tienda.warehouseId) {
    const r = await resolverTienda(admin, accountId);
    avisos.push(...r.avisos);
    cliente = (await clienteDeCuenta(admin, accountId, opciones.limiteMs)) ?? cliente;
    if (!cliente.tienda.shopCipher) {
      await admin.from("tiktok_sync_log").insert({
        account_id: accountId,
        tarea: "sincronizar",
        inicio,
        fin: new Date().toISOString(),
        estado: "sin tienda",
        detalle: { avisos },
      });
      return { ...VACIO, conectado: true, avisos };
    }
  }

  const amarrar = await amarradorDeCuenta(admin, accountId);

  // ---- 0. El saldo físico, desde la bodega TikTok de Industher ---------
  // Primero se refresca la foto del 3PL (si su API está configurado) y
  // luego se lleva al kardex. Si Industher falla, la foto anterior sigue
  // sirviendo: se avisa y lo demás continúa.
  let bodega: ResultadoBodegaTikTok | null = null;
  if (!opciones.soloPedidos && configuracionIndusther()) {
    try {
      await sincronizarInventarioIndusther(admin, accountId);
    } catch (err) {
      avisos.push(`Industher: ${(err as Error).message}`);
    }
  }
  if (!opciones.soloPedidos) try {
    bodega = await sincronizarSaldoDesdeBodega(admin, accountId);
    if (!bodega.almacen) {
      avisos.push("Industher todavía no reporta una bodega llamada TikTok.");
      bodega = null;
    }
  } catch (err) {
    avisos.push(`Bodega TikTok: ${(err as Error).message}`);
  }

  // ---- 1. Catálogo de TikTok -------------------------------------------
  let skusCatalogo = 0;
  if (!opciones.soloPedidos) try {
    const lista = await catalogo(cliente);
    skusCatalogo = lista.length;
    if (lista.length) {
      const filas = lista.map((s) => {
        const a = amarrar(s.sellerSku);
        return {
          account_id: accountId,
          sku_id: s.skuId,
          product_id: s.productId,
          seller_sku: s.sellerSku,
          titulo: s.titulo,
          talla: s.talla,
          precio: s.precio,
          estado: s.estado,
          sku_interno: a.skuInterno,
          origen_amarre: a.origen,
          // Lo que TikTok DICE tener. Contra esto se reconcilia.
          cantidad_tiktok: s.disponibleEnTikTok,
          activo: true,
          actualizado_en: new Date().toISOString(),
        };
      });
      await guardarEnLotes(admin, "tiktok_skus", filas, "account_id,sku_id");
    }
  } catch (err) {
    avisos.push(`Catálogo: ${(err as Error).message}`);
  }

  // ---- 1b. Renglones que se quedaron sin amarre --------------------------
  // Un SKU que no se pudo amarrar cuando llegó el pedido (un modelo que
  // MELI no tiene, un amarre a mano que se capturó después) se vuelve a
  // intentar aquí; si ahora sí, el pedido se reprocesa para que su salida
  // entre al kardex y, si ya está en un corte, se le mande al 3PL.
  let reamarrados = 0;
  if (!opciones.soloPedidos) try {
    reamarrados = await reamarrarPendientes(admin, accountId, cliente, amarrar);
  } catch (err) {
    avisos.push(`Re-amarre: ${(err as Error).message}`);
  }

  // ---- 2. Pedidos que se movieron ---------------------------------------
  const { data: estado } = await admin
    .from("tiktok_sync_estado")
    .select("cursor_ts")
    .eq("account_id", accountId)
    .eq("tarea", "pedidos")
    .maybeSingle();

  // Mientras la tabla de pedidos siga vacía se mira la ventana completa
  // aunque ya haya cursor: una primera corrida que no trajo nada (permisos a
  // medias, ventana corta) no debe dejar el cursor adelante para siempre.
  const { count: yaGuardados } = await admin
    .from("tiktok_ordenes")
    .select("order_id", { count: "exact", head: true })
    .eq("account_id", accountId);

  const desdeMs =
    estado?.cursor_ts && (yaGuardados ?? 0) > 0
      ? Date.parse(estado.cursor_ts) - TRASLAPE_MS
      : Date.now() - DIAS_PRIMERA_CORRIDA * 86_400_000;
  const hastaMs = Date.now();

  const diag: DiagnosticoPedidos = { totalCount: null, paginas: 0, llaves: [] };
  let pedidos: Awaited<ReturnType<typeof pedidosActualizados>> = [];
  try {
    pedidos = await pedidosActualizados(
      cliente,
      Math.floor(desdeMs / 1000),
      Math.floor(hastaMs / 1000),
      40,
      diag,
    );
  } catch (err) {
    avisos.push(`Pedidos: ${(err as Error).message}`);
  }

  const procesado = await procesarPedidos(admin, accountId, pedidos, amarrar);
  const { salidas, devoluciones, sinAmarre } = procesado;

  // Las ventas por día se rehacen en CADA corrida, traiga o no pedidos: si
  // solo se rehicieran con pedidos nuevos, una corrección (como la del día
  // en hora de México) esperaría hasta la siguiente venta para verse.
  try {
    await reconstruirVentasDiarias(admin, accountId);
  } catch (err) {
    avisos.push(`Ventas por día: ${(err as Error).message}`);
  }

  // ---- 3. Lo que TikTok liquida por cada pedido entregado -------------
  let liquidados = 0;
  if (!opciones.soloPedidos) try {
    liquidados = await liquidarPedidos(admin, accountId, cliente, avisos);
  } catch (err) {
    avisos.push(`Liquidaciones: ${(err as Error).message}`);
  }

  // El saldo se recalcula siempre, aunque no haya habido pedidos: los
  // apartados cambian con cada cancelación, y el disponible con ellos.
  await recalcularSaldos(admin, accountId);

  await admin.from("tiktok_sync_estado").upsert(
    {
      account_id: accountId,
      tarea: "pedidos",
      cursor_ts: new Date(hastaMs).toISOString(),
      datos: { pedidos: pedidos.length },
      actualizado_en: new Date().toISOString(),
    },
    { onConflict: "account_id,tarea" },
  );

  // ---- 4. Escribirle la disponibilidad a TikTok -------------------------
  const pub = await publicarDisponibilidad(admin, accountId, cliente);
  avisos.push(...pub.avisos);

  await admin.from("tiktok_sync_log").insert({
    account_id: accountId,
    tarea: "sincronizar",
    inicio,
    fin: new Date().toISOString(),
    estado: avisos.length ? "con avisos" : "ok",
    detalle: {
      pedidos: pedidos.length,
      salidas,
      devoluciones,
      publicados: pub.publicados,
      skusCatalogo,
      sinAmarre,
      liquidados,
      reamarrados,
      bodega,
      ventana: { desde: new Date(desdeMs).toISOString(), hasta: new Date(hastaMs).toISOString() },
      busquedaPedidos: diag,
      avisos,
    },
  });

  return {
    conectado: true,
    bodega,
    pedidos: pedidos.length,
    salidas,
    devoluciones,
    skusCatalogo,
    sinAmarre,
    publicados: pub.publicados,
    fallosPublicacion: pub.fallidos,
    avisos,
  };
}

// ---------------------------------------------------------------------------
// Publicar la disponibilidad. El corazón del asunto.
// ---------------------------------------------------------------------------

export interface ResultadoPublicar {
  publicados: number;
  fallidos: number;
  sinProducto: number;
  avisos: string[];
}

/**
 * Le escribe a TikTok el disponible de cada SKU que cambió.
 *
 * Solo se manda la diferencia contra lo último confirmado (`publicado`), no
 * el catálogo entero: son cientos de SKUs y el API cobra por producto. Lo que
 * falle no se marca como publicado, así que la siguiente corrida lo reintenta
 * solo — el disponible se recalcula del kardex cada vez y nunca se pierde.
 */
export async function publicarDisponibilidad(
  admin: any,
  accountId: string,
  clienteDado?: Cliente | null,
): Promise<ResultadoPublicar> {
  const cliente = clienteDado ?? (await clienteDeCuenta(admin, accountId));
  if (!cliente) {
    return { publicados: 0, fallidos: 0, sinProducto: 0, avisos: ["TikTok Shop no está conectado."] };
  }
  if (!cliente.tienda.warehouseId) {
    return {
      publicados: 0,
      fallidos: 0,
      sinProducto: 0,
      avisos: ["Falta elegir la bodega de TikTok: sin ella el API no acepta existencias."],
    };
  }

  const [inv, skusTikTok, contados] = await Promise.all([
    traerTodo<any>(admin, "tiktok_inventario", "sku, saldo, apartado, publicado", (q) =>
      q.eq("account_id", accountId),
    ),
    traerTodo<any>(admin, "tiktok_skus", "sku_id, product_id, sku_interno, cantidad_tiktok", (q) =>
      q.eq("account_id", accountId).eq("activo", true),
    ),
    skusContados(admin, accountId),
  ]);

  // SEGURO: solo se le escribe a TikTok un SKU que alguna vez se CONTÓ (una
  // entrada o un ajuste). Un SKU que solo tiene salidas —vendió antes de que
  // se capturara su existencia— tendría saldo negativo y disponible 0, y
  // publicarle 0 apagaría una publicación que TikTok sí estaba vendiendo.
  // Hasta que se cuente, TikTok se queda con su propio número.
  const disponibles = new Map<string, number>();
  for (const r of inv ?? []) {
    if (!contados.has(r.sku)) continue;
    disponibles.set(r.sku, disponibleParaCompradores(r.saldo, r.apartado));
  }

  // Se compara contra lo que TikTok DICE tener (cantidad_tiktok, del
  // catálogo), no contra lo último que escribimos: si alguien editó el stock
  // en el Seller Center, aquí se corrige.
  const escrituras = escriturasContraTikTok(
    (skusTikTok ?? [])
      .filter((s: any) => s.sku_interno && s.product_id)
      .map((s: any) => ({
        skuId: s.sku_id,
        productId: s.product_id,
        skuInterno: s.sku_interno,
        cantidadTikTok: s.cantidad_tiktok ?? null,
      })),
    disponibles,
  );

  const conPublicacion = new Set((skusTikTok ?? []).map((s: any) => s.sku_interno).filter(Boolean));
  const sinProducto = [...disponibles.keys()].filter((sku) => !conPublicacion.has(sku)).length;

  if (!escrituras.length) {
    return {
      publicados: 0,
      fallidos: 0,
      sinProducto,
      avisos: sinProducto
        ? [`${sinProducto} SKU con existencia no tienen publicación en TikTok.`]
        : [],
    };
  }

  const res = await publicarStock(
    cliente,
    cliente.tienda.warehouseId,
    escrituras.map((e) => ({ productId: e.productId, skuId: e.skuId, cantidad: e.a })),
  );

  // Solo se da por escrito lo que TikTok aceptó de verdad: cantidad_tiktok
  // queda igual al número que se mandó, y `publicado` en el inventario.
  const fallados = new Set(res.fallidos.map((f) => f.skuId));
  const ahora = new Date().toISOString();
  const okSkus = escrituras.filter((e) => !fallados.has(e.skuId));

  if (okSkus.length) {
    await guardarEnLotes(
      admin,
      "tiktok_skus",
      okSkus.map((e) => ({ account_id: accountId, sku_id: e.skuId, cantidad_tiktok: e.a })),
      "account_id,sku_id",
    );
    const porInterno = new Map<string, number>();
    for (const e of okSkus) porInterno.set(e.skuInterno, e.a);
    await guardarEnLotes(
      admin,
      "tiktok_inventario",
      [...porInterno].map(([sku, cantidad]) => ({
        account_id: accountId,
        sku,
        publicado: cantidad,
        publicado_en: ahora,
      })),
      "account_id,sku",
    );
  }

  const avisos: string[] = [];
  if (res.fallidos.length) {
    avisos.push(`TikTok rechazó ${res.fallidos.length} SKU: ${res.fallidos[0].error}`);
  }
  if (sinProducto) avisos.push(`${sinProducto} SKU con existencia no tienen publicación en TikTok.`);

  return { publicados: okSkus.length, fallidos: res.fallidos.length, sinProducto, avisos };
}

// ---------------------------------------------------------------------------
// Envío desde el ERP y avisos de TikTok
// ---------------------------------------------------------------------------

export interface ResultadoEnvio {
  paquetes: string[];
  salidas: number;
  publicados: number;
  avisos: string[];
}

/**
 * Confirma en TikTok el envío de un pedido y descuenta en el mismo acto.
 *
 * TikTok envía por paquete: se confirman todos los del pedido y en seguida
 * se vuelve a leer el pedido, que ya viene en AWAITING_COLLECTION, y eso es
 * lo que genera la salida en el kardex y la republicación. Si TikTok rechaza
 * el envío (dirección, guía, paquete ya enviado), el mensaje llega tal cual.
 */
export async function confirmarEnvio(
  admin: any,
  accountId: string,
  orderId: string,
  opciones: OpcionesEnvio,
): Promise<ResultadoEnvio> {
  const cliente = await clienteDeCuenta(admin, accountId, 60_000);
  if (!cliente || !cliente.tienda.shopCipher) {
    throw new Error("TikTok Shop no está conectado.");
  }

  const paquetes = await paquetesDePedido(cliente, orderId);
  if (!paquetes.length) {
    throw new Error("TikTok no tiene ningún paquete para este pedido; no se puede confirmar el envío.");
  }

  for (const p of paquetes) {
    let horario = opciones.horario ?? null;
    if (opciones.handover === "PICKUP" && !horario) {
      try {
        const lista = await horariosDeRecoleccion(cliente, p.id);
        horario = lista.sort((a, b) => a.inicio - b.inicio).find((h) => h.fin > Date.now() / 1000) ?? lista[0] ?? null;
      } catch {
        horario = null;
      }
    }
    await enviarPaquete(cliente, p.id, { ...opciones, horario });
  }

  const r = await sincronizarPedidosPorId(admin, accountId, [orderId]);

  await admin.from("tiktok_sync_log").insert({
    account_id: accountId,
    tarea: "enviar",
    inicio: new Date().toISOString(),
    fin: new Date().toISOString(),
    estado: r.avisos.length ? "con avisos" : "ok",
    detalle: { orderId, paquetes: paquetes.map((p) => p.id), opciones, ...r },
  });

  return { paquetes: paquetes.map((p) => p.id), salidas: r.salidas, publicados: r.publicados, avisos: r.avisos };
}

/** La guía en PDF del primer paquete del pedido. */
export async function etiquetaDePedido(admin: any, accountId: string, orderId: string): Promise<string | null> {
  const cliente = await clienteDeCuenta(admin, accountId, 60_000);
  if (!cliente || !cliente.tienda.shopCipher) return null;
  const paquetes = await paquetesDePedido(cliente, orderId);
  if (!paquetes.length) return null;
  return etiquetaDePaquete(cliente, paquetes[0].id);
}

/**
 * Procesa los avisos de TikTok que siguen sin atender: jala esos pedidos,
 * mueve el kardex y republica. Idempotente: un aviso repetido no descuenta
 * dos veces (índice único del kardex) y se marca procesado igual.
 */
export async function procesarWebhooksPendientes(
  admin: any,
  accountId: string,
): Promise<{ avisos: number; pedidos: number; salidas: number; publicados: number }> {
  const { data: pendientes } = await admin
    .from("tiktok_webhooks")
    .select("id, order_id")
    .eq("account_id", accountId)
    .is("procesado_en", null)
    .order("recibido_en", { ascending: true })
    .limit(100);

  const lista = (pendientes ?? []) as { id: number; order_id: string | null }[];
  if (!lista.length) return { avisos: 0, pedidos: 0, salidas: 0, publicados: 0 };

  const ids = [...new Set(lista.map((w) => w.order_id).filter(Boolean))] as string[];
  let r: ResultadoPedidosPorId = { pedidos: 0, salidas: 0, devoluciones: 0, publicados: 0, avisos: [] };
  let error: string | null = null;
  try {
    if (ids.length) r = await sincronizarPedidosPorId(admin, accountId, ids);
  } catch (err) {
    error = (err as Error).message;
  }

  // Si otra corrida tenía el candado, los avisos se quedan sin procesar y
  // los recoge la siguiente (el cron drena los pendientes).
  if (r.ocupado) return { avisos: lista.length, pedidos: 0, salidas: 0, publicados: 0 };

  await admin
    .from("tiktok_webhooks")
    .update({ procesado_en: new Date().toISOString(), error })
    .in("id", lista.map((w) => w.id));

  return { avisos: lista.length, pedidos: r.pedidos, salidas: r.salidas, publicados: r.publicados };
}

// ---------------------------------------------------------------------------
// Conexión de la tienda
// ---------------------------------------------------------------------------

export interface TiendaResuelta {
  shopId: string | null;
  bodega: string | null;
  avisos: string[];
}

/**
 * Resuelve lo que la tienda necesita para operar: su `shop_cipher` y su
 * bodega. Sin el cipher las rutas de tienda contestan 105002 / 106013; sin
 * la bodega no se puede escribir existencia.
 *
 * Va aparte de la autorización a propósito: si la primera vez falló (la app
 * sin permisos, TikTok caído), la sincronización lo vuelve a intentar sola
 * con el token que ya está guardado, en vez de exigir volver a autorizar
 * para algo que no depende de la autorización.
 */
export async function resolverTienda(admin: any, accountId: string): Promise<TiendaResuelta> {
  const avisos: string[] = [];
  let shopId: string | null = null;
  let cipher: string | null = null;
  let bodega: string | null = null;

  const sinCipher = await clienteDeCuenta(admin, accountId, 60_000);
  if (!sinCipher) return { shopId, bodega, avisos: ["TikTok Shop no está conectado."] };

  try {
    const tiendas = await tiendasAutorizadas(sinCipher);
    const t = tiendas[0];
    if (t) {
      shopId = t.id;
      cipher = t.cipher;
      await admin
        .from("tiktok_tienda")
        .update({
          shop_id: t.id,
          shop_cipher: t.cipher,
          nombre: t.nombre,
          region: t.region ?? "MX",
          actualizado_en: new Date().toISOString(),
        })
        .eq("account_id", accountId);
    } else {
      avisos.push("La app quedó autorizada pero TikTok no reporta ninguna tienda.");
    }
  } catch (err) {
    avisos.push(`No se pudo leer la tienda: ${(err as Error).message}`);
  }

  if (cipher) {
    try {
      // Cliente nuevo: ya con el cipher recién guardado.
      const conCipher = await clienteDeCuenta(admin, accountId, 60_000);
      const lista = conCipher ? await bodegas(conCipher) : [];
      // La predeterminada, y si no hay, la primera.
      bodega = (lista.find((b) => b.predeterminada) ?? lista[0])?.id ?? null;
      if (bodega) {
        await admin.from("tiktok_tienda").update({ warehouse_id: bodega }).eq("account_id", accountId);
      } else {
        avisos.push("TikTok no reporta bodegas: hay que darla de alta en el centro de vendedores.");
      }
    } catch (err) {
      avisos.push(`No se pudo leer la bodega: ${(err as Error).message}`);
    }
  }

  return { shopId, bodega, avisos };
}

/**
 * Después de autorizar: guarda los tokens, deja la tienda activa y resuelve
 * cipher y bodega. Cada intento queda en la bitácora con sus avisos, porque
 * el mensaje de la pantalla se pierde en cuanto se recarga y "no funciona"
 * sin ese dato es imposible de seguir.
 */
export async function completarConexion(
  admin: any,
  accountId: string,
  _app: CredencialesApp,
  tokens: { access_token: string; refresh_token: string; access_token_expire_in: number; refresh_token_expire_in: number },
): Promise<TiendaResuelta> {
  const inicio = new Date().toISOString();

  await admin.from("tiktok_tokens").upsert(
    {
      account_id: accountId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expira_en: new Date(tokens.access_token_expire_in * 1000).toISOString(),
      refresh_expira_en: new Date(tokens.refresh_token_expire_in * 1000).toISOString(),
      actualizado_en: new Date().toISOString(),
    },
    { onConflict: "account_id" },
  );

  await admin.from("tiktok_tienda").upsert(
    { account_id: accountId, activo: true, actualizado_en: new Date().toISOString() },
    { onConflict: "account_id" },
  );

  const r = await resolverTienda(admin, accountId);

  await admin.from("tiktok_sync_log").insert({
    account_id: accountId,
    tarea: "conectar",
    inicio,
    fin: new Date().toISOString(),
    estado: r.avisos.length ? "con avisos" : "ok",
    detalle: { shopId: r.shopId, bodega: r.bodega, avisos: r.avisos },
  });

  return r;
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

/** Los SKUs con al menos una entrada o un ajuste: los que alguien ya contó. */
export async function skusContados(db: DB, accountId: string): Promise<Set<string>> {
  const filas = await traerTodo<any>(db, "tiktok_movimientos", "sku, tipo, id", (q) =>
    q.eq("account_id", accountId).in("tipo", ["entrada", "ajuste"]),
  );
  return new Set((filas ?? []).map((f: any) => f.sku as string));
}

/** Las referencias que el kardex YA tiene, como `tipo|referencia|sku`. */
async function referenciasRegistradas(
  db: DB,
  accountId: string,
  ordenIds: string[],
): Promise<Set<string>> {
  const claves = new Set<string>();
  const PASO = 200;

  for (let i = 0; i < ordenIds.length; i += PASO) {
    const { data } = await db
      .from("tiktok_movimientos")
      .select("tipo, referencia, sku")
      .eq("account_id", accountId)
      .in("referencia", ordenIds.slice(i, i + PASO));
    for (const m of data ?? []) claves.add(`${m.tipo}|${m.referencia}|${m.sku}`);
  }
  return claves;
}

/**
 * Ventas por SKU y día, reconstruidas COMPLETAS desde los pedidos guardados.
 *
 * Antes se acumulaban por ventana de sincronización y con el día en UTC:
 * una corrida de 15 minutos pisaba el renglón del día con lo poco que veía,
 * y un pedido de la noche caía en el día siguiente. Ahora se rehace todo
 * (unos cientos de pedidos al mes) con el día de México, y lo que ya no
 * corresponde se borra.
 */
export async function reconstruirVentasDiarias(db: DB, accountId: string): Promise<number> {
  const eq = (q: any) => q.eq("account_id", accountId);
  const [ordenes, items, actuales] = await Promise.all([
    traerTodo<any>(db, "tiktok_ordenes", "order_id, estado, fecha_creacion, fecha_actualizacion, es_muestra", eq),
    traerTodo<any>(db, "tiktok_orden_items", "order_id, sku_interno, cantidad, precio, estado", eq),
    traerTodo<any>(db, "tiktok_ventas_diarias", "sku, fecha", eq),
  ]);

  const ventas = agregarVentasDiarias(
    (ordenes ?? []).map((o: any) => ({
      orderId: o.order_id,
      estado: o.estado,
      creadoEn: o.fecha_creacion,
      actualizadoEn: o.fecha_actualizacion,
      esMuestra: Boolean(o.es_muestra),
    })),
    (items ?? []).map((i: any) => ({
      orderId: i.order_id,
      skuInterno: i.sku_interno ?? null,
      cantidad: i.cantidad ?? 0,
      precio: i.precio != null ? Number(i.precio) : null,
      estado: i.estado ?? null,
    })),
  );

  if (ventas.length) {
    await guardarEnLotes(
      db,
      "tiktok_ventas_diarias",
      ventas.map((v) => ({ account_id: accountId, ...v })),
      "account_id,sku,fecha",
    );
  }

  // Lo que ya no sale de los pedidos (un día en UTC de antes, un pedido
  // cancelado después) se borra: la tabla dice lo mismo que los pedidos.
  const vigentes = new Set(ventas.map((v) => `${v.sku}|${v.fecha}`));
  const sobrantes = (actuales ?? []).filter((a: any) => !vigentes.has(`${a.sku}|${a.fecha}`));
  for (const a of sobrantes) {
    await db.from("tiktok_ventas_diarias").delete().eq("account_id", accountId).eq("sku", a.sku).eq("fecha", a.fecha);
  }

  return ventas.length;
}

/**
 * Vuelve a amarrar los renglones de pedido que quedaron sin SKU interno.
 * Los que ahora sí amarran se reprocesan por id (kardex idempotente) y, si
 * su pedido ya salió en un corte, sus salidas se registran y se empujan al
 * 3PL. Devuelve cuántos renglones se resolvieron.
 */
export async function reamarrarPendientes(
  db: DB,
  accountId: string,
  cliente: Cliente,
  amarrar: (s: string | null) => { skuInterno: string | null },
): Promise<number> {
  const pendientes = await traerTodo<any>(db, "tiktok_orden_items", "line_item_id, order_id, seller_sku", (q) =>
    q.eq("account_id", accountId).is("sku_interno", null).not("seller_sku", "is", null),
  );
  const ordenes = new Set<string>();
  let resueltos = 0;
  for (const it of pendientes ?? []) {
    const a = amarrar(it.seller_sku);
    if (!a.skuInterno) continue;
    ordenes.add(it.order_id);
    resueltos++;
  }
  if (!ordenes.size) return 0;

  // Reprocesar los pedidos: procesarPedidos vuelve a escribir los renglones
  // (ya con SKU) y lleva al kardex lo que falte. El índice único evita
  // descontar dos veces lo que ya estaba.
  const ids = [...ordenes];
  const pedidos = await pedidosPorId(cliente, ids);
  await procesarPedidos(db, accountId, pedidos, amarrar);

  // Los que ya están en un corte: sus salidas al 3PL, que en su momento no
  // se pudieron registrar porque no tenían SKU.
  const { data: enCorte } = await db
    .from("tiktok_ordenes")
    .select("order_id, corte_id")
    .eq("account_id", accountId)
    .in("order_id", ids)
    .not("corte_id", "is", null);
  const cortes = new Set<number>();
  for (const o of (enCorte ?? []) as { order_id: string; corte_id: number }[]) {
    const { data: items } = await db
      .from("tiktok_orden_items")
      .select("sku_interno, cantidad")
      .eq("account_id", accountId)
      .eq("order_id", o.order_id)
      .not("sku_interno", "is", null);
    const porSku = new Map<string, number>();
    for (const i of (items ?? []) as { sku_interno: string; cantidad: number }[]) {
      porSku.set(i.sku_interno, (porSku.get(i.sku_interno) ?? 0) + (i.cantidad ?? 0));
    }
    await registrarSalidasDeCorte(
      db,
      accountId,
      o.corte_id,
      [...porSku].map(([sku, pares]) => ({ orderId: o.order_id, sku, pares })),
    );
    cortes.add(o.corte_id);
  }
  for (const c of cortes) await empujarSalidasAl3pl(db, accountId, c).catch(() => undefined);

  return resueltos;
}

/** Estados en los que TikTok ya puede haber liquidado el pedido. */
const ESTADOS_LIQUIDABLES = ["DELIVERED", "COMPLETED"];
/** Cuántos pedidos se le preguntan a finanzas por corrida (una llamada cada uno). */
const LIQUIDACIONES_POR_CORRIDA = 25;
/** Un pedido sin liquidar se vuelve a preguntar cada día, no cada 15 min. */
const REINTENTO_LIQUIDACION_MS = 24 * 3_600_000;

/**
 * Pregunta a finanzas de TikTok cuánto liquidó por cada pedido entregado
 * que todavía no tiene neto. Las muestras no se preguntan (liquidan 0). Si
 * TikTok contesta que no hay permiso, se avisa una vez y se deja de
 * insistir en esta corrida.
 */
export async function liquidarPedidos(db: DB, accountId: string, cliente: Cliente, avisos: string[]): Promise<number> {
  const limite = new Date(Date.now() - REINTENTO_LIQUIDACION_MS).toISOString();
  const { data } = await db
    .from("tiktok_ordenes")
    .select("order_id, liquidacion_intento_en")
    .eq("account_id", accountId)
    .eq("es_muestra", false)
    .in("estado", ESTADOS_LIQUIDABLES)
    .is("neto_recibido", null)
    .or(`liquidacion_intento_en.is.null,liquidacion_intento_en.lt.${limite}`)
    .order("fecha_creacion", { ascending: true })
    .limit(LIQUIDACIONES_POR_CORRIDA);
  const pendientes = (data ?? []) as { order_id: string }[];
  let liquidados = 0;
  for (const p of pendientes) {
    if (cliente.msRestantes() < 10_000) break;
    const ahora = new Date().toISOString();
    try {
      const liq = await liquidacionDePedido(cliente, p.order_id);
      await db
        .from("tiktok_ordenes")
        .update(
          liq
            ? { neto_recibido: liq.neto, liquidado_en: ahora, liquidacion: liq.crudo, liquidacion_intento_en: ahora }
            : { liquidacion_intento_en: ahora },
        )
        .eq("account_id", accountId)
        .eq("order_id", p.order_id);
      if (liq) liquidados++;
    } catch (err) {
      await db.from("tiktok_ordenes").update({ liquidacion_intento_en: ahora }).eq("account_id", accountId).eq("order_id", p.order_id);
      const e = err as ErrorTikTok;
      // Sin permiso de finanzas (o ruta que no existe): no tiene caso seguir
      // pedido por pedido. Se dice una vez.
      if (e instanceof ErrorTikTok && (e.codigo === 105005 || e.codigo === 105002 || e.codigo === 404)) {
        avisos.push(`Finanzas de TikTok: ${e.message}. Falta el permiso de finanzas en la app o volver a autorizar la tienda.`);
        break;
      }
      avisos.push(`Liquidación ${p.order_id}: ${(err as Error).message}`);
    }
  }
  return liquidados;
}

/** Supabase se atraganta con upserts enormes; se mandan de 500 en 500. */
async function guardarEnLotes(
  db: DB,
  tabla: string,
  filas: any[],
  onConflict: string,
): Promise<void> {
  const PASO = 500;
  for (let i = 0; i < filas.length; i += PASO) {
    const { error } = await db.from(tabla).upsert(filas.slice(i, i + PASO), { onConflict });
    if (error) throw new Error(`${tabla}: ${error.message}`);
  }
}

export { ErrorTikTok };
