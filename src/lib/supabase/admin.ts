import { SUPABASE_URL } from "./config";

/**
 * Cliente con service_role: SALTA RLS.
 *
 * Vive aparte de server.ts (que trae next/headers) para que los módulos de
 * servicios que también llegan a componentes de cliente puedan importarlo.
 *
 * Solo para trabajo de servidor que el usuario no puede hacer por sí mismo
 * (leer tokens de MELI, correr el cron de sincronización). Nunca se debe
 * importar desde un componente de cliente.
 */
export function clienteAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en el entorno.");

  const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
