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
 * Tres y no uno porque una orden puede cambiar de estado después (una
 * cancelación de ayer tiene que dejar de contar), y porque si el cron se cae
 * unas horas la siguiente corrida repone el hueco sola.
 */
const DIAS_VENTANA = 3;

export interface ResultadoInventario {
  estado: "solicitado" | "procesando" | "cargado" | "vacio" | "reintentar";
  skus?: number;
}

/** Una orden cancelada no es una venta, aunque siga apareciendo en el reporte. */
const CANCELADAS = new Set(["cancelled", "canceled"]);

/** Supabase corta las escrituras grandes; se mandan por tandas. */
async function guardarEnLotes(admin: any, tabla: string, filas: any[]): Promise<void> {
  for (let i = 0; i < filas.length; i += LOTE) {
    const { error } = await admin.from(tabla).upsert(filas.slice(i, i + LOTE));
    if (error) throw new Error(`${tabla}: ${error.message}`);
  }
}

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
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - DIAS_VENTANA * 86_400_000);
    const reportId = await solicitarReporte(cliente, VENTAS, cliente.cuenta.marketplaceId, {
      desde,
      hasta,
    });
    if (!reportId) return { estado: "reintentar" };
    await anotar({ reportId, desde: desde.toISOString(), hasta: hasta.toISOString() });
    return { estado: "solicitado", desde: desde.toISOString().slice(0, 10) };
  }

  const st = await estadoReporte(cliente, paso.reportId);
  if (st.estado === "procesando") return { estado: "procesando" };

  if (st.estado === "fallido" || st.estado === "vacio") {
    await anotar({});
    return { estado: st.estado === "vacio" ? "vacio" : "reintentar" };
  }

  const filas = await descargarReporte(cliente, st.documentId);
  await anotar({});
  if (filas.length === 0) return { estado: "vacio" };

  const { ventas, skus } = agregarDesdeReporte(filas, accountId);

  await guardarEnLotes(admin, "amazon_skus", skus);
  await guardarEnLotes(admin, "amazon_ventas_diarias", ventas);

  await admin.from("amazon_sync_estado").upsert({
    account_id: accountId,
    tarea: "cron_ventas",
    cursor_ts: new Date().toISOString(),
    datos: {},
    actualizado_en: new Date().toISOString(),
  });

  return { estado: "cargado", filas: ventas.length, skus: skus.length };
}

/** Lee el reporte pendiente, si la corrida anterior dejó uno pedido. */
async function pasoPendiente(
  admin: any,
  accountId: string,
  tarea: string,
): Promise<{ reportId: string } | null> {
  const { data } = await admin
    .from("amazon_sync_estado")
    .select("datos")
    .eq("account_id", accountId)
    .eq("tarea", tarea)
    .maybeSingle();
  const id = data?.datos?.reportId;
  return typeof id === "string" && id !== "" ? { reportId: id } : null;
}

/**
 * Convierte el reporte plano en el agregado diario por SKU.
 *
 * La columna purchase-date ya trae el desfase del marketplace, así que sus
 * primeros 10 caracteres SON la fecha local de venta: no hay que convertir
 * nada y no hay riesgo de mover una venta de día por error de huso.
 */
function agregarDesdeReporte(
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
    reg.unidades += entero(f["quantity"]);
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

  if (st.estado === "procesando") return { estado: "procesando" };

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
