import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";
import { sincronizar } from "@/lib/yapanizcel/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sincroniza catálogo, stock en Full y ventas de la cuenta de YAPANIZCEL.
 *
 * Va por tramos: contesta con `completo: false` cuando se acabó el tiempo y
 * quedan ventas por bajar; la pantalla vuelve a llamar con `continuar: true`
 * hasta que termine. Así una cuenta grande no revienta la función.
 */
export async function POST(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const body = await req.json().catch(() => ({}));
  const continuar = Boolean(body?.continuar);
  const conStock = Boolean(body?.conStock);

  try {
    const resumen = await sincronizar(clienteAdmin(), ctx.cuenta.id, { presupuestoMs: 180_000, continuar, conStock });
    dispararPendientes(req);
    return NextResponse.json({ ok: true, resumen });
  } catch (err) {
    dispararPendientes(req);
    return errorJson(err);
  }
}

/** Los SKUs que quedaron pendientes se resuelven en segundo plano, con o sin éxito de lo demás. */
function dispararPendientes(req: NextRequest): void {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) return;
  const origen = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  fetch(`${origen}/api/yapanizcel/skus-pendientes`, { method: "POST", headers: { authorization: `Bearer ${secreto}` } }).catch(() => {});
}
