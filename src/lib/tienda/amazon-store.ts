/**
 * Los banners y las imágenes de la TIENDA DE MARCA de GETAC en Amazon
 * (amazon.com.mx/stores/GETAC/…), para la portada de la tienda en línea.
 * Pedido del dueño, 1-oct-2026: «copia las imágenes y banners y todo».
 *
 * La API de Amazon (SP-API) no trae la tienda de marca: se lee la PÁGINA
 * pública desde el servidor del ERP y se sacan las imágenes que el dueño
 * subió a la tienda (`stores-image-uploads`). Motor puro: recibe el HTML.
 */

export interface ImagenTiendaAmazon {
  url: string;
  /** ancho que declara la URL (`.w3000.`, `_SX3000_`), si lo trae */
  ancho: number | null;
}

/** Imágenes subidas a la tienda de marca (banners, mosaicos) y de A+ del producto. */
const PATRON = /https?:\/\/m\.media-amazon\.com\/images\/S\/(?:stores-image-uploads|aplus-media)[^"'\s)\\]+?\.(?:jpe?g|png|webp)/gi;

function anchoDeUrl(url: string): number | null {
  const m = url.match(/\.w(\d{3,4})\./) ?? url.match(/_S[XL](\d{3,4})_/) ?? url.match(/_UX(\d{3,4})_/);
  return m ? Number(m[1]) : null;
}

/** La misma imagen en distintos tamaños comparte el nombre base: se queda la más grande. */
function claveBase(url: string): string {
  return url
    .replace(/\._[^/]*_\./, ".")
    .replace(/\.w\d{3,4}\./, ".")
    .replace(/\?.*$/, "");
}

/**
 * Las imágenes de la página en el orden en que aparecen (el banner principal
 * primero), sin repetir y en su tamaño más grande. `anchoMinimo` deja fuera
 * miniaturas.
 */
export function imagenesDeTiendaAmazon(html: string, anchoMinimo = 0): ImagenTiendaAmazon[] {
  const texto = String(html ?? "").replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
  const porBase = new Map<string, ImagenTiendaAmazon>();
  const orden: string[] = [];
  for (const m of texto.matchAll(PATRON)) {
    const url = m[0].replace(/&amp;/g, "&");
    const base = claveBase(url);
    const ancho = anchoDeUrl(url);
    const previa = porBase.get(base);
    if (!previa) {
      porBase.set(base, { url, ancho });
      orden.push(base);
    } else if ((ancho ?? 0) > (previa.ancho ?? 0)) {
      porBase.set(base, { url, ancho });
    }
  }
  return orden
    .map((b) => porBase.get(b)!)
    .filter((i) => anchoMinimo <= 0 || i.ancho == null || i.ancho >= anchoMinimo);
}

/** ¿Amazon contestó con su página de «no eres un robot» en lugar de la tienda? */
export function esPaginaDeCaptcha(html: string): boolean {
  return /captcha|Robot Check|api-services-support@amazon\.com/i.test(String(html ?? "").slice(0, 20_000));
}
