/**
 * Sincronización de Amazon. La dispara pg_cron desde Supabase.
 *
 * Ventas e inventario van por REPORTES, no por las APIs de consulta, y las dos
 * en dos pasos: una corrida pide el reporte y la siguiente lo recoge. Generar
 * un reporte tarda más de lo que vive una función serverless.
 *
 * Las ventas se hicieron por reporte tras un intento fallido con la API de
 * Pedidos, y la razón importa: getOrders sólo devuelve las órdenes MODIFICADAS
 * en la ventana. Agregar ese pedazo y escribirlo encima del total del día
 * degradaba la cifra en cada corrida. El reporte entrega el periodo completo,
 * así que recalcular y sobreescribir es correcto e idempotente: puede correr
 * mil veces y siempre deja el mismo resultado.
 */
import type { Cliente } from "./spapi";
import { DIAS_VIGENCIA_ENVIO_FBA } from "../servicios/fba-en-camino";
import {
  INVENTARIO_FBA,
  LEDGER_INVENTARIO,
  PAGOS,
  VENTAS,
  decimal,
  descargarReporte,
  entero,
  estadoReporte,
  listarReportesListos,
  msDeFechaReporte,
  solicitarReporte,
} from "./reportes";

const LOTE = 500;

export interface ResultadoVentas {
  estado: "solicitado" | "procesando" | "cargado" | "vacio" | "reintentar";
  filas?: number;
  skus?: number;
  desde?: string;
  hasta?: string;
}

/**
 * Días hacia atrás que se recalculan en cada pasada.
 *
 * Catorce y no uno porque una orden puede cambiar de estado DÍAS después:
 * una orden pendiente de pago se concreta (y recién ahí trae unidades y
 * precio), o una cancelación tardía tiene que dejar de contar. Con la
 * ventana corta de antes, todo lo que se asentaba después de 3 días se
 * perdía hasta la reconciliación semanal — por eso el panel traía menos
 * que Amazon. El reporte de 14 días sigue siendo chico y se pide igual.
 */
const DIAS_VENTANA = 14;

/** Desfase del marketplace: define dónde empieza y termina el día de venta. */
export function husoDe(marketplaceId: string): number {
  const husos: Record<string, number> = {
    A1AM78C64UM0Y8: -6, // México
    ATVPDKIKX0DER: -8, // Estados Unidos
    A2EUQ1WTGCTBG2: -8, // Canadá
  };
  return husos[marketplaceId] ?? 0;
}

/** Fecha local (YYYY-MM-DD) del marketplace en un instante dado. */
function fechaLocal(ms: number, huso: number): string {
  return new Date(ms + huso * 3_600_000).toISOString().slice(0, 10);
}

export interface ResultadoInventario {
  estado: "solicitado" | "procesando" | "cargado" | "vacio" | "reintentar";
  skus?: number;
}

/** Una orden cancelada no es una venta, aunque siga apareciendo en el reporte. */
const CANCELADAS = new Set(["cancelled", "canceled"]);

/** Supabase corta las escrituras grandes; se mandan por tandas. */
export async function guardarEnLotes(admin: any, tabla: string, filas: any[]): Promise<void> {
  for (let i = 0; i < filas.length; i += LOTE) {
    const { error } = await admin.from(tabla).upsert(filas.slice(i, i + LOTE));
    if (error) throw new Error(`${tabla}: ${error.message}`);
  }
}

/** Cuánto se le espera a un reporte antes de darlo por perdido y pedir otro. */
const PACIENCIA_REPORTE_MS = 45 * 60_000;

/** Hasta dónde atrás puede abrirse la ventana (hoyos y reconciliación). */
const DIAS_MAXIMOS = 30;

export async function sincronizarVentas(
  admin: any,
  cliente: Cliente,
): Promise<ResultadoVentas> {
  const accountId = cliente.cuenta.accountId;
  const paso = await pasoPendiente(admin, accountId, "cron_ventas");

  const anotar = (datos: Record<string, unknown>) =>
    admin.from("amazon_sync_estado").upsert({
      account_id: accountId,
      tarea: "cron_ventas",
      datos,
      actualizado_en: new Date().toISOString(),
    });

  if (!paso) {
    const huso = husoDe(cliente.cuenta.marketplaceId);
    const hasta = new Date();

    // `corte` es el primer día que se va a reescribir. Se pide un día extra
    // hacia atrás para que ese día quede ENTERO dentro del reporte: pedir
    // "hace 3 días" a la hora exacta parte el día más viejo por la mitad, y
    // reescribirlo con medio día de datos borra las ventas de su mañana.
    let corte = fechaLocal(hasta.getTime() - DIAS_VENTANA * 86_400_000, huso);
    const piso = fechaLocal(hasta.getTime() - DIAS_MAXIMOS * 86_400_000, huso);

    // Si el proceso estuvo caído más días que la ventana, retomar desde el
    // último día cargado: sin esto, una caída de más de 3 días dejaba un
    // hoyo permanente que nadie reponía.
    const { data: est } = await admin
      .from("amazon_sync_estado")
      .select("cursor_ts")
      .eq("account_id", accountId)
      .eq("tarea", "cron_ventas")
      .maybeSingle();
    if (est?.cursor_ts) {
      const ultima = fechaLocal(Date.parse(est.cursor_ts), huso);
      const retomar = fechaLocal(Date.parse(`${ultima}T00:00:00Z`) - 86_400_000, 0);
      if (retomar < corte) corte = retomar;
    }

    // Una vez a la semana la ventana se abre al máximo: las órdenes que se
    // asientan tarde (pago pendiente que se concreta días después, o una
    // cancelación tardía) quedan fuera de la ventana corta para siempre si
    // nadie vuelve a leer esos días.
    let reconcilia = false;
    const { data: rec } = await admin
      .from("amazon_sync_estado")
      .select("cursor_ts, datos")
      .eq("account_id", accountId)
      .eq("tarea", "reconciliacion_ventas")
      .maybeSingle();
    // También se fuerza UNA reconciliación cuando cambió la ventana: los
    // días que la ventana vieja dejó incompletos se reescriben ya, no
    // hasta la próxima semana.
    if (
      !rec?.cursor_ts ||
      Date.now() - Date.parse(rec.cursor_ts) > 7 * 86_400_000 ||
      rec?.datos?.ventana !== DIAS_VENTANA ||
      rec?.datos?.husoLocal !== true
    ) {
      corte = piso;
      reconcilia = true;
    }
    if (corte < piso) corte = piso;

    const desde = new Date(Date.parse(`${corte}T00:00:00Z`) - 86_400_000);

    const reportId = await solicitarReporte(cliente, VENTAS, cliente.cuenta.marketplaceId, {
      desde,
      hasta,
    });
    if (!reportId) return { estado: "reintentar" };
    await anotar({
      reportId,
      corte,
      reconcilia,
      desde: desde.toISOString(),
      pedidoEn: new Date().toISOString(),
    });
    return { estado: "solicitado", desde: corte };
  }

  const st = await estadoReporte(cliente, paso.reportId);
  if (st.estado === "procesando") {
    // Un reporte que nunca termina congelaba el proceso para siempre: el
    // folio guardado impedía pedir otro y nadie avisaba. Pasada la
    // paciencia, se abandona y la siguiente corrida pide uno nuevo.
    const edad = paso.pedidoEn ? Date.now() - Date.parse(paso.pedidoEn) : Infinity;
    if (edad > PACIENCIA_REPORTE_MS) {
      await anotar({});
      return { estado: "reintentar" };
    }
    return { estado: "procesando" };
  }

  if (st.estado === "fallido" || st.estado === "vacio") {
    await anotar({});
    return { estado: st.estado === "vacio" ? "vacio" : "reintentar" };
  }

  const filas = await descargarReporte(cliente, st.documentId);
  await anotar({});
  if (filas.length === 0) return { estado: "vacio" };

  const { ventas, skus } = agregarDesdeReporte(filas, accountId, husoDe(cliente.cuenta.marketplaceId));

  // Solo se escriben los días que el reporte cubre completos. El día extra
  // que se pidió de margen se descarta: viene incompleto por definición.
  const corte: string = paso.corte ?? "";
  const completos = corte ? ventas.filter((v) => v.fecha >= corte) : ventas;

  await guardarEnLotes(admin, "amazon_skus", skus);
  await guardarEnLotes(admin, "amazon_ventas_diarias", completos);

  await admin.from("amazon_sync_estado").upsert({
    account_id: accountId,
    tarea: "cron_ventas",
    cursor_ts: new Date().toISOString(),
    datos: {},
    actualizado_en: new Date().toISOString(),
  });

  if (paso.reconcilia) {
    await admin.from("amazon_sync_estado").upsert({
      account_id: accountId,
      tarea: "reconciliacion_ventas",
      cursor_ts: new Date().toISOString(),
      datos: { ventana: DIAS_VENTANA, husoLocal: true },
      actualizado_en: new Date().toISOString(),
    });
  }

  return { estado: "cargado", filas: completos.length, skus: skus.length, desde: corte };
}

/** Lee el reporte pendiente, si la corrida anterior dejó uno pedido. */
async function pasoPendiente(
  admin: any,
  accountId: string,
  tarea: string,
): Promise<{ reportId: string; corte?: string; reconcilia?: boolean; pedidoEn?: string } | null> {
  const { data } = await admin
    .from("amazon_sync_estado")
    .select("datos")
    .eq("account_id", accountId)
    .eq("tarea", tarea)
    .maybeSingle();
  const id = data?.datos?.reportId;
  if (typeof id !== "string" || id === "") return null;
  return {
    reportId: id,
    corte: data?.datos?.corte,
    reconcilia: data?.datos?.reconcilia === true,
    pedidoEn: data?.datos?.pedidoEn,
  };
}

/**
 * Convierte el reporte plano en el agregado diario por SKU.
 *
 * La columna purchase-date llega con OFFSET EXPLÍCITO, pero ese offset
 * depende de la preferencia de la cuenta (muchas veces es UTC, +00:00):
 * cortar los primeros 10 caracteres corría al día siguiente toda venta de
 * la tarde-noche de México. Se convierte del instante real al huso del
 * marketplace.
 */
export function agregarDesdeReporte(
  filas: Record<string, string>[],
  accountId: string,
  huso = -6,
): { ventas: any[]; skus: any[] } {
  const acumulado = new Map<string, any>();
  const pedidos = new Map<string, Set<string>>();
  const catalogo = new Map<string, any>();

  for (const f of filas) {
    const sku = (f["sku"] ?? "").trim();
    const compra = (f["purchase-date"] ?? "").trim();
    if (!sku || compra.length < 10) continue;

    if (!catalogo.has(sku)) {
      catalogo.set(sku, {
        account_id: accountId,
        seller_sku: sku,
        asin: f["asin"] || null,
        titulo: f["product-name"] || null,
        canal: f["fulfillment-channel"] || null,
      });
    }

    const estado = (f["item-status"] || f["order-status"] || "").toLowerCase();
    if (CANCELADAS.has(estado)) continue;

    const ms = Date.parse(compra);
    const fecha = Number.isFinite(ms) ? fechaLocal(ms, huso) : compra.slice(0, 10);
    const clave = `${sku}|${fecha}`;
    const reg = acumulado.get(clave) ?? {
      account_id: accountId,
      seller_sku: sku,
      fecha,
      unidades: 0,
      ordenes: 0,
      importe: 0,
      moneda: f["currency"] || null,
    };
    // El flat file "GENERAL" trae `quantity`; otras variantes del mismo
    // reporte usan `quantity-purchased`. Aceptar ambas evita quedar en cero
    // en silencio si Amazon cambia la variante.
    const unidades = entero(f["quantity"] || f["quantity-purchased"]);
    reg.unidades += unidades;
    reg.importe += decimal(f["item-price"]);
    acumulado.set(clave, reg);

    // Una orden Pending viene con 0 unidades y sin precio: contarla como
    // "orden" inflaría el conteo con órdenes que aún no aportan nada. Se
    // cuenta cuando se concreta (la ventana de 14 días la vuelve a leer).
    if (unidades > 0) {
      const vistos = pedidos.get(clave) ?? new Set<string>();
      vistos.add(f["amazon-order-id"] ?? "");
      pedidos.set(clave, vistos);
    }
  }

  const ventas = [...acumulado.entries()].map(([clave, reg]) => ({
    ...reg,
    ordenes: pedidos.get(clave)?.size ?? 0,
    importe: Math.round(reg.importe * 100) / 100,
  }));

  return { ventas, skus: [...catalogo.values()] };
}

// ---------------------------------------------------------------------------
// Inventario
// ---------------------------------------------------------------------------
export async function sincronizarInventario(
  admin: any,
  cliente: Cliente,
): Promise<ResultadoInventario> {
  const accountId = cliente.cuenta.accountId;

  const paso = await pasoPendiente(admin, accountId, "cron_inventario");

  const anotar = (datos: Record<string, unknown>) =>
    admin.from("amazon_sync_estado").upsert({
      account_id: accountId,
      tarea: "cron_inventario",
      datos,
      actualizado_en: new Date().toISOString(),
    });

  // Paso 1: no hay reporte pendiente, se pide uno y se recoge la próxima vez.
  if (!paso) {
    const reportId = await solicitarReporte(cliente, INVENTARIO_FBA, cliente.cuenta.marketplaceId);
    if (!reportId) return { estado: "reintentar" };
    await anotar({ reportId, pedidoEn: new Date().toISOString() });
    return { estado: "solicitado" };
  }

  // Paso 2: recoger el que quedó pendiente.
  const st = await estadoReporte(cliente, paso.reportId);

  if (st.estado === "procesando") {
    // Igual que en ventas: un reporte eterno no puede congelar el proceso.
    const edad = paso.pedidoEn ? Date.now() - Date.parse(paso.pedidoEn) : Infinity;
    if (edad > PACIENCIA_REPORTE_MS) {
      await anotar({});
      return { estado: "reintentar" };
    }
    return { estado: "procesando" };
  }

  if (st.estado === "fallido" || st.estado === "vacio") {
    // Amazon a veces marca FATAL un reporte válido; se descarta y se vuelve a pedir.
    await anotar({});
    return { estado: st.estado === "vacio" ? "vacio" : "reintentar" };
  }

  const filas = await descargarReporte(cliente, st.documentId);
  await anotar({});
  if (filas.length === 0) return { estado: "vacio" };

  const ahora = new Date().toISOString();
  const hoy = ahora.slice(0, 10);

  const inventario = filas
    .filter((f) => (f["sku"] ?? f["seller-sku"] ?? "") !== "")
    .map((f) => {
      const trabajando = entero(f["afn-inbound-working-quantity"]);
      const enviado = entero(f["afn-inbound-shipped-quantity"]);
      const recibiendo = entero(f["afn-inbound-receiving-quantity"]);
      return {
        account_id: accountId,
        seller_sku: f["sku"] || f["seller-sku"],
        asin: f["asin"] || null,
        fnsku: f["fnsku"] || null,
        condicion: f["condition"] || null,
        disponible: entero(f["afn-fulfillable-quantity"]),
        reservado: entero(f["afn-reserved-quantity"]),
        entrante_trabajando: trabajando,
        entrante_enviado: enviado,
        entrante_recibiendo: recibiendo,
        en_transferencia: trabajando + enviado + recibiendo,
        no_disponible: entero(f["afn-unsellable-quantity"]),
        investigando: entero(f["afn-researching-quantity"]),
        total: entero(f["afn-total-quantity"]),
        detalle: {},
        actualizado_en: ahora,
      };
    });

  await guardarEnLotes(admin, "amazon_inventario", inventario);

  // Foto del día: es lo que con el tiempo deja medir agotamientos reales.
  await guardarEnLotes(
    admin,
    "amazon_inventario_snapshots",
    inventario.map((i) => ({
      account_id: i.account_id,
      seller_sku: i.seller_sku,
      fecha: hoy,
      disponible: i.disponible,
      en_transferencia: i.en_transferencia,
      reservado: i.reservado,
      total: i.total,
      origen: "cron",
    })),
  );

  return { estado: "cargado", skus: inventario.length };
}

// ---------------------------------------------------------------------------
// Historial del inventario (Inventory Ledger): el stock que HABÍA cada día
// ---------------------------------------------------------------------------

/** Cuántos días hacia atrás debe existir historia del inventario FBA. */
export const DIAS_HISTORIAL_LEDGER = 35;

/** "2026-08-19", "8/19/2026" o "19.08.2026" → "2026-08-19". */
export function fechaLedger(texto: string): string | null {
  const s = (texto ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dos = (x: string) => x.padStart(2, "0");
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); // mes/día/año (formato US)
  if (m) return `${m[3]}-${dos(m[1])}-${dos(m[2])}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s); // día.mes.año (formato EU)
  if (m) return `${m[3]}-${dos(m[2])}-${dos(m[1])}`;
  return null;
}

/**
 * Convierte el reporte del ledger en fotos diarias del inventario.
 *
 * Solo el saldo VENDIBLE (disposition SELLABLE) al cierre de cada día,
 * sumado entre ubicaciones. El ledger solo trae renglón los días con saldo o
 * movimiento, así que los días sin renglón se rellenan ARRASTRANDO el último
 * saldo conocido — sin el arrastre, justo los días en cero (los que la
 * corrección por agotamiento necesita) quedarían sin foto.
 */
export function snapshotsDesdeLedger(
  filas: Record<string, string>[],
  accountId: string,
  desde: string,
  hasta: string,
): {
  account_id: string;
  seller_sku: string;
  fecha: string;
  disponible: number;
  en_transferencia: number;
  reservado: number;
  total: number;
  origen: string;
}[] {
  // saldo de cierre por SKU y fecha (sumando ubicaciones)
  const porSku = new Map<string, Map<string, number>>();
  for (const f of filas) {
    if ((f["disposition"] ?? "").trim().toUpperCase() !== "SELLABLE") continue;
    const sku = (f["msku"] ?? "").trim();
    const fecha = fechaLedger(f["date"] ?? "");
    if (!sku || !fecha || fecha > hasta) continue;
    const dias = porSku.get(sku) ?? new Map<string, number>();
    dias.set(fecha, (dias.get(fecha) ?? 0) + entero(f["ending-warehouse-balance"]));
    porSku.set(sku, dias);
  }

  const DIA_MS = 86_400_000;
  const salida: ReturnType<typeof snapshotsDesdeLedger> = [];
  for (const [sku, dias] of porSku) {
    const fechas = [...dias.keys()].sort();
    let saldo = 0;
    for (
      let ms = Date.parse(`${fechas[0]}T00:00:00Z`);
      ms <= Date.parse(`${hasta}T00:00:00Z`);
      ms += DIA_MS
    ) {
      const fecha = new Date(ms).toISOString().slice(0, 10);
      saldo = dias.get(fecha) ?? saldo; // sin renglón: arrastra el último saldo
      if (fecha < desde) continue;
      salida.push({
        account_id: accountId,
        seller_sku: sku,
        fecha,
        disponible: saldo,
        en_transferencia: 0,
        reservado: 0,
        total: saldo,
        origen: "ledger",
      });
    }
  }
  return salida;
}

export interface ResultadoLedger {
  estado: "completo" | "solicitado" | "procesando" | "cargado" | "vacio" | "reintentar";
  filas?: number;
}

/**
 * Rellena la historia del inventario FBA con el Inventory Ledger de Amazon.
 *
 * Las fotos diarias del cron solo existen desde que el cron corre; el ledger
 * sí sabe cuánto había cada día (hasta 18 meses atrás). Cuando la foto más
 * vieja no llega a DIAS_HISTORIAL_LEDGER días atrás, se pide el ledger
 * diario del hueco y se guarda como fotos con origen "ledger" — SIN pisar
 * las fotos reales del cron (ignoreDuplicates). En cuanto la historia está
 * completa, la tarea deja de pedir reportes: solo hace una consulta barata.
 */
export async function sincronizarHistorialInventario(
  admin: any,
  cliente: Cliente,
): Promise<ResultadoLedger> {
  const accountId = cliente.cuenta.accountId;
  const paso = await pasoPendiente(admin, accountId, "cron_ledger");

  const anotar = (datos: Record<string, unknown>) =>
    admin.from("amazon_sync_estado").upsert({
      account_id: accountId,
      tarea: "cron_ledger",
      datos,
      actualizado_en: new Date().toISOString(),
    });

  const desde = new Date(Date.now() - DIAS_HISTORIAL_LEDGER * 86_400_000)
    .toISOString()
    .slice(0, 10);

  if (!paso) {
    // ¿Ya hay historia suficiente? La foto más vieja lo dice con una consulta.
    const { data: primera } = await admin
      .from("amazon_inventario_snapshots")
      .select("fecha")
      .eq("account_id", accountId)
      .order("fecha", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (primera?.fecha && String(primera.fecha) <= desde) return { estado: "completo" };

    const reportId = await solicitarReporte(
      cliente,
      LEDGER_INVENTARIO,
      cliente.cuenta.marketplaceId,
      { desde: new Date(Date.parse(`${desde}T00:00:00Z`)), hasta: new Date() },
      { aggregatedByTimePeriod: "DAILY", aggregateByLocation: "COUNTRY" },
    );
    if (!reportId) return { estado: "reintentar" };
    await anotar({ reportId, pedidoEn: new Date().toISOString() });
    return { estado: "solicitado" };
  }

  const st = await estadoReporte(cliente, paso.reportId);
  if (st.estado === "procesando") {
    const edad = paso.pedidoEn ? Date.now() - Date.parse(paso.pedidoEn) : Infinity;
    if (edad > PACIENCIA_REPORTE_MS) {
      await anotar({});
      return { estado: "reintentar" };
    }
    return { estado: "procesando" };
  }
  if (st.estado === "fallido" || st.estado === "vacio") {
    await anotar({});
    return { estado: st.estado === "vacio" ? "vacio" : "reintentar" };
  }

  const filas = await descargarReporte(cliente, st.documentId);
  await anotar({});
  if (filas.length === 0) return { estado: "vacio" };

  // El día de hoy va incompleto en el ledger: hasta ayer.
  const ayer = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const fotos = snapshotsDesdeLedger(filas, accountId, desde, ayer);

  // ignoreDuplicates: la foto real del cron (con en-transferencia y
  // reservado de verdad) gana sobre la reconstrucción del ledger.
  for (let i = 0; i < fotos.length; i += LOTE) {
    const { error } = await admin
      .from("amazon_inventario_snapshots")
      .upsert(fotos.slice(i, i + LOTE), {
        onConflict: "account_id,seller_sku,fecha",
        ignoreDuplicates: true,
      });
    if (error) throw new Error(`amazon_inventario_snapshots: ${error.message}`);
  }

  return { estado: "cargado", filas: fotos.length };
}

// ---------------------------------------------------------------------------
// Pagos (settlement): lo que Amazon deposita de verdad
// ---------------------------------------------------------------------------

export interface ResultadoPagos {
  estado: "cargado" | "vacio" | "sin_tabla" | "sin_permiso" | "reintentar";
  reportes?: number;
  filas?: number;
}

/**
 * Baja los reportes de liquidación (settlement) que Amazon ya generó y
 * guarda, por SKU y día de asiento, el NETO real depositado: precio cobrado
 * menos comisiones, envío e impuestos, con reembolsos en negativo. Es el
 * equivalente del net_received_amount de Mercado Pago, pero de Amazon.
 *
 * Idempotente por diseño: cada fila vive bajo (cuenta, settlement, sku,
 * fecha), así que reprocesar un reporte reescribe lo mismo. El cursor
 * (amazon_sync_estado, tarea cron_pagos) guarda hasta qué fecha de creación
 * de reporte ya se leyó.
 */
export async function sincronizarPagos(
  admin: any,
  cliente: Cliente,
): Promise<ResultadoPagos> {
  const accountId = cliente.cuenta.accountId;
  const huso = husoDe(cliente.cuenta.marketplaceId);

  const { data: est } = await admin
    .from("amazon_sync_estado")
    .select("cursor_ts, datos")
    .eq("account_id", accountId)
    .eq("tarea", "cron_pagos")
    .maybeSingle();
  // Las primeras cargas guardaron fechas mal leídas (mes.día en vez de
  // día.mes): una sola vez se tira todo lo cargado y se relee desde cero,
  // ya con el parser correcto. La marca de formato evita repetirlo; sube de
  // versión cuando cambia CÓMO se leen los renglones (v3: unidades solo del
  // renglón Principal + cargos de cuenta como pseudo-SKUs).
  const necesitaReset = Boolean(est) && est?.datos?.formatoPagos !== "v3";
  const cursorTs: string | null = necesitaReset ? null : (est?.cursor_ts ?? null);
  // La primera vez se mira 90 días atrás (Amazon guarda ~90 días de
  // reportes); después, desde el último leído con una hora de traslape.
  const desde = cursorTs
    ? new Date(Date.parse(cursorTs) - 3_600_000).toISOString()
    : new Date(Date.now() - 90 * 86_400_000).toISOString();

  let reportes;
  try {
    reportes = await listarReportesListos(cliente, PAGOS, desde);
  } catch (err: any) {
    // 403 = la app de SP-API no tiene el rol de FINANZAS: los reportes de
    // liquidación piden ese permiso aparte. Se reporta claro en el log en
    // vez de reventar; en cuanto el rol se active, esto arranca solo.
    if (err?.status === 403) {
      return { estado: "sin_permiso" } as ResultadoPagos;
    }
    throw err;
  }
  // Estrictamente lo aún no leído: el traslape de una hora protege contra
  // reportes generados mientras corría la tanda anterior, pero Amazon crea
  // varios settlement en el mismo minuto y sin este filtro los mismos tres
  // reportes se releían por siempre y el cursor jamás avanzaba.
  if (cursorTs) reportes = reportes.filter((r) => r.creadoEn > cursorTs);
  if (!reportes.length) return { estado: "vacio", reportes: 0 };

  if (necesitaReset) {
    await admin.from("amazon_pagos").delete().eq("account_id", accountId);
  }

  let filasTotales = 0;
  let ultimoCreado = cursorTs ?? "";

  // Máximo 3 reportes por corrida: cada uno puede traer decenas de miles de
  // renglones y la función tiene plazo. Lo que falte lo recoge la siguiente.
  for (const rep of reportes.slice(0, 3)) {
    const filas = await descargarReporte(cliente, rep.documentId);

    // settlement-id|sku|día → neto y unidades liquidadas. Los cargos de
    // CUENTA (sin SKU) no se tiran: publicidad y demás gastos van a
    // pseudo-SKUs "(PUBLICIDAD)" / "(OTROS CARGOS)" para poder restarlos
    // de la ganancia del periodo.
    const acumulado = new Map<
      string,
      { settlementId: string; sku: string; fecha: string; neto: number; unidades: number }
    >();
    for (const f of filas) {
      const posted = f["posted-date-time"] || f["posted-date"] || "";
      const ms = msDeFechaReporte(posted);
      if (!Number.isFinite(ms)) continue;
      const fecha = fechaLocal(ms, huso);
      const settlementId = (f["settlement-id"] ?? "").trim() || rep.reportId;

      let sku = (f["sku"] ?? "").trim();
      if (!sku) {
        const monto = decimal(f["amount"]);
        if (!monto) continue; // el renglón-resumen del settlement, sin importe
        const desc = `${f["amount-type"] ?? ""} ${f["amount-description"] ?? ""}`.toLowerCase();
        sku = /advertis|publicidad/.test(desc) ? "(PUBLICIDAD)" : "(OTROS CARGOS)";
      }

      const clave = `${settlementId}|${sku}|${fecha}`;
      const reg =
        acumulado.get(clave) ?? { settlementId, sku, fecha, neto: 0, unidades: 0 };
      reg.neto += decimal(f["amount"]);
      // Las unidades SOLO se cuentan en el renglón del precio (Principal):
      // cada cargo de la misma orden (comisión, tarifa FBA…) viene en su
      // propio renglón y repite quantity-purchased — sumarlos todos triplicaba
      // las unidades liquidadas y hacía que el costo comiera toda la ganancia.
      if (
        (f["transaction-type"] ?? "").toLowerCase() === "order" &&
        (f["amount-type"] ?? "").toLowerCase() === "itemprice" &&
        (f["amount-description"] ?? "").toLowerCase() === "principal"
      ) {
        reg.unidades += entero(f["quantity-purchased"]);
      }
      acumulado.set(clave, reg);
    }

    const filasDb = [...acumulado.values()].map((r) => ({
      account_id: accountId,
      settlement_id: r.settlementId,
      seller_sku: r.sku,
      fecha: r.fecha,
      neto: Math.round(r.neto * 100) / 100,
      unidades: r.unidades,
      actualizado_en: new Date().toISOString(),
    }));

    try {
      await guardarEnLotes(admin, "amazon_pagos", filasDb);
    } catch (err) {
      // La tabla puede no existir todavía (migración 0013 pendiente): el
      // resto de la sincronización no debe caerse por eso.
      if (String((err as Error).message).includes("amazon_pagos")) {
        return { estado: "sin_tabla" };
      }
      throw err;
    }

    filasTotales += filasDb.length;
    if (rep.creadoEn > ultimoCreado) ultimoCreado = rep.creadoEn;
  }

  if (ultimoCreado) {
    await admin.from("amazon_sync_estado").upsert({
      account_id: accountId,
      tarea: "cron_pagos",
      cursor_ts: ultimoCreado,
      datos: { formatoPagos: "v3" },
      actualizado_en: new Date().toISOString(),
    });
  }

  return { estado: "cargado", reportes: Math.min(reportes.length, 3), filas: filasTotales };
}

// ---------------------------------------------------------------------------
// Envíos entrantes a FBA: el detalle que el reporte de inventario no da
// ---------------------------------------------------------------------------

/**
 * Estados en los que un envío entrante cuenta como "en camino" en el
 * reporte de inventario (working + shipped + receiving). CLOSED, CANCELLED,
 * DELETED y ERROR ya no suman nada.
 */
const ESTADOS_ENTRANTES = [
  "WORKING",
  "SHIPPED",
  "IN_TRANSIT",
  "DELIVERED",
  "CHECKED_IN",
  "RECEIVING",
];

export interface ResultadoEnviosEntrantes {
  estado: "cargado" | "parcial" | "reintentar";
  envios?: number;
  vigentes?: number;
  skus?: number;
}

interface EnvioSpApi {
  ShipmentId?: string;
  ShipmentName?: string;
  ShipmentStatus?: string;
}

/** Recorre /fba/inbound/v0/shipments con la paginación de NextToken. */
async function listarEnvios(
  cliente: Cliente,
  paramsIniciales: Record<string, string>,
): Promise<EnvioSpApi[] | null> {
  const envios: EnvioSpApi[] = [];
  let token: string | undefined;
  do {
    const r = await cliente.llamar<{ payload?: { ShipmentData?: EnvioSpApi[]; NextToken?: string } }>(
      "GET",
      "/fba/inbound/v0/shipments",
      "getShipments",
      {
        params: token
          ? {
              QueryType: "NEXT_TOKEN",
              NextToken: token,
              MarketplaceId: cliente.cuenta.marketplaceId,
            }
          : { ...paramsIniciales, MarketplaceId: cliente.cuenta.marketplaceId },
      },
    );
    if (!r) return null; // se acabó el plazo de la función
    envios.push(...(r.payload?.ShipmentData ?? []));
    token = r.payload?.NextToken || undefined;
  } while (token);
  return envios;
}

interface ItemEnvio {
  sku: string;
  enviado: number;
  recibido: number;
}

/** Los renglones (SKU, mandado, recibido) de UN envío, con paginación. */
async function itemsDeEnvio(cliente: Cliente, shipmentId: string): Promise<ItemEnvio[] | null> {
  const items: ItemEnvio[] = [];
  let token: string | undefined;
  do {
    const r = await cliente.llamar<{
      payload?: {
        ItemData?: {
          ShipmentId?: string;
          SellerSKU?: string;
          QuantityShipped?: number;
          QuantityReceived?: number;
        }[];
        NextToken?: string;
      };
    }>(
      "GET",
      token
        ? "/fba/inbound/v0/shipmentItems"
        : `/fba/inbound/v0/shipments/${encodeURIComponent(shipmentId)}/items`,
      "getShipmentItems",
      {
        params: token
          ? {
              QueryType: "NEXT_TOKEN",
              NextToken: token,
              MarketplaceId: cliente.cuenta.marketplaceId,
            }
          : { MarketplaceId: cliente.cuenta.marketplaceId },
      },
    );
    if (!r) return null;
    for (const it of r.payload?.ItemData ?? []) {
      // La continuación viene por /shipmentItems y podría traer renglones de
      // otro envío: solo se aceptan los de ESTE.
      if (it.ShipmentId && it.ShipmentId !== shipmentId) continue;
      const sku = (it.SellerSKU ?? "").trim();
      if (!sku) continue;
      items.push({
        sku,
        enviado: Math.max(0, Math.round(Number(it.QuantityShipped) || 0)),
        recibido: Math.max(0, Math.round(Number(it.QuantityReceived) || 0)),
      });
    }
    token = r.payload?.NextToken || undefined;
  } while (token);
  return items;
}

/**
 * Baja los envíos entrantes a FBA y marca cuáles siguen VIVOS.
 *
 * Un envío es vigente si Amazon le registró algún movimiento en los últimos
 * DIAS_VIGENCIA_ENVIO_FBA días (la API v0 no da fecha de creación, pero un
 * envío recién creado siempre tiene movimiento reciente, y uno atorado deja
 * de tenerlo). El plan de FBA cuenta como "en camino" SOLO lo pendiente de
 * los vigentes; los viejos se enseñan aparte para cerrarlos en Seller
 * Central.
 *
 * Si el plazo de la función se acaba a media corrida, lo ya guardado queda
 * (upsert por envío) y la limpieza de envíos desaparecidos se salta: la
 * siguiente corrida completa la deja exacta.
 */
export async function sincronizarEnviosEntrantes(
  admin: any,
  cliente: Cliente,
): Promise<ResultadoEnviosEntrantes> {
  const accountId = cliente.cuenta.accountId;
  const ahora = new Date().toISOString();

  // 1. Todo lo que el reporte de inventario cuenta como entrante.
  const activos = await listarEnvios(cliente, {
    QueryType: "SHIPMENT",
    ShipmentStatusList: ESTADOS_ENTRANTES.join(","),
  });
  if (activos === null) return { estado: "reintentar" };

  // 2. Los envíos con movimiento reciente. Amazon exige la lista de estados
  //    TAMBIÉN aquí ("At least one of ShipmentStatusList and ShipmentIdList
  //    must be provided"): se pasan los mismos entrantes — si un envío ya
  //    está CLOSED o CANCELLED tampoco suma en el reporte, así que su
  //    movimiento da igual.
  const recientes = await listarEnvios(cliente, {
    QueryType: "DATE_RANGE",
    ShipmentStatusList: ESTADOS_ENTRANTES.join(","),
    LastUpdatedAfter: new Date(
      Date.now() - DIAS_VIGENCIA_ENVIO_FBA * 86_400_000,
    ).toISOString(),
    LastUpdatedBefore: ahora,
  });
  if (recientes === null) return { estado: "reintentar" };
  const conMovimiento = new Set(
    recientes.map((s) => s.ShipmentId ?? "").filter(Boolean),
  );

  // 3. El contenido de cada envío, vigentes primero: si el plazo corta a la
  //    mitad, lo importante (lo que SÍ viene) ya quedó guardado.
  const porEnvio = new Map<string, EnvioSpApi>();
  for (const s of activos) if (s.ShipmentId) porEnvio.set(s.ShipmentId, s);
  const orden = [...porEnvio.keys()].sort(
    (a, b) => Number(conMovimiento.has(b)) - Number(conMovimiento.has(a)),
  );

  let completo = true;
  let skusTotales = 0;
  for (const id of orden) {
    const items = await itemsDeEnvio(cliente, id);
    if (items === null) {
      completo = false;
      break;
    }
    const info = porEnvio.get(id)!;

    // El mismo SKU puede venir en varios renglones del envío: se suma.
    const porSku = new Map<string, ItemEnvio>();
    for (const it of items) {
      const acc = porSku.get(it.sku) ?? { sku: it.sku, enviado: 0, recibido: 0 };
      acc.enviado += it.enviado;
      acc.recibido += it.recibido;
      porSku.set(it.sku, acc);
    }

    const filas = [...porSku.values()].map((it) => ({
      account_id: accountId,
      shipment_id: id,
      seller_sku: it.sku,
      nombre: info.ShipmentName ?? null,
      estado: info.ShipmentStatus ?? "WORKING",
      enviado: it.enviado,
      recibido: it.recibido,
      vigente: conMovimiento.has(id),
      sincronizado_en: ahora,
    }));
    if (filas.length) await guardarEnLotes(admin, "amazon_envios_entrantes", filas);
    skusTotales += filas.length;
  }

  // 4. Solo con la foto completa: lo que esta corrida no tocó ya no existe
  //    (envío cerrado o cancelado) y se borra.
  if (completo) {
    const { error } = await admin
      .from("amazon_envios_entrantes")
      .delete()
      .eq("account_id", accountId)
      .lt("sincronizado_en", ahora);
    if (error) throw new Error(`amazon_envios_entrantes: ${error.message}`);
  }

  return {
    estado: completo ? "cargado" : "parcial",
    envios: porEnvio.size,
    vigentes: [...porEnvio.keys()].filter((id) => conMovimiento.has(id)).length,
    skus: skusTotales,
  };
}
