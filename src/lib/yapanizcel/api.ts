/**
 * Lo que todas las rutas de YAPANIZCEL hacen al entrar: comprobar sesión y
 * resolver la cuenta. Devuelve la respuesta de error lista para regresar,
 * o el contexto listo para trabajar.
 */
import { NextResponse } from "next/server";
import { clienteServidor } from "../supabase/server";
import { cuentaActiva, type CuentaYz } from "./cuenta";
import type { DB } from "../datos/repos";

export type Contexto =
  | { ok: true; db: DB; userId: string; cuenta: CuentaYz }
  | { ok: false; respuesta: NextResponse };

export async function conSesion(opts?: { sinCuenta?: boolean }): Promise<Contexto> {
  const db = await clienteServidor();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) {
    return { ok: false, respuesta: NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 }) };
  }
  const cuenta = await cuentaActiva(db);
  if (!cuenta && !opts?.sinCuenta) {
    return {
      ok: false,
      respuesta: NextResponse.json({ error: "Conecta primero la cuenta de Mercado Libre de YAPANIZCEL (en Ajustes)." }, { status: 400 }),
    };
  }
  return { ok: true, db, userId: user.id, cuenta: cuenta as CuentaYz };
}

export function errorJson(err: unknown, status = 500): NextResponse {
  return NextResponse.json({ error: (err as Error).message ?? String(err) }, { status });
}

/** Autenticación del cron de Vercel (bearer con CRON_SECRET). */
export function esCron(req: Request): boolean {
  const secreto = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  return Boolean(secreto) && auth === `Bearer ${secreto}`;
}
