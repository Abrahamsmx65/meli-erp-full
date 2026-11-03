import { NextResponse } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import type { DB } from "@/lib/datos/repos";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";
import { clienteDeCuenta } from "@/lib/yapanizcel/cuenta";
import { confirmarPromosFundas } from "@/lib/servicios/fundas-ofertas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

/** «Confirmar relámpagos» de fundas: lo mismo que el cron, a mano. */
export async function POST() {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const admin = clienteAdmin() as DB;
  try {
    const cliente = await clienteDeCuenta(admin, ctx.cuenta.id);
    const { relampagos } = await confirmarPromosFundas(admin, cliente, ctx.cuenta.id, "manual", { relampagos: true });
    return NextResponse.json(relampagos);
  } catch (err) {
    return errorJson(err);
  }
}
