import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

/** Cliente con la sesión del usuario (solo se usa para saber quién entró). */
export async function clienteServidor() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (lista) => {
        try {
          for (const { name, value, options } of lista) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Los Server Components no escriben cookies; el middleware ya
          // refrescó la sesión.
        }
      },
    },
  });
}

/**
 * Cliente con service_role: SALTA RLS. Es la única forma de leer las tablas
 * ev_. Nunca importarlo desde un componente de cliente.
 */
export function clienteAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
