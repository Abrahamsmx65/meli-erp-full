/**
 * Economía POR PRODUCTO desde el Data Kiosk de Amazon: el mismo "SKU
 * Economics" que Seller Central muestra en cada producto — ventas, tarifas
 * y gasto de PUBLICIDAD por SKU y por día. Es la fuente que el usuario
 * pidió para la ganancia exacta; los reportes de pagos quedan solo como
 * verificación de depósitos.
 *
 * Flujo en dos pasos, como los reportes: una corrida CREA la consulta
 * GraphQL (Amazon tarda minutos en procesarla) y las siguientes la recogen.
 * El resultado llega como documento JSONL (un objeto JSON por línea).
 *
 * Si Amazon rechaza la consulta (un campo del esquema cambió, o falta un
 * permiso), su documento de error se guarda TAL CUAL en amazon_sync_log:
 * nada de adivinar — se corrige con el mensaje exacto.
 */
import { gunzipSync } from "node:zlib";
import type { Cliente } from "./spapi";
import { guardarEnLotes, husoDe } from "./sync";

const RUTA = "/dataKiosk/2023-11-15";

/** Se re-leen estos días hacia atrás en cada refresco: Amazon ajusta cifras
 * (reembolsos, correcciones de publicidad) durante ~2 semanas. */
const DIAS_TRASLAPE = 14;
/** Primera carga: cuánta historia pedir. */
const DIAS_PRIMERA_CARGA = 60;
/** Los datos de economía tardan ~2 días en asentarse. */
const DIAS_RETRASO = 2;
/** Cuánto se le espera a una consulta antes de abandonarla. */
const PACIENCIA_MS = 45 * 60_000;

export interface ResultadoEconomia {
  estado:
    | "solicitado"
    | "procesando"
    | "cargado"
    | "vacio"
    | "reintentar"
    | "sin_tabla"
    | "error";
  filas?: number;
  desde?: string;
  hasta?: string;
  detalle?: string;
}

function fechaLocal(ms: number, huso: number): string {
  return new Date(ms + huso * 3_600_000).toISOString().slice(0, 10);
}

function consulta(desde: string, hasta: string): string {
  return `query Economia {
  analytics_economics_2024_03_15 {
    economics(startDate: "${desde}", endDate: "${hasta}", aggregateBy: {date: DAY, productId: MSKU}) {
      startDate
      endDate
      msku
      sales {
        netUnitsSold
        orderedProductSales { amount }
        netProductSales { amount }
      }
      fees {
        aggregatedDetail {
          totalFees { amount }
        }
      }
      ads {
        adTypeName
        charge { amount }
      }
      netProceeds {
        total { amount }
      }
    }
  }
}`;
}

/** El primer "amount" numérico que aparezca en la estructura, a cualquier
 * profundidad. El esquema de Amazon anida montos de formas ligeramente
 * distintas por campo; esto los saca sin depender de la forma exacta. */
function monto(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (Array.isArray(v)) return v.reduce((a: number, x) => a + monto(x), 0);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.amount != null) return monto(o.amount);
    for (const k of Object.keys(o)) {
      const m = monto(o[k]);
      if (m) return m;
    }
  }
  return 0;
}

export async function sincronizarEconomia(
  admin: any,
  cliente: Cliente,
): Promise<ResultadoEconomia> {
  const accountId = cliente.cuenta.accountId;
  const huso = husoDe(cliente.cuenta.marketplaceId);

  const { data: est } = await admin
    .from("amazon_sync_estado")
    .select("cursor_ts, datos")
    .eq("account_id", accountId)
    .eq("tarea", "cron_economia")
    .maybeSingle();

  const anotar = (datos: Record<string, unknown>, cursorTs?: string) =>
    admin.from("amazon_sync_estado").upsert({
      account_id: accountId,
      tarea: "cron_economia",
      ...(cursorTs ? { cursor_ts: cursorTs } : {}),
      datos,
      actualizado_en: new Date().toISOString(),
    });

  const pendiente = est?.datos?.queryId as string | undefined;

  // ---- Paso 1: crear la consulta ------------------------------------------
  if (!pendiente) {
    // Con carga fresca (< 6 h), no hay nada que hacer todavía.
    if (est?.cursor_ts && Date.now() - Date.parse(est.cursor_ts) < 6 * 3_600_000) {
      return { estado: "vacio" };
    }
    const hasta = fechaLocal(Date.now() - DIAS_RETRASO * 86_400_000, huso);
    const desde = est?.cursor_ts
      ? fechaLocal(Date.parse(est.cursor_ts) - DIAS_TRASLAPE * 86_400_000, huso)
      : fechaLocal(Date.now() - DIAS_PRIMERA_CARGA * 86_400_000, huso);
    if (desde >= hasta) return { estado: "vacio" };

    const r = await cliente.llamar<{ queryId?: string }>(
      "POST",
      `${RUTA}/queries`,
      "createQuery",
      { cuerpo: { query: consulta(desde, hasta) } },
    );
    if (!r?.queryId) return { estado: "reintentar" };
    await anotar({ queryId: r.queryId, desde, hasta, pedidoEn: new Date().toISOString() });
    return { estado: "solicitado", desde, hasta };
  }

  // ---- Paso 2: recoger la consulta ----------------------------------------
  const q = await cliente.llamar<{
    processingStatus?: string;
    dataDocumentId?: string;
    errorDocumentId?: string;
  }>("GET", `${RUTA}/queries/${pendiente}`, "getQuery");

  const status = q?.processingStatus ?? "";
  if (status === "IN_QUEUE" || status === "IN_PROGRESS" || status === "") {
    const edad = est?.datos?.pedidoEn ? Date.now() - Date.parse(est.datos.pedidoEn) : Infinity;
    if (edad > PACIENCIA_MS) {
      await anotar({});
      return { estado: "reintentar", detalle: "consulta abandonada por vieja" };
    }
    return { estado: "procesando" };
  }

  if (status === "FATAL" || status === "CANCELLED") {
    // El documento de error trae el mensaje EXACTO de Amazon (campo
    // inexistente, permiso faltante): se registra para corregir sin adivinar.
    let detalle = status;
    if (q?.errorDocumentId) {
      try {
        detalle = (await descargarDocumento(cliente, q.errorDocumentId)).slice(0, 1500);
      } catch {
        /* el estado solo ya dice bastante */
      }
    }
    await anotar({});
    return { estado: "error", detalle };
  }

  // DONE
  if (!q?.dataDocumentId) {
    await anotar({}, new Date().toISOString());
    return { estado: "vacio" };
  }

  const texto = await descargarDocumento(cliente, q.dataDocumentId);
  const filas: Record<string, unknown>[] = [];
  for (const linea of texto.split(/\r?\n/)) {
    const t = linea.trim();
    if (!t) continue;
    try {
      filas.push(JSON.parse(t));
    } catch {
      continue;
    }
  }

  const db: Record<string, unknown>[] = [];
  for (const f of filas) {
    const sku = String((f as any).msku ?? "").trim();
    const fecha = String((f as any).startDate ?? "").slice(0, 10);
    if (!sku || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) continue;
    const sales = (f as any).sales ?? {};
    db.push({
      account_id: accountId,
      seller_sku: sku,
      fecha,
      unidades: monto(sales.netUnitsSold),
      ventas: Math.round(monto(sales.orderedProductSales) * 100) / 100,
      tarifas: Math.round(Math.abs(monto((f as any).fees)) * 100) / 100,
      publicidad: Math.round(Math.abs(monto((f as any).ads)) * 100) / 100,
      neto: Math.round(monto((f as any).netProceeds) * 100) / 100,
      actualizado_en: new Date().toISOString(),
    });
  }

  if (!db.length) {
    await anotar({}, new Date().toISOString());
    return { estado: "vacio", filas: 0 };
  }

  try {
    await guardarEnLotes(admin, "amazon_economia", db);
  } catch (err) {
    if (String((err as Error).message).includes("amazon_economia")) {
      await anotar({});
      return { estado: "sin_tabla" };
    }
    throw err;
  }

  await anotar({}, new Date().toISOString());
  return {
    estado: "cargado",
    filas: db.length,
    desde: est?.datos?.desde,
    hasta: est?.datos?.hasta,
  };
}

async function descargarDocumento(cliente: Cliente, documentId: string): Promise<string> {
  const doc = await cliente.llamar<{ documentUrl?: string }>(
    "GET",
    `${RUTA}/documents/${documentId}`,
    "getDocument",
  );
  if (!doc?.documentUrl) throw new Error("El documento del Data Kiosk no trajo URL.");
  const r = await fetch(doc.documentUrl);
  if (!r.ok) throw new Error(`No se pudo bajar el documento: HTTP ${r.status}`);
  let bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}
