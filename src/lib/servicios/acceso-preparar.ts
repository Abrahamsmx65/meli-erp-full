/**
 * La puerta del acceso sin contraseña a la estación de "Preparar pedidos".
 *
 * Los empleados que empacan no tienen cuenta en el ERP: entran con un link
 * secreto que abre ESA pantalla y nada más. Del otro lado se lee y se
 * escribe con service_role, o sea SIN RLS que sirva de red: el token es lo
 * único que separa a un extraño de esa sección. Por eso este módulo es el
 * ÚNICO lugar del código que convierte un token en permiso, el token es de
 * 64 hexadecimales y se compara en tiempo constante — calcado de
 * `acceso-contenido.ts`.
 *
 * Alcance, acotado a propósito: con el link se ven los cortes de TikTok
 * (número, renglones, SKU, pedido, destinatario), se marcan paquetes como
 * preparados y se hace el CONTEO CÍCLICO del almacén de TikTok (escribe
 * `ajuste` en el kardex de TikTok y publica el disponible, decisión del
 * dueño: los que cuentan son los que empacan). No alcanza ventas, costos,
 * los otros almacenes, ni hacer cortes, ni ninguna otra pantalla.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { clienteAdmin } from "../supabase/server";

const FORMA = /^[0-9a-f]{64}$/;

function igual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** La cuenta del ERP a la que da acceso este token, o null si no vale. */
export async function cuentaPorTokenPreparar(token: string): Promise<{ id: string } | null> {
  const t = (token ?? "").trim().toLowerCase();
  if (!FORMA.test(t)) return null;

  const admin = clienteAdmin();
  const { data, error } = await admin.from("tiktok_acceso").select("account_id, token");
  if (error) return null;

  const fila = ((data ?? []) as any[]).find((f) => igual(String(f.token ?? ""), t));
  return fila ? { id: String(fila.account_id) } : null;
}

/**
 * ¿La clave de supervisor es la de esta cuenta? Es la que permite dar un
 * paquete por preparado SIN escanear. Sin clave capturada en la base, nada
 * pasa: contesta false siempre.
 */
export async function pinSupervisorValido(accountId: string, pin: string): Promise<boolean> {
  const dado = String(pin ?? "").trim();
  if (!dado || dado.length > 64) return false;
  const admin = clienteAdmin();
  const { data } = await admin.from("tiktok_acceso").select("pin_supervisor").eq("account_id", accountId).maybeSingle();
  const real = String((data as any)?.pin_supervisor ?? "").trim();
  return real.length > 0 && igual(real, dado);
}

/** El token vigente de una cuenta, para enseñárselo al dueño. */
export async function tokenPreparar(accountId: string): Promise<string | null> {
  const admin = clienteAdmin();
  const { data } = await admin.from("tiktok_acceso").select("token").eq("account_id", accountId).maybeSingle();
  return (data as any)?.token ?? null;
}

/** Genera un token nuevo y deja muerto el anterior: la única forma de revocar el link. */
export async function rotarTokenPreparar(accountId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const admin = clienteAdmin();
  const { error } = await admin
    .from("tiktok_acceso")
    .upsert({ account_id: accountId, token, creado_en: new Date().toISOString() });
  if (error) throw new Error(`tiktok_acceso: ${error.message}`);
  return token;
}
