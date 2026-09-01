import { NextResponse } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";
import { sincronizar } from "@/lib/yapanizcel/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Sincroniza catálogo, stock en Full y ventas de la cuenta de YAPANIZCEL. */
export async function POST() {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  try {
    const resumen = await sincronizar(clienteAdmin(), ctx.cuenta.id);
    return NextResponse.json({ ok: true, resumen });
  } catch (err) {
    return errorJson(err);
  }
}
