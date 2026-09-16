/**
 * Roles de acceso. Sin dependencias del servidor: lo importa el middleware
 * (que corre en el borde) y las pantallas.
 *
 * Hasta el 16-sep-2026 el ERP era de una persona. Ese día el dueño pidió
 * un usuario para quien empaca TikTok que vea TODO lo de TikTok y NADA
 * más. El rol viaja en el JWT de Supabase (`app_metadata.rol`, que solo
 * se escribe desde la base): sin él, es el dueño.
 */

export type Rol = "dueño" | "tiktok";

export function rolDeSesion(user: { app_metadata?: Record<string, unknown> | null } | null | undefined): Rol {
  return user?.app_metadata?.rol === "tiktok" ? "tiktok" : "dueño";
}

/** A dónde cae cada rol al entrar o al pedir algo que no es suyo. */
export function destinoPorOmision(rol: Rol): string {
  return rol === "tiktok" ? "/tiktok/despacho" : "/";
}

/**
 * Lo único que alcanza el rol de TikTok: la sección de TikTok, la
 * estación de preparar (que es de TikTok), el login y salir. Los avisos y
 * callbacks de máquinas ya son públicos por su cuenta.
 */
const PREFIJOS_TIKTOK = ["/tiktok", "/api/tiktok", "/preparar", "/api/preparar-publico", "/login", "/auth", "/api/salir"];

export function rutaPermitida(rol: Rol, ruta: string): boolean {
  if (rol !== "tiktok") return true;
  const limpia = ruta.replace(/\/{2,}/g, "/");
  return PREFIJOS_TIKTOK.some((p) => limpia === p || limpia.startsWith(p + "/") || limpia.startsWith(p + "?"));
}

/** Los grupos del menú que ve cada rol (por título). */
export function grupoVisible(rol: Rol, titulo: string | null): boolean {
  if (rol !== "tiktok") return true;
  return titulo === "TikTok Shop";
}
