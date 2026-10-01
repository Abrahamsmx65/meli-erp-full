import "server-only";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { config } from "./config";
import { db } from "./db";

/**
 * Cuentas de cliente SIN contraseña: el cliente escribe su correo, le llega
 * un código de 6 dígitos (10 min, 5 intentos) y queda una sesión de 60 días
 * en una cookie httpOnly. Las tablas son de la tienda (tienda_clientes,
 * tienda_codigos, tienda_sesiones): un cliente NO es usuario del ERP.
 */
export const COOKIE = "getac_sesion";
const MINUTOS_CODIGO = 10;
const INTENTOS = 5;
const DIAS_SESION = 60;

function huella(valor: string): string {
  return createHmac("sha256", config.secretoSesion()).update(valor).digest("hex");
}

export function correoValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Crea un código nuevo para ese correo. Devuelve el código en claro para mandarlo. */
export async function nuevoCodigo(email: string): Promise<string> {
  const cuenta = config.cuenta();
  // Freno: no más de 5 códigos por correo cada 15 min.
  const desde = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count } = await db()
    .from("tienda_codigos")
    .select("id", { count: "exact", head: true })
    .eq("account_id", cuenta)
    .eq("email", email)
    .gte("creado_en", desde);
  if ((count ?? 0) >= 5) throw new Error("Pediste muchos códigos. Espera 15 minutos y vuelve a intentar.");

  const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { error } = await db().from("tienda_codigos").insert({
    account_id: cuenta,
    email,
    codigo_hash: huella(`${email}:${codigo}`),
    expira_en: new Date(Date.now() + MINUTOS_CODIGO * 60_000).toISOString(),
  });
  if (error) throw new Error("No se pudo crear el código.");
  return codigo;
}

/** Revisa el código y abre la sesión. Devuelve el id del cliente o un error para enseñar. */
export async function entrarConCodigo(email: string, codigo: string): Promise<{ clienteId: string } | { error: string }> {
  const cuenta = config.cuenta();
  const { data: fila } = await db()
    .from("tienda_codigos")
    .select("id, codigo_hash, intentos, expira_en, usado_en")
    .eq("account_id", cuenta)
    .eq("email", email)
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!fila || fila.usado_en || Date.parse(fila.expira_en) < Date.now()) {
    return { error: "El código ya no sirve. Pide uno nuevo." };
  }
  if (fila.intentos >= INTENTOS) return { error: "Demasiados intentos. Pide un código nuevo." };

  const esperado = Buffer.from(fila.codigo_hash, "hex");
  const dado = Buffer.from(huella(`${email}:${codigo.replace(/\D/g, "")}`), "hex");
  if (esperado.length !== dado.length || !timingSafeEqual(esperado, dado)) {
    await db().from("tienda_codigos").update({ intentos: fila.intentos + 1 }).eq("id", fila.id);
    return { error: "El código no coincide." };
  }
  await db().from("tienda_codigos").update({ usado_en: new Date().toISOString() }).eq("id", fila.id);

  const { data: cliente, error } = await db()
    .from("tienda_clientes")
    .upsert({ account_id: cuenta, email, ultimo_acceso: new Date().toISOString() }, { onConflict: "account_id,email" })
    .select("id")
    .single();
  if (error || !cliente) return { error: "No se pudo abrir tu cuenta." };

  const token = randomBytes(32).toString("base64url");
  const expira = new Date(Date.now() + DIAS_SESION * 86_400_000);
  await db().from("tienda_sesiones").insert({ token_hash: huella(token), cliente_id: cliente.id, expira_en: expira.toISOString() });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expira,
  });
  return { clienteId: cliente.id };
}

export interface Cliente {
  id: string;
  email: string;
  nombre: string | null;
  telefono: string | null;
  direccion: Record<string, string> | null;
}

export async function clienteActual(): Promise<Cliente | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const { data } = await db()
    .from("tienda_sesiones")
    .select("expira_en, tienda_clientes!inner(id, email, nombre, telefono, direccion, account_id)")
    .eq("token_hash", huella(token))
    .maybeSingle();
  const c = (data as any)?.tienda_clientes;
  if (!data || !c || Date.parse((data as any).expira_en) < Date.now() || c.account_id !== config.cuenta()) return null;
  return { id: c.id, email: c.email, nombre: c.nombre, telefono: c.telefono, direccion: c.direccion };
}

export async function salir(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db().from("tienda_sesiones").delete().eq("token_hash", huella(token));
  jar.delete(COOKIE);
}

/** Para comparar el token público de un pedido sin filtrar tiempos. */
export function mismoToken(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}
