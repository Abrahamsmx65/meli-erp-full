/**
 * Configuración que NO es secreta de raíz y puede vivir en la base
 * (tabla ev_config, RLS sin políticas: solo el servidor la lee). Así en
 * Vercel solo hace falta capturar SUPABASE_SERVICE_ROLE_KEY. Una variable de
 * entorno con el mismo nombre siempre gana sobre la base.
 */
import { headers } from "next/headers";
import { clienteAdmin } from "./supabase/server";

const CLAVES = ["SMTP_USUARIO", "SMTP_CLAVE", "SMTP_HOST", "SMTP_PUERTO", "RESEND_API_KEY", "CORREO_REMITENTE", "CORREO_ORGANIZADOR", "URL_BASE"] as const;
export type ClaveConfig = (typeof CLAVES)[number];

let cache: { en: number; valores: Partial<Record<ClaveConfig, string>> } | null = null;

export async function leerConfig(): Promise<Partial<Record<ClaveConfig, string>>> {
  if (cache && Date.now() - cache.en < 60_000) return cache.valores;
  const valores: Partial<Record<ClaveConfig, string>> = {};
  try {
    const { data } = await clienteAdmin().from("ev_config").select("clave, valor");
    for (const fila of data ?? []) {
      if ((CLAVES as readonly string[]).includes(fila.clave) && fila.valor) valores[fila.clave as ClaveConfig] = fila.valor;
    }
  } catch (e) {
    console.warn("[config] No se pudo leer ev_config:", e);
  }
  for (const c of CLAVES) {
    const env = process.env[c] ?? (c === "URL_BASE" ? process.env.NEXT_PUBLIC_URL_BASE : undefined);
    if (env) valores[c] = env;
  }
  cache = { en: Date.now(), valores };
  return valores;
}

/**
 * Dirección pública del sitio, para el QR y los correos. Se toma de la
 * petición actual (así funciona en cualquier dominio de Vercel sin
 * configurar nada); URL_BASE, si está capturada, gana.
 */
export async function urlBase(): Promise<string> {
  const cfg = await leerConfig();
  if (cfg.URL_BASE) return cfg.URL_BASE.replace(/\/+$/, "");
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
    if (host) return `${proto}://${host}`;
  } catch {
    // Fuera de una petición (no debería pasar en este proyecto).
  }
  return "";
}
