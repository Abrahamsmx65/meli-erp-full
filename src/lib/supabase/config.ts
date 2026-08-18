/**
 * Datos públicos de conexión a Supabase.
 *
 * La URL y la llave anon son públicas por diseño: viajan al navegador en
 * cada carga. Lo que protege los datos NO es que esta llave sea secreta,
 * sino las políticas de RLS — cada quien solo alcanza los renglones de su
 * propia cuenta, y la tabla de tokens de MELI no tiene políticas en
 * absoluto, así que ni siquiera el dueño la puede leer desde el navegador.
 *
 * Por eso vienen con valor por omisión: así el despliegue funciona de
 * inmediato y solo hay que capturar a mano lo que sí es secreto
 * (service_role y las credenciales de Mercado Libre).
 */
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://iodgqfqwphchuwlynvzn.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "sb_publishable_oguADBZ5MYROGU6OYmjS-g_b_4iVlpQ";
