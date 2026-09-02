import { clienteAdmin, clienteServidor } from "./supabase/server";

export interface Admin {
  correo: string;
  nombre: string | null;
}

/**
 * Quién está en el panel. Devuelve null si no hay sesión o si el correo no
 * está en ev_administradores: tener cuenta no basta, hay que estar invitado.
 */
export async function adminActual(): Promise<Admin | null> {
  const supabase = await clienteServidor();
  const { data } = await supabase.auth.getUser();
  const correo = data.user?.email?.toLowerCase();
  if (!correo) return null;

  const { data: fila } = await clienteAdmin()
    .from("ev_administradores")
    .select("correo, nombre")
    .ilike("correo", correo)
    .maybeSingle();
  return fila ? { correo: fila.correo, nombre: fila.nombre } : null;
}

export async function exigirAdmin(): Promise<Admin> {
  const admin = await adminActual();
  if (!admin) throw new Error("Sin permiso.");
  return admin;
}
