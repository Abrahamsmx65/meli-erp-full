/**
 * Reportes planos de Amazon, en dos pasos.
 *
 * Generar un reporte tarda de segundos a varios minutos, y una función de
 * Vercel muere a los 300 s. Por eso NO se espera con el reloj en la mano: una
 * corrida lo pide y guarda el folio, la siguiente lo recoge. Entre corridas
 * pasa una hora, así que siempre está listo.
 */
import { gunzipSync } from "node:zlib";
import type { Cliente } from "./spapi";

/** Inventario FBA. El reporte "ALL" no está permitido en el marketplace de México. */
export const INVENTARIO_FBA = "GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA";

/** Todas las órdenes por fecha de compra. Entrega el periodo COMPLETO. */
export const VENTAS = "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL";

/**
 * Reporte de pagos (settlement): lo que Amazon DEPOSITA de verdad, renglón
 * por renglón — precio cobrado, comisiones, envío e impuestos, con signo.
 * Amazon lo genera solo (cada cierre de liquidación); NO se puede solicitar:
 * solo se listan los ya generados y se descargan.
 */
export const PAGOS = "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2";

export interface ReporteListo {
  reportId: string;
  documentId: string;
  creadoEn: string;
}

/** Lista los reportes YA generados de un tipo (para los de settlement). */
export async function listarReportesListos(
  cliente: Cliente,
  tipo: string,
  creadosDesde: string,
): Promise<ReporteListo[]> {
  const r = await cliente.llamar<{
    reports?: {
      reportId?: string;
      reportDocumentId?: string;
      createdTime?: string;
      processingStatus?: string;
    }[];
  }>("GET", "/reports/2021-06-30/reports", "getReports", {
    params: {
      reportTypes: tipo,
      createdSince: creadosDesde,
      pageSize: 100,
    },
  });

  return (r?.reports ?? [])
    .filter((x) => x.processingStatus === "DONE" && x.reportDocumentId && x.createdTime)
    .map((x) => ({
      reportId: x.reportId ?? "",
      documentId: x.reportDocumentId!,
      creadoEn: x.createdTime!,
    }))
    .sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
}

/**
 * Fechas de los flat files de settlement: Amazon México las manda como
 * "01.05.2026 11:22:33 UTC" (día.mes.año). Date.parse las leería al revés
 * (1 de mayo → 5 de enero) y con día mayor a 12 daría NaN y la fila se
 * perdería, así que el formato con puntos se desarma a mano. Cualquier otro
 * formato (ISO, con guiones) cae al parser normal.
 */
export function msDeFechaReporte(texto: string): number {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2}):(\d{2}))?/.exec(
    (texto ?? "").trim(),
  );
  if (m) {
    return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  }
  return Date.parse(texto);
}

export type EstadoReporte =
  | { estado: "procesando" }
  | { estado: "listo"; documentId: string }
  | { estado: "vacio" }
  | { estado: "fallido" };

export async function solicitarReporte(
  cliente: Cliente,
  tipo: string,
  marketplaceId: string,
  periodo?: { desde: Date; hasta: Date },
): Promise<string | null> {
  const cuerpo: Record<string, unknown> = {
    reportType: tipo,
    marketplaceIds: [marketplaceId],
  };
  if (periodo) {
    cuerpo.dataStartTime = periodo.desde.toISOString();
    cuerpo.dataEndTime = periodo.hasta.toISOString();
  }
  const r = await cliente.llamar<{ reportId?: string }>(
    "POST",
    "/reports/2021-06-30/reports",
    "createReport",
    { cuerpo },
  );
  return r?.reportId ?? null;
}

export async function estadoReporte(
  cliente: Cliente,
  reportId: string,
): Promise<EstadoReporte> {
  const r = await cliente.llamar<{
    processingStatus?: string;
    reportDocumentId?: string;
  }>("GET", `/reports/2021-06-30/reports/${reportId}`, "getReport");

  switch (r?.processingStatus) {
    case "DONE":
      return r.reportDocumentId
        ? { estado: "listo", documentId: r.reportDocumentId }
        : { estado: "vacio" };
    // Amazon cancela cuando no hubo ni una fila en el periodo.
    case "CANCELLED":
      return { estado: "vacio" };
    case "FATAL":
      return { estado: "fallido" };
    default:
      return { estado: "procesando" };
  }
}

/** Los flat files de Amazon no siempre son UTF-8; suelen venir en cp1252. */
function decodificar(bytes: Uint8Array): string {
  for (const juego of ["utf-8", "windows-1252", "latin1"]) {
    try {
      return new TextDecoder(juego, { fatal: juego === "utf-8" }).decode(bytes);
    } catch {
      continue;
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export async function descargarReporte(
  cliente: Cliente,
  documentId: string,
): Promise<Record<string, string>[]> {
  const doc = await cliente.llamar<{ url?: string; compressionAlgorithm?: string }>(
    "GET",
    `/reports/2021-06-30/documents/${documentId}`,
    "getReportDocument",
  );
  if (!doc?.url) return [];

  // La URL es prefirmada de S3: mandarle el token de LWA la rechaza.
  const r = await fetch(doc.url);
  if (!r.ok) throw new Error(`No se pudo bajar el reporte: HTTP ${r.status}`);

  let bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);

  return filasTsv(decodificar(bytes));
}

/** Convierte el TSV en objetos con encabezados normalizados a minúsculas-con-guiones. */
export function filasTsv(texto: string): Record<string, string>[] {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lineas.length < 2) return [];

  const encabezados = lineas[0]
    .split("\t")
    .map((h) => h.trim().toLowerCase().replace(/[ _]/g, "-"));

  const salida: Record<string, string>[] = [];
  for (let i = 1; i < lineas.length; i++) {
    const celdas = lineas[i].split("\t");
    const fila: Record<string, string> = {};
    for (let j = 0; j < encabezados.length; j++) fila[encabezados[j]] = (celdas[j] ?? "").trim();
    salida.push(fila);
  }
  return salida;
}

export function entero(v: unknown): number {
  const n = Number(String(v ?? "").replace(/[,$]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function decimal(v: unknown): number {
  const n = Number(String(v ?? "").replace(/[,$]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
