/**
 * Banners e imágenes de la tienda de marca de GETAC en Amazon para la
 * portada de la tienda en línea (pedido del dueño, 1-oct-2026: «copia las
 * imágenes y banners y todo»).
 *
 * La SP-API no trae la tienda de marca, así que el servidor del ERP lee la
 * página pública (y sus subpáginas: cada sección de la tienda de marca) y
 * guarda lo que encuentra masticado en `app_cache` clave `tienda:amazon-store`.
 * Se relee cada `HORAS_RELEER`. Si Amazon contesta con captcha o error, se
 * conserva la lectura anterior y queda constancia en `tiktok_sync_log`
 * tarea `tienda-banners`.
 */
import { esPaginaDeCaptcha, imagenesDeTiendaAmazon, type ImagenTiendaAmazon } from "../tienda/amazon-store";
import { guardarCacheApp, leerCacheAppGuardado } from "./cache-app";

export const CLAVE_TIENDA_AMAZON = "tienda:amazon-store";
export const HORAS_RELEER = 24;
const MAX_SUBPAGINAS = 12;
const URL_POR_OMISION =
  "https://www.amazon.com.mx/stores/GETAC/page/A5A41BF4-FD17-43AF-8AD3-868027EC627F";

export interface PaginaTiendaAmazon {
  url: string;
  titulo: string | null;
  imagenes: ImagenTiendaAmazon[];
}

export interface TiendaAmazonGuardada {
  leidoEn: string;
  paginas: PaginaTiendaAmazon[];
}

const CABECERAS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "Accept-Language": "es-MX,es;q=0.9",
  Accept: "text/html,application/xhtml+xml",
};

function tituloDe(html: string): string | null {
  const t = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
  if (!t) return null;
  // «Amazon.com.mx: GETAC: Botas» → «Botas»
  const partes = t.split(":").map((p) => p.trim()).filter(Boolean);
  return partes[partes.length - 1] || t;
}

function subpaginas(html: string, base: string): string[] {
  const urls = new Set<string>();
  const texto = html.replace(/\\\//g, "/");
  for (const m of texto.matchAll(/\/stores\/[^"'\s?#]*\/page\/([0-9A-F-]{36})/gi)) {
    urls.add(new URL(m[0], base).toString());
  }
  return [...urls];
}

async function leerPagina(url: string): Promise<{ html: string | null; status: number; motivo?: string }> {
  try {
    const r = await fetch(url, { headers: CABECERAS, redirect: "follow", signal: AbortSignal.timeout(20_000), cache: "no-store" });
    const html = await r.text();
    if (!r.ok) return { html: null, status: r.status, motivo: `HTTP ${r.status}` };
    if (esPaginaDeCaptcha(html)) return { html: null, status: r.status, motivo: "Amazon pidió captcha" };
    return { html, status: r.status };
  } catch (err) {
    return { html: null, status: 0, motivo: (err as Error).message };
  }
}

export async function leerTiendaAmazon(
  admin: any,
  accountId: string,
  opciones: { forzar?: boolean } = {},
): Promise<{ paginas: number; imagenes: number; omitido?: boolean; avisos: string[] }> {
  if (!opciones.forzar) {
    const previo = await leerCacheAppGuardado<TiendaAmazonGuardada>(admin, accountId, CLAVE_TIENDA_AMAZON);
    if (previo.estado === "encontrado" && Date.now() - Date.parse(previo.valor.generadoEn) < HORAS_RELEER * 3_600_000) {
      return { paginas: previo.valor.datos.paginas.length, imagenes: 0, omitido: true, avisos: [] };
    }
  }
  const inicio = new Date().toISOString();
  const raiz = (process.env.TIENDA_AMAZON_STORE_URL ?? "").trim() || URL_POR_OMISION;
  const avisos: string[] = [];
  const principal = await leerPagina(raiz);
  const paginas: PaginaTiendaAmazon[] = [];
  if (principal.html) {
    paginas.push({ url: raiz, titulo: tituloDe(principal.html), imagenes: imagenesDeTiendaAmazon(principal.html) });
    const raizId = raiz.match(/page\/([0-9A-F-]{36})/i)?.[1]?.toUpperCase();
    const otras = subpaginas(principal.html, raiz).filter((u) => !raizId || !u.toUpperCase().includes(raizId)).slice(0, MAX_SUBPAGINAS);
    for (const u of otras) {
      const p = await leerPagina(u);
      if (p.html) paginas.push({ url: u, titulo: tituloDe(p.html), imagenes: imagenesDeTiendaAmazon(p.html) });
      else avisos.push(`${u}: ${p.motivo}`);
    }
  } else {
    avisos.push(`No se pudo leer la tienda de Amazon: ${principal.motivo}`);
  }

  const total = paginas.reduce((s, p) => s + p.imagenes.length, 0);
  // Solo se reemplaza lo guardado si esta lectura trajo imágenes.
  if (total > 0) {
    await guardarCacheApp(admin, accountId, CLAVE_TIENDA_AMAZON, { leidoEn: new Date().toISOString(), paginas } satisfies TiendaAmazonGuardada, 0);
  }
  await admin.from("tiktok_sync_log").insert({
    account_id: accountId,
    tarea: "tienda-banners",
    inicio,
    fin: new Date().toISOString(),
    estado: total > 0 ? "ok" : "sin imágenes",
    detalle: {
      raiz,
      status: principal.status,
      paginas: paginas.map((p) => ({ url: p.url, titulo: p.titulo, imagenes: p.imagenes.length })),
      avisos,
      muestra: principal.html && total === 0 ? principal.html.slice(0, 1500) : null,
    },
  });
  return { paginas: paginas.length, imagenes: total, avisos };
}
