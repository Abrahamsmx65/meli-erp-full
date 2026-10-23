import { NextResponse, after } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import type { DB } from "@/lib/datos/repos";
import { conSesion } from "@/lib/yapanizcel/api";
import { clienteDeCuenta } from "@/lib/yapanizcel/cuenta";
import { bitacoraFundas } from "@/lib/servicios/bitacora-ofertas";
import { TAREA_BUEN_FIN, leerAceptadasBuenFin } from "@/lib/servicios/precios-modelos";
import { confirmarPromosFundas } from "@/lib/servicios/fundas-ofertas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

/**
 * «Confirmar Buen Fin» de fundas (Buen Fin y oferta de todos los días al PV
 * MELI del sheet). Trabaja por atrás como el de calzado: el POST contesta en
 * el acto y la pantalla pregunta con GET por la bitácora.
 */
export async function POST() {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const admin = clienteAdmin() as DB;
  const cuentaId = ctx.cuenta.id;
  const iniciado = new Date().toISOString();
  after(async () => {
    try {
      const cliente = await clienteDeCuenta(admin, cuentaId);
      await confirmarPromosFundas(admin, cliente, cuentaId, "manual", { buenFin: true });
    } catch (err) {
      await bitacoraFundas(admin, cuentaId).anotar(TAREA_BUEN_FIN, "error", {
        origen: "manual",
        error: (err as Error).message,
        inscritas: [],
        fallidas: [],
        omitidas: [],
        avisos: [],
      });
    }
  });
  return NextResponse.json({ iniciado }, { status: 202 });
}

/** La última corrida de Buen Fin de fundas y lo aceptado después. */
export async function GET() {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const admin = clienteAdmin() as DB;
  const bitacora = bitacoraFundas(admin, ctx.cuenta.id);
  const [ultima] = await bitacora.leer(TAREA_BUEN_FIN);
  if (!ultima) return NextResponse.json(null);
  const aceptadas = await leerAceptadasBuenFin(admin, ctx.cuenta.id, ultima.fin, bitacora).catch(() => []);
  return NextResponse.json({ fin: ultima.fin, detalle: ultima.detalle, aceptadas });
}
