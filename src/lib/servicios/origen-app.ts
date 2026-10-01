import type { NextRequest } from "next/server";

/**
 * El origen con el que el servidor se habla A SÍ MISMO (los eslabones de
 * fondo: etiquetas de un corte, publicación en TikTok, SKUs pendientes).
 *
 * SIEMPRE el dominio de producción que Vercel reporta
 * (`VERCEL_PROJECT_PRODUCTION_URL`), nunca `NEXT_PUBLIC_APP_URL`: esa
 * variable apunta a otro dominio del proyecto que está detrás de la
 * autenticación de Vercel, así que el POST con el bearer de CRON_SECRET
 * nunca llegaba a la función (ni un 202 en los logs ni un renglón de
 * `etiquetas` en la bitácora en tres días; el 1-oct-2026 el corte #45 de
 * 611 pedidos se quedó con 23 guías y las etiquetas salieron 64 minutos
 * después, a golpes del cron de 15 min). La misma lección que el link de
 * los empleados en /tiktok/despacho. Fuera de Vercel (local), el origen de
 * la petición.
 */
export function origenDeLaApp(req: NextRequest): string {
  const dominio = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim();
  if (dominio) return `https://${dominio}`.replace(/\/+$/, "");
  return req.nextUrl.origin.replace(/\/+$/, "");
}
