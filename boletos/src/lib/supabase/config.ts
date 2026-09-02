/**
 * Datos públicos de conexión a Supabase (proyecto "boletos-eventos",
 * dggekhkkcbhpizrriwmi). La URL y la llave publishable viajan al navegador
 * por diseño; lo que protege los datos es que TODAS las tablas ev_ tienen
 * RLS sin políticas: solo el servidor (service_role) las alcanza.
 *
 * Vienen con valor por omisión para que el despliegue arranque solo y
 * únicamente haya que capturar lo secreto (service_role, Resend).
 */
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://dggekhkkcbhpizrriwmi.supabase.co";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "sb_publishable_cHVS-3KVm_WyLwbWFEavkg_kuPuk138";

/** Solo en el servidor: además de lo público, hace falta la llave de servicio. */
export function supabaseConfigurado(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
