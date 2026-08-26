import type { NextRequest } from "next/server";

/**
 * El dominio REAL con el que entró la petición, desde los headers del proxy
 * de Vercel. NEXT_PUBLIC_APP_URL no es confiable para esto: si trae el valor
 * de relleno del ejemplo ("https://tu-app.vercel.app"), el auto-relanzamiento
 * del vigilante de videos le pega a un dominio que no existe y muere en
 * silencio — el video termina en Higgsfield pero la app no se entera.
 */
export function origenReal(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}`;
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env && !env.includes("tu-app")) return env;
  return req.nextUrl.origin;
}
