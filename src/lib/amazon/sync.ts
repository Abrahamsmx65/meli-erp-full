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
import {
  INVENTARIO_FBA,
  VENTAS,
  decimal,
  descargarReporte,
  entero,
  estadoReporte,
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
function husoDe(marketplaceId: string): number {
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
      .select("cursor_ts")
      .eq("account_id", accountId)
      .eq("tarea", "reconciliacion_ventas")
      .maybeSingle();
    if (!rec?.cursor_ts || Date.now() - Date.parse(rec.cursor_ts) > 7 * 86_400_000) {
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

  const { ventas, skus } = agregarDesdeReporte(filas, accountId);

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
      datos: {},
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
 * La columna purchase-date ya trae el desfase del marketplace, así que sus
 * primeros 10 caracteres SON la fecha local de venta: no hay que convertir
 * nada y no hay riesgo de mover una venta de día por error de huso.
 */
export function agregarDesdeReporte(
  filas: Record<string, string>[],
  accountId: string,
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

    const fecha = compra.slice(0, 10);
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
    reg.unidades += entero(f["quantity"] || f["quantity-purchased"]);
    reg.importe += decimal(f["item-price"]);
    acumulado.set(clave, reg);

    const vistos = pedidos.get(clave) ?? new Set<string>();
    vistos.add(f["amazon-order-id"] ?? "");
    pedidos.set(clave, vistos);
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
