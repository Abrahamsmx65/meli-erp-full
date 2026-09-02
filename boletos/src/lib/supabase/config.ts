/**
 * Datos públicos de conexión a Supabase. La URL y la llave anon viajan al
 * navegador; lo que protege los datos es que TODAS las tablas ev_ tienen RLS
 * sin políticas: solo el servidor (service_role) las alcanza.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function supabaseConfigurado(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
