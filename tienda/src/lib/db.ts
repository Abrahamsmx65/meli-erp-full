import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config";

let cliente: SupabaseClient | null = null;

/**
 * La tienda habla con la base del ERP SOLO desde el servidor y con
 * service_role: las tablas tienda_* no tienen políticas para el público.
 * El navegador nunca ve esta llave.
 */
export function db(): SupabaseClient {
  if (!cliente) {
    cliente = createClient(config.supabaseUrl(), config.supabaseServiceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cliente;
}
