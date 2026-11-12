/**
 * La puerta del link para PUBLICAR productos nuevos en MELI sin cuenta en
 * el ERP (dueño, 12-nov-2026: «un link por separado con acceso general para
 * que Michel pueda publicar sin tener que ingresar a la plataforma»).
 *
 * Mismo patrón que `acceso-contenido.ts`: del otro lado se trabaja con
 * service_role, así que el token (64 hexadecimales, comparado en tiempo
 * constante) es lo único que separa a un extraño de esta pantalla, y este
 * módulo es el ÚNICO lugar que lo convierte en permiso. Alcance: leer la
 * ficha de un modelo, subir fotos y crear publicaciones de calzado (nacen
 * pausadas). No alcanza ventas, costos, inventario ni ninguna otra pantalla.
 * Si el link se filtra, el dueño lo cambia y el anterior muere.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { clienteAdmin } from "../supabase/admin";

const FORMA = /^[0-9a-f]{64}$/;

function igual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** La cuenta de MELI a la que da acceso este token, o null si no vale. */
export async function cuentaDePublicarPorToken(token: string): Promise<string | null> {
  const t = (token ?? "").trim().toLowerCase();
  if (!FORMA.test(t)) return null;
  const { data, error } = await clienteAdmin().from("meli_publicar_acceso").select("account_id, token");
  if (error) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fila = ((data ?? []) as any[]).find((f) => igual(String(f.token ?? ""), t));
  return fila ? String(fila.account_id) : null;
}

/** El token vigente de la cuenta, para enseñarle el link al dueño. */
export async function tokenDePublicar(accountId: string): Promise<string | null> {
  const { data } = await clienteAdmin().from("meli_publicar_acceso").select("token").eq("account_id", accountId).maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = String((data as any)?.token ?? "");
  return FORMA.test(token) ? token : null;
}

/** Crea el link o lo cambia: el token anterior deja de servir. */
export async function rotarTokenDePublicar(accountId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const { error } = await clienteAdmin()
    .from("meli_publicar_acceso")
    .upsert({ account_id: accountId, token, creado_en: new Date().toISOString() });
  if (error) throw new Error(`meli_publicar_acceso: ${error.message}`);
  return token;
}

/** Apaga el link. */
export async function quitarTokenDePublicar(accountId: string): Promise<void> {
  // Sin borrar el renglón: un token que no cumple la forma no abre nada.
  const { error } = await clienteAdmin()
    .from("meli_publicar_acceso")
    .upsert({ account_id: accountId, token: "apagado", creado_en: new Date().toISOString() });
  if (error) throw new Error(`meli_publicar_acceso: ${error.message}`);
}
