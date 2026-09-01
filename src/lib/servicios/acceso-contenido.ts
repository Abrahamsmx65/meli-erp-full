/**
 * La puerta del acceso sin contraseña a la sección de contenido.
 *
 * Quien trabaja el contenido de la marca no tiene cuenta en el ERP: entra con
 * un link secreto que abre ESA pantalla y nada más. Del otro lado se lee y se
 * escribe con service_role, o sea SIN RLS que sirva de red: el token es lo
 * único que separa a un extraño de esa sección. Por eso este módulo es el
 * ÚNICO lugar del código que convierte un token en permiso, y por eso el
 * token es de 64 hexadecimales y se compara en tiempo constante.
 *
 * El alcance está acotado a propósito: quien entra con el link puede palomear,
 * anotar, quitar modelos y bajar imágenes de la sección de contenido. No
 * alcanza ventas, costos, inventario, pedidos ni ninguna otra pantalla.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { clienteAdmin } from "../supabase/server";

/** 64 hexadecimales: lo que genera la migración y lo que genera `rotarToken`. */
const FORMA = /^[0-9a-f]{64}$/;

export interface CuentaAcceso {
  id: string;
  pais: string | null;
}

/** Compara sin filtrar por tiempo cuántos caracteres coincidieron. */
function igual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * La cuenta de Amazon a la que da acceso este token, o null si no vale.
 * Devuelve null también cuando la tabla todavía no existe (falta la 0033).
 */
export async function cuentaPorToken(token: string): Promise<CuentaAcceso | null> {
  const t = (token ?? "").trim().toLowerCase();
  if (!FORMA.test(t)) return null;

  const admin = clienteAdmin();
  const { data, error } = await admin.from("contenido_acceso").select("account_id, token");
  if (error) return null;

  const fila = ((data ?? []) as any[]).find((f) => igual(String(f.token ?? ""), t));
  if (!fila) return null;

  const { data: cuenta } = await admin
    .from("amazon_accounts")
    .select("id, pais")
    .eq("id", fila.account_id)
    .maybeSingle();

  return (cuenta as CuentaAcceso) ?? null;
}

/** El token vigente de una cuenta, para enseñárselo al dueño. */
export async function tokenDeCuenta(accountId: string): Promise<string | null> {
  const admin = clienteAdmin();
  const { data } = await admin
    .from("contenido_acceso")
    .select("token")
    .eq("account_id", accountId)
    .maybeSingle();
  return (data as any)?.token ?? null;
}

/**
 * Genera un token nuevo y deja muerto el anterior. Es la única forma de
 * revocar el acceso si el link se filtra.
 */
export async function rotarToken(accountId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const admin = clienteAdmin();
  const { error } = await admin
    .from("contenido_acceso")
    .upsert({ account_id: accountId, token, creado_en: new Date().toISOString() });
  if (error) throw new Error(`contenido_acceso: ${error.message}`);
  return token;
}
