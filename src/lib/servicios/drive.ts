/**
 * Google Drive, solo lectura, sin dependencias.
 *
 * Dos caminos:
 *  - PÚBLICO (decisión del dueño, 10-sep-2026: no quiere cuenta de Google
 *    Cloud): la carpeta está compartida "con el enlace" y se lee la vista
 *    pública `embeddedfolderview`; los archivos se bajan por
 *    `uc?export=download` y las hojas de Google por `export?format=xlsx`.
 *    Google no documenta esa vista: si un día cambia, el botón de
 *    /contenedores lo enseña como error y se vuelve a la llave.
 *  - Con llave (`GOOGLE_DRIVE_API_KEY`, opcional): API v3, con md5 para
 *    saber qué cambió.
 *
 *   DRIVE_PACKING_FOLDER_ID   id de la carpeta (lo que va después de /folders/)
 */
const API = "https://www.googleapis.com/drive/v3";

export interface ArchivoDrive {
  id: string;
  nombre: string;
  mime: string;
  md5: string | null;
  /** ISO; en el camino público solo trae la fecha del listado (sin hora) o null */
  modificadoEn: string | null;
  tamano: number | null;
}

export interface ConfigDrive {
  apiKey: string | null;
  carpeta: string;
}

/** Carpeta de packing lists de la fábrica (enlace del dueño, 9-sep-2026). */
export const CARPETA_PACKING_POR_DEFECTO = "1t6GMPFzKNtQ9-kKLBMpqra6o1upZRJSk";

export function configDrive(): ConfigDrive {
  return {
    apiKey: process.env.GOOGLE_DRIVE_API_KEY?.trim() || null,
    carpeta: process.env.DRIVE_PACKING_FOLDER_ID?.trim() || CARPETA_PACKING_POR_DEFECTO,
  };
}

export const MIME_SHEET = "application/vnd.google-apps.spreadsheet";
const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** ¿Es una hoja de cálculo que el lector de packing list puede abrir? */
export function esHojaDeCalculo(a: Pick<ArchivoDrive, "mime" | "nombre">): boolean {
  if (a.mime === MIME_SHEET || a.mime === MIME_XLSX || a.mime === "application/vnd.ms-excel") return true;
  return /\.xlsx?$/i.test(a.nombre);
}

async function pedir(url: string, opts?: { apiKey?: string | null }): Promise<Response> {
  const conLlave = opts?.apiKey ? `${url}${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(opts.apiKey)}` : url;
  const r = await fetch(conLlave, { signal: AbortSignal.timeout(30_000), redirect: "follow" });
  if (!r.ok) {
    const cuerpo = await r.text().catch(() => "");
    const detalle = cuerpo.match(/"message":\s*"([^"]{0,200})"/)?.[1] ?? cuerpo.replace(/<[^>]+>/g, " ").trim().slice(0, 200);
    throw new Error(`Drive ${r.status}: ${detalle || r.statusText}`);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Camino público (sin llave)
// ---------------------------------------------------------------------------
const decodificar = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/**
 * Lee la vista pública de la carpeta. Cada archivo viene como
 *   <div class="flip-entry" id="entry-ID"><a href="…"> … <div class="flip-entry-title">NOMBRE</div>
 *   … <div class="flip-entry-last-modified"><div>Sep 9, 2026</div></div>
 * Puro, para probarse con un HTML guardado.
 */
export function leerListadoPublico(html: string): ArchivoDrive[] {
  const salida: ArchivoDrive[] = [];
  // Se parte por cada `id="entry-…"` (la clase puede venir con más nombres
  // o en otro orden): de ahí hasta la siguiente entrada es un archivo.
  const partes = html.split(/(?=id="entry-)/).filter((p) => p.startsWith('id="entry-'));
  for (const b of partes) {
    const id = b.match(/^id="entry-([^"]+)"/)?.[1];
    const nombre =
      b.match(/flip-entry-title"[^>]*>([^<]*)</)?.[1] ??
      b.match(/aria-label="([^"]+)"/)?.[1] ??
      b.match(/title="([^"]+)"/)?.[1];
    if (!id || !nombre) continue;
    const href = b.match(/href="([^"]+)"/)?.[1] ?? "";
    const fecha = b.match(/flip-entry-last-modified"[^>]*>\s*(?:<div[^>]*>)?([^<]*)</)?.[1]?.trim();
    const ms = fecha ? Date.parse(fecha) : NaN;
    const esSheet = /docs\.google\.com\/spreadsheets/.test(href);
    salida.push({
      id,
      nombre: decodificar(nombre.trim()),
      mime: esSheet ? MIME_SHEET : /\.xlsx$/i.test(nombre) ? MIME_XLSX : /\.xls$/i.test(nombre) ? "application/vnd.ms-excel" : "",
      md5: null,
      modificadoEn: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
      tamano: null,
    });
  }
  return salida;
}

const URL_LISTADO_PUBLICO = (carpeta: string) => `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(carpeta)}#list`;

/** El HTML crudo del listado público, para la sonda de /api/contenedores/drive. */
export async function htmlListadoPublico(carpeta: string): Promise<{ status: number; html: string }> {
  const r = await fetch(URL_LISTADO_PUBLICO(carpeta), { signal: AbortSignal.timeout(30_000), redirect: "follow" });
  return { status: r.status, html: await r.text() };
}

async function listarPublico(carpeta: string): Promise<ArchivoDrive[]> {
  const r = await pedir(URL_LISTADO_PUBLICO(carpeta));
  const html = await r.text();
  const archivos = leerListadoPublico(html);
  if (!archivos.length) {
    const vacia = /no hay archivos|no files|carpeta vac/i.test(html);
    if (!vacia) {
      throw new Error(
        `Drive contestó pero no se reconoció ningún archivo (${html.length} caracteres, ${(html.match(/entry-/g) ?? []).length} marcas 'entry-'). ` +
          "Revisa que la carpeta esté compartida como 'Cualquier persona con el enlace' y usa la sonda ?diagnostico=1.",
      );
    }
  }
  return archivos;
}

async function descargarPublico(a: ArchivoDrive): Promise<Buffer> {
  const url =
    a.mime === MIME_SHEET
      ? `https://docs.google.com/spreadsheets/d/${a.id}/export?format=xlsx`
      : `https://drive.google.com/uc?export=download&id=${a.id}`;
  const r = await pedir(url);
  const tipo = r.headers.get("content-type") ?? "";
  const buffer = Buffer.from(await r.arrayBuffer());
  // Si Google contesta una página (aviso de virus, permiso), no es el archivo.
  if (/text\/html/i.test(tipo) && !buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    throw new Error(`Drive devolvió una página en vez del archivo ${a.nombre}: ¿está compartido con el enlace?`);
  }
  return buffer;
}

// ---------------------------------------------------------------------------
// Camino con llave (API v3)
// ---------------------------------------------------------------------------
async function listarConLlave(cfg: ConfigDrive): Promise<ArchivoDrive[]> {
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
    const r = await pedir(`${API}/files?${params.toString()}`, { apiKey: cfg.apiKey });
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
        modificadoEn: f.modifiedTime ?? null,
        tamano: f.size != null ? Number(f.size) : null,
      });
    }
    pageToken = j.nextPageToken ?? null;
  } while (pageToken);
  return salida;
}

async function descargarConLlave(cfg: ConfigDrive, a: ArchivoDrive): Promise<Buffer> {
  const url =
    a.mime === MIME_SHEET
      ? `${API}/files/${a.id}/export?mimeType=${encodeURIComponent(MIME_XLSX)}`
      : `${API}/files/${a.id}?alt=media&supportsAllDrives=true`;
  const r = await pedir(url, { apiKey: cfg.apiKey });
  return Buffer.from(await r.arrayBuffer());
}

// ---------------------------------------------------------------------------
/** Los archivos de la carpeta (sin los borrados), con su huella para saber si cambiaron. */
export function listarCarpetaDrive(cfg: ConfigDrive): Promise<ArchivoDrive[]> {
  return cfg.apiKey ? listarConLlave(cfg) : listarPublico(cfg.carpeta);
}

/** El contenido: un Excel tal cual, o una hoja de Google exportada a xlsx. */
export function descargarDrive(cfg: ConfigDrive, a: ArchivoDrive): Promise<Buffer> {
  return cfg.apiKey ? descargarConLlave(cfg, a) : descargarPublico(a);
}
