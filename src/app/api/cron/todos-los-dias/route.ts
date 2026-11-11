import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import type { DB } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { confirmarBuenFinPendientes, TAREA_TODOS_LOS_DIAS } from "@/lib/servicios/precios-modelos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

/**
 * 8:00 de México (14:00Z, vercel.json): inscribe o corrige al PV normal de
 * Números (a .99) TODA publicación de calzado que MELI tenga como candidata
 * o inscrita en la oferta de TODOS LOS DÍAS («Activa Tus Descuentos» o lo que
 * el dueño asignó a esa clase; dueño, 11-nov-2026: «que entre automáticamente
 * a lo mejor de todos los días todo lo que se puede, una vez al día a las
 * 8 am»). El mismo motor que Buen Fin: no toca lo que ya está a ese precio,
 * lo que con el aporte de MELI cruza los $299 ni los modelos sin precio, y
 * relee lo inscrito. Bitácora `sync_log` tarea `todos-los-dias-auto`.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const presentado = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!presentado || !process.env.CRON_SECRET || presentado !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const admin = clienteAdmin() as DB;
  const { data: cuentas } = await admin.from("meli_accounts").select("id").order("creado_en", { ascending: true }).limit(1);
  const cuentaId = (cuentas ?? [])[0]?.id as string | undefined;
  if (!cuentaId) return NextResponse.json({ error: "Sin cuenta de Mercado Libre." }, { status: 404 });
  const cliente = await clienteDeCuenta(admin, cuentaId);
  if (!cliente) return NextResponse.json({ error: "La cuenta no tiene tokens de MELI." }, { status: 500 });
  try {
    const r = await confirmarBuenFinPendientes(admin, cliente, cuentaId, "cron", undefined, {
      clases: ["todos_los_dias"],
      tarea: TAREA_TODOS_LOS_DIAS,
    });
    return NextResponse.json({ modelos: r.modelos, inscritas: r.inscritas.length, fallidas: r.fallidas.length, omitidas: r.omitidas.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
