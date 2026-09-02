import { NextResponse, after, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";
import { sincronizar } from "@/lib/yapanizcel/sync";
import { correrPendientes as resolverPendientesLuego } from "@/lib/yapanizcel/pendientes";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sincroniza catálogo, stock en Full y ventas de la cuenta de YAPANIZCEL.
 *
 * Va por tramos: contesta con `completo: false` cuando se acabó el tiempo y
 * quedan ventas por bajar; la pantalla vuelve a llamar con `continuar: true`
 * hasta que termine. Así una cuenta grande no revienta la función.
 *
 * Al terminar, el resolutor de SKUs pendientes corre en este MISMO proceso
 * con `after()`: un fetch de la función a sí misma no salía de Vercel, y
 * el resolutor pasó horas sin correr.
 */
export async function POST(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const body = await req.json().catch(() => ({}));
  const continuar = Boolean(body?.continuar);
  const conStock = Boolean(body?.conStock);
  const origen = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;

  try {
    const resumen = await sincronizar(clienteAdmin(), ctx.cuenta.id, { presupuestoMs: 180_000, continuar, conStock });
    // Solo cuando la sincronización terminó: si todavía quedan tramos, la
    // pantalla va a volver a llamar y no conviene encimar dos procesos.
    if (resumen.completo) after(() => resolverPendientesLuego(origen));
    return NextResponse.json({ ok: true, resumen });
  } catch (err) {
    return errorJson(err);
  }
}
