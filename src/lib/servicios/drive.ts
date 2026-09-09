/**
 * Google Drive, solo lectura, con llave de API (la carpeta de la fábrica
 * está compartida "con el enlace"). Sin dependencias: HTTP directo al API v3.
 *
 * Variables de entorno:
 *   GOOGLE_DRIVE_API_KEY      llave de API de Google (Drive API habilitada)
 *   DRIVE_PACKING_FOLDER_ID   id de la carpeta (lo que va después de /folders/)
 */
const API = "https://www.googleapis.com/drive/v3";

export interface ArchivoDrive {
  id: string;
  nombre: string;
  mime: string;
  md5: string | null;
  modificadoEn: string;
  tamano: number | null;
}

export interface ConfigDrive {
  apiKey: string;
  carpeta: string;
}

/** Carpeta de packing lists de la fábrica (enlace del dueño, 9-sep-2026). */
export const CARPETA_PACKING_POR_DEFECTO = "1t6GMPFzKNtQ9-kKLBMpqra6o1upZRJSk";

export function configDrive(): ConfigDrive | null {
  const apiKey = process.env.GOOGLE_DRIVE_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, carpeta: process.env.DRIVE_PACKING_FOLDER_ID?.trim() || CARPETA_PACKING_POR_DEFECTO };
}

const MIME_SHEET = "application/vnd.google-apps.spreadsheet";
const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** ¿Es una hoja de cálculo que el lector de packing list puede abrir? */
export function esHojaDeCalculo(a: Pick<ArchivoDrive, "mime" | "nombre">): boolean {
  if (a.mime === MIME_SHEET || a.mime === MIME_XLSX || a.mime === "application/vnd.ms-excel") return true;
  return /\.xlsx?$/i.test(a.nombre);
}

async function pedir(url: string, apiKey: string): Promise<Response> {
  const sep = url.includes("?") ? "&" : "?";
  const r = await fetch(`${url}${sep}key=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) {
    const cuerpo = await r.text().catch(() => "");
    const detalle = cuerpo.match(/"message":\s*"([^"]{0,200})"/)?.[1] ?? cuerpo.slice(0, 200);
    throw new Error(`Drive ${r.status}: ${detalle || r.statusText}`);
  }
  return r;
}

/** Los archivos de la carpeta (sin los borrados), con su huella para saber si cambiaron. */
export async function listarCarpetaDrive(cfg: ConfigDrive): Promise<ArchivoDrive[]> {
  const salida: ArchivoDrive[] = [];
  let pageToken: string | null = null;
  do {
    const params = new URLSearchParams({
      q: `'${cfg.carpeta}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, md5Checksum, modifiedTime, size)",
      pageSize: "200",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const r = await pedir(`${API}/files?${params.toString()}`, cfg.apiKey);
    const j = (await r.json()) as {
      nextPageToken?: string;
      files?: { id: string; name: string; mimeType: string; md5Checksum?: string; modifiedTime?: string; size?: string }[];
    };
    for (const f of j.files ?? []) {
      salida.push({
        id: f.id,
        nombre: f.name,
        mime: f.mimeType,
        md5: f.md5Checksum ?? null,
        modificadoEn: f.modifiedTime ?? "",
        tamano: f.size != null ? Number(f.size) : null,
      });
    }
    pageToken = j.nextPageToken ?? null;
  } while (pageToken);
  return salida;
}

/** El contenido: un Excel tal cual, o una hoja de Google exportada a xlsx. */
export async function descargarDrive(cfg: ConfigDrive, a: ArchivoDrive): Promise<Buffer> {
  const url =
    a.mime === MIME_SHEET
      ? `${API}/files/${a.id}/export?mimeType=${encodeURIComponent(MIME_XLSX)}`
      : `${API}/files/${a.id}?alt=media&supportsAllDrives=true`;
  const r = await pedir(url, cfg.apiKey);
  return Buffer.from(await r.arrayBuffer());
}
