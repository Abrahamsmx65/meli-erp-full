import { NextResponse } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import type { DB } from "@/lib/datos/repos";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";
import { clienteDeCuenta } from "@/lib/yapanizcel/cuenta";
import { bitacoraFundas } from "@/lib/servicios/bitacora-ofertas";
import { aceptarBuenFinAMinimo } from "@/lib/servicios/precios-modelos";
import { renglonesParaAceptar } from "@/lib/precios/buen-fin-grupos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Acepta al precio más alto que deja MELI las de Buen Fin de fundas que rechazó por precio. */
export async function POST(req: Request) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const renglones = renglonesParaAceptar(await req.json().catch(() => null));
  if (!renglones.length) return NextResponse.json({ error: "No hay promociones que aceptar." }, { status: 400 });
  const admin = clienteAdmin() as DB;
  try {
    const cliente = await clienteDeCuenta(admin, ctx.cuenta.id);
    return NextResponse.json({ resultados: await aceptarBuenFinAMinimo(admin, cliente, ctx.cuenta.id, renglones, bitacoraFundas(admin, ctx.cuenta.id)) });
  } catch (err) {
    return errorJson(err);
  }
}
