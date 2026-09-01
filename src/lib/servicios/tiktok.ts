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
import { traerTodo, type DB } from "../datos/repos";
import { configuracionIndusther, sincronizarInventarioIndusther } from "./industher";
import { sincronizarSaldoDesdeBodega, type ResultadoBodegaTikTok } from "./tiktok-bodega";
import { indexarCatalogo } from "../etiquetas/resolver";
import { amarrarSkuTikTok } from "../tiktok/amarre";
import {
  bodegas,
  catalogo,
  pedidosActualizados,
  publicarStock,
  tiendasAutorizadas,
  type DiagnosticoPedidos,
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
  cambiosAPublicar,
  disponibleParaCompradores,
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
export async function sincronizarTikTok(
  admin: any,
  accountId: string,
  opciones: { limiteMs?: number } = {},
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

  // El catálogo del ERP, para amarrar. Se lee una vez y sirve a todo.
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
  const amarrar = (sellerSku: string | null) => amarrarSkuTikTok(sellerSku, indice, manual);

  // ---- 0. El saldo físico, desde la bodega TikTok de Industher ---------
  // Primero se refresca la foto del 3PL (si su API está configurado) y
  // luego se lleva al kardex. Si Industher falla, la foto anterior sigue
  // sirviendo: se avisa y lo demás continúa.
  let bodega: ResultadoBodegaTikTok | null = null;
  if (configuracionIndusther()) {
    try {
      await sincronizarInventarioIndusther(admin, accountId);
    } catch (err) {
      avisos.push(`Industher: ${(err as Error).message}`);
    }
  }
  try {
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
  try {
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
          activo: true,
          actualizado_en: new Date().toISOString(),
        };
      });
      await guardarEnLotes(admin, "tiktok_skus", filas, "account_id,sku_id");
    }
  } catch (err) {
    avisos.push(`Catálogo: ${(err as Error).message}`);
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

  let sinAmarre = 0;
  let salidas = 0;
  let devoluciones = 0;

  if (pedidos.length) {
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
        sincronizado_en: new Date().toISOString(),
      })),
      { onConflict: "account_id,order_id" },
    );

    const renglones: RenglonPedido[] = [];
    const filasItems: any[] = [];

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

    // ---- 3. Del pedido al kardex ---------------------------------------
    const ordenIds = [...new Set(pedidos.map((p) => p.orderId))];
    const yaRegistrados = await referenciasRegistradas(admin, accountId, ordenIds);
    const { movimientos } = movimientosPendientes(renglones, yaRegistrados);

    salidas = movimientos.filter((m) => m.tipo === "salida").length;
    devoluciones = movimientos.filter((m) => m.tipo === "devolucion").length;

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

    await recalcularVentasDiarias(admin, accountId, pedidos, amarrar);
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
    traerTodo<any>(admin, "tiktok_skus", "sku_id, product_id, sku_interno", (q) =>
      q.eq("account_id", accountId).eq("activo", true),
    ),
    skusContados(admin, accountId),
  ]);

  // SEGURO: solo se le escribe a TikTok un SKU que alguna vez se CONTÓ (una
  // entrada o un ajuste). Un SKU que solo tiene salidas —vendió antes de que
  // se capturara su existencia— tendría saldo negativo y disponible 0, y
  // publicarle 0 apagaría una publicación que TikTok sí estaba vendiendo.
  // Hasta que se cuente, TikTok se queda con su propio número.
  const cambios = cambiosAPublicar(
    (inv ?? []).filter((r: any) => contados.has(r.sku)).map((r: any) => ({
      sku: r.sku,
      saldo: r.saldo,
      apartado: r.apartado,
      disponible: disponibleParaCompradores(r.saldo, r.apartado),
      publicado: r.publicado ?? null,
    })),
  );

  // Un SKU interno puede estar en varias publicaciones de TikTok; todas
  // tienen que recibir el mismo número.
  const porSkuInterno = new Map<string, { skuId: string; productId: string }[]>();
  for (const s of skusTikTok ?? []) {
    if (!s.sku_interno || !s.product_id) continue;
    const lista = porSkuInterno.get(s.sku_interno);
    const dato = { skuId: s.sku_id, productId: s.product_id };
    if (lista) lista.push(dato);
    else porSkuInterno.set(s.sku_interno, [dato]);
  }

  const aEscribir: { productId: string; skuId: string; cantidad: number; sku: string }[] = [];
  let sinProducto = 0;
  for (const c of cambios) {
    const destinos = porSkuInterno.get(c.sku);
    if (!destinos?.length) {
      sinProducto++;
      continue;
    }
    for (const d of destinos) {
      aEscribir.push({ productId: d.productId, skuId: d.skuId, cantidad: c.a, sku: c.sku });
    }
  }

  if (!aEscribir.length) {
    return {
      publicados: 0,
      fallidos: 0,
      sinProducto,
      avisos: sinProducto
        ? [`${sinProducto} SKU con existencia no tienen publicación en TikTok.`]
        : [],
    };
  }

  const res = await publicarStock(cliente, cliente.tienda.warehouseId, aEscribir);

  // Solo se marca como publicado lo que TikTok aceptó de verdad.
  const fallados = new Set(res.fallidos.map((f) => f.skuId));
  const confirmados = new Map<string, number>();
  for (const e of aEscribir) {
    if (fallados.has(e.skuId)) continue;
    confirmados.set(e.sku, e.cantidad);
  }

  if (confirmados.size) {
    const ahora = new Date().toISOString();
    await guardarEnLotes(
      admin,
      "tiktok_inventario",
      [...confirmados].map(([sku, cantidad]) => ({
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

  return { publicados: confirmados.size, fallidos: res.fallidos.length, sinProducto, avisos };
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

/** Ventas por SKU y día, para que TikTok entre a la vista de canales. */
async function recalcularVentasDiarias(
  db: DB,
  accountId: string,
  pedidos: Awaited<ReturnType<typeof pedidosActualizados>>,
  amarrar: (s: string | null) => { skuInterno: string | null },
): Promise<void> {
  // Un pedido cuenta como venta desde que se paga; solo se descartan los
  // que nunca llegaron a pagarse y los cancelados.
  const NO_CUENTAN = new Set(["UNPAID", "CANCELLED", "CANCEL"]);
  const acumulado = new Map<string, { unidades: number; ordenes: Set<string>; importe: number }>();

  for (const p of pedidos) {
    if (NO_CUENTAN.has(p.estado.toUpperCase())) continue;
    const fecha = (p.creadoEn ?? p.actualizadoEn)?.slice(0, 10);
    if (!fecha) continue;

    for (const r of p.renglones) {
      if (NO_CUENTAN.has(String(r.estado ?? "").toUpperCase())) continue;
      const sku = amarrar(r.sellerSku).skuInterno;
      if (!sku) continue;
      const clave = `${sku}|${fecha}`;
      const acc = acumulado.get(clave) ?? { unidades: 0, ordenes: new Set<string>(), importe: 0 };
      acc.unidades += r.cantidad;
      acc.ordenes.add(p.orderId);
      acc.importe += (r.precio ?? 0) * r.cantidad;
      acumulado.set(clave, acc);
    }
  }

  if (!acumulado.size) return;

  const filas = [...acumulado].map(([clave, acc]) => {
    const [sku, fecha] = clave.split("|");
    return {
      account_id: accountId,
      sku,
      fecha,
      unidades: acc.unidades,
      ordenes: acc.ordenes.size,
      importe: acc.importe,
    };
  });

  await guardarEnLotes(db, "tiktok_ventas_diarias", filas, "account_id,sku,fecha");
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
