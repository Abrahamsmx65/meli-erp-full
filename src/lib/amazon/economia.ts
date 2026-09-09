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
import { husoDe } from "./sync";

const RUTA = "/dataKiosk/2023-11-15";

/** Se re-leen estos días hacia atrás en cada refresco: Amazon ajusta cifras
 * (reembolsos, correcciones de publicidad) durante ~2 semanas. */
const DIAS_TRASLAPE = 14;
/** Máximo de días por consulta: mantiene pequeños los documentos de Data Kiosk. */
const DIAS_POR_CONSULTA = 31;
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

/** Suma días a una fecha civil ya normalizada, sin volver a aplicarle huso. */
function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

// Los campos vienen del esquema OFICIAL analytics_economics_2024_03_15
// (repositorio amzn/selling-partner-api-models): marketplaceIds es argumento
// obligatorio, las tarifas viven en fees[].charges[].aggregatedDetail
// .totalAmount y la publicidad en ads[].charge.totalAmount.
function consulta(desde: string, hasta: string, marketplaceId: string): string {
  return `query Economia {
  analytics_economics_2024_03_15 {
    economics(
      startDate: "${desde}"
      endDate: "${hasta}"
      marketplaceIds: ["${marketplaceId}"]
      aggregateBy: {date: DAY, productId: MSKU}
    ) {
      startDate
      endDate
      msku
      sales {
        netUnitsSold
        orderedProductSales { amount }
        netProductSales { amount }
      }
      fees {
        charges {
          aggregatedDetail {
            totalAmount { amount }
          }
        }
      }
      ads {
        charge {
          totalAmount { amount }
        }
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

function numeroFinito(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if ("amount" in o) return numeroFinito(o.amount);
  }
  return null;
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
  const revisadoHasta = est?.datos?.revisadoHasta as string | undefined;
  const estadoSinPendiente = revisadoHasta ? { revisadoHasta } : {};
  const fallarDocumento = async (detalle: string): Promise<ResultadoEconomia> => {
    const fallos = (Number(est?.datos?.fallosDocumento) || 0) + 1;
    if (fallos < 3) {
      await anotar({ ...est?.datos, fallosDocumento: fallos });
      return { estado: "error", detalle: `${detalle} (intento ${fallos} de 3)` };
    }
    await anotar(estadoSinPendiente);
    return { estado: "reintentar", detalle: `${detalle}; se retiró la consulta después de 3 intentos` };
  };

  // ---- Paso 1: crear la consulta ------------------------------------------
  if (!pendiente) {
    const { data: recargas, error: errorRecargas } = await admin
      .from("amazon_economia_recargas")
      .select("desde, hasta")
      .eq("account_id", accountId)
      .eq("estado", "pendiente")
      .order("desde", { ascending: true })
      .limit(1);
    if (errorRecargas && !/does not exist|42P01|schema cache/i.test(errorRecargas.message ?? "")) {
      throw new Error(`amazon_economia_recargas: ${errorRecargas.message}`);
    }
    const recarga = recargas?.[0] as { desde: string; hasta: string } | undefined;
    const ultimoDisponible = fechaLocal(Date.now() - DIAS_RETRASO * 86_400_000, huso);
    // Antes la primera carga empezaba 60 días atrás y el cursor avanzaba a
    // "ahora". Cualquier venta anterior (p. ej. el inicio de julio) quedaba
    // fuera para siempre. La base identifica el primer día de ventas cuya
    // economía no cubre importe o unidades; se pide únicamente ese hueco.
    const { data: huecos, error: errorHuecos } = recarga
      ? { data: null, error: null }
      : await admin.rpc("amazon_economia_hueco", {
          p_account: accountId,
          p_desde: revisadoHasta ? sumarDias(revisadoHasta, 1) : null,
          p_hasta: ultimoDisponible,
        });
    if (errorHuecos && !/does not exist|PGRST202|schema cache/i.test(errorHuecos.message ?? "")) {
      throw new Error(`amazon_economia_hueco: ${errorHuecos.message}`);
    }
    const hueco = Array.isArray(huecos) ? huecos[0] : huecos;
    const inicioHueco = recarga?.desde ?? (hueco?.desde as string | undefined);
    const finHueco = recarga?.hasta ?? (hueco?.hasta as string | undefined);
    // Una carga histórica incompleta avanza en el siguiente latido. Las seis
    // horas solo limitan el refresco normal cuando ya no quedan huecos.
    if (!recarga && !inicioHueco && est?.cursor_ts && Date.now() - Date.parse(est.cursor_ts) < 6 * 3_600_000) {
      return { estado: "vacio" };
    }
    const hasta = inicioHueco
      ? [finHueco ?? ultimoDisponible, sumarDias(inicioHueco, DIAS_POR_CONSULTA - 1), ultimoDisponible].sort()[0]
      : ultimoDisponible;
    const desde = inicioHueco ?? (est?.cursor_ts
      ? fechaLocal(Date.parse(est.cursor_ts) - DIAS_TRASLAPE * 86_400_000, huso)
      : fechaLocal(Date.now() - DIAS_POR_CONSULTA * 86_400_000, huso));
    if (desde > hasta) return { estado: "vacio" };

    const r = await cliente.llamar<{ queryId?: string }>(
      "POST",
      `${RUTA}/queries`,
      "createQuery",
      { cuerpo: { query: consulta(desde, hasta, cliente.cuenta.marketplaceId) } },
    );
    if (!r?.queryId) return { estado: "reintentar" };
    await anotar({
      ...estadoSinPendiente,
      queryId: r.queryId,
      desde,
      hasta,
      pedidoEn: new Date().toISOString(),
      origenConsulta: recarga ? "recarga" : inicioHueco ? "descubrimiento" : "refresco",
      ...(recarga ? { recargaDesde: recarga.desde, recargaHasta: recarga.hasta } : {}),
    });
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
      await anotar(estadoSinPendiente);
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
        // Completo (hasta 4000): un error cortado a la mitad ya nos costó
        // una vuelta de diagnóstico.
        detalle = (await descargarDocumento(cliente, q.errorDocumentId)).slice(0, 4000);
      } catch {
        /* el estado solo ya dice bastante */
      }
    }
    await anotar(estadoSinPendiente);
    return { estado: "error", detalle };
  }

  // DONE
  if (!q?.dataDocumentId) {
    return fallarDocumento("consulta terminada sin documento");
  }

  let texto: string;
  try {
    texto = await descargarDocumento(cliente, q.dataDocumentId);
  } catch (err) {
    return fallarDocumento(`no se pudo descargar el documento: ${(err as Error).message}`);
  }
  const filas: Record<string, unknown>[] = [];
  const desdeConsultado = String(est?.datos?.desde ?? "");
  const hastaConsultado = String(est?.datos?.hasta ?? "");
  for (const linea of texto.split(/\r?\n/)) {
    const t = linea.trim();
    if (!t) continue;
    try {
      const fila = JSON.parse(t);
      const sku = String(fila?.msku ?? "").trim();
      const fecha = String(fila?.startDate ?? "").slice(0, 10);
      if (!sku || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha < desdeConsultado || fecha > hastaConsultado) {
        return fallarDocumento("documento de economía con un renglón inválido");
      }
      const sales = fila?.sales ?? {};
      if (
        numeroFinito(sales.netUnitsSold) == null ||
        numeroFinito(sales.orderedProductSales) == null ||
        numeroFinito(fila?.netProceeds?.total) == null
      ) return fallarDocumento("documento de economía sin unidades, ventas o neto válidos");
      filas.push(fila);
    } catch {
      return fallarDocumento("documento de economía con JSON inválido");
    }
  }

  const db: Record<string, unknown>[] = [];
  for (const f of filas) {
    const sku = String((f as any).msku ?? "").trim();
    const fecha = String((f as any).startDate ?? "").slice(0, 10);
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

  const { error: errorReemplazo } = await admin.rpc("reemplazar_amazon_economia", {
    p_account: accountId,
    p_desde: desdeConsultado,
    p_hasta: hastaConsultado,
    p_filas: db,
  });
  if (errorReemplazo) {
    if (/amazon_economia|reemplazar_amazon_economia|does not exist|PGRST202|schema cache/i.test(errorReemplazo.message ?? "")) {
      await anotar(estadoSinPendiente);
      return { estado: "sin_tabla" };
    }
    throw new Error(`reemplazar_amazon_economia: ${errorReemplazo.message}`);
  }

  // Una recarga explícita es una cola independiente: no puede saltar el
  // frente secuencial que todavía está descubriendo huecos más antiguos.
  const esDescubrimiento = est?.datos?.origenConsulta === "descubrimiento";
  const nuevoRevisadoHasta = esDescubrimiento
    ? !revisadoHasta || hastaConsultado > revisadoHasta
      ? hastaConsultado
      : revisadoHasta
    : revisadoHasta;
  if (est?.datos?.recargaDesde && est?.datos?.recargaHasta) {
    const { error: errorRecarga } = await admin
      .from("amazon_economia_recargas")
      .update({ estado: "listo", actualizado_en: new Date().toISOString() })
      .eq("account_id", accountId)
      .eq("desde", est.datos.recargaDesde)
      .eq("hasta", est.datos.recargaHasta);
    if (errorRecarga) throw new Error(`amazon_economia_recargas: ${errorRecarga.message}`);
  }
  await anotar(nuevoRevisadoHasta ? { revisadoHasta: nuevoRevisadoHasta } : {}, new Date().toISOString());
  return {
    estado: db.length ? "cargado" : "vacio",
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
