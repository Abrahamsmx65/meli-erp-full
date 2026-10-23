import { NextResponse, after } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { TAREA_BUEN_FIN, confirmarBuenFinPendientes, leerAceptadasBuenFin } from "@/lib/servicios/precios-modelos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

/**
 * Botón «Confirmar Buen Fin»: lo mismo que hace el cron de relámpagos con
 * Buen Fin, a mano. Inscribe o corrige cada promoción de Buen Fin al PV
 * normal de Números (a .99) y no toca la que ya está ni la que con el
 * aporte de MELI haría pagar el envío. Trabaja POR ATRÁS (22-oct-2026: con
 * 1,500 promociones tarda varios minutos y el navegador soltaba la conexión
 * con «Failed to fetch» aunque el servidor sí terminaba): el POST contesta
 * en el acto y la pantalla pregunta con GET por la bitácora `buen-fin-auto`.
 */
async function contexto() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 }) };
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return { error: NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 }) };
  return { cuentaId: cuenta.id, admin: clienteAdmin() as DB };
}

export async function POST() {
  const c = await contexto();
  if ("error" in c) return c.error;
  const cliente = await clienteDeCuenta(c.admin, c.cuentaId);
  if (!cliente) return NextResponse.json({ error: "La cuenta no tiene tokens de MELI guardados." }, { status: 500 });
  const iniciado = new Date().toISOString();
  after(async () => {
    try {
      await confirmarBuenFinPendientes(c.admin, cliente, c.cuentaId, "manual");
    } catch (err) {
      await c.admin.from("sync_log").insert({
        account_id: c.cuentaId,
        tarea: TAREA_BUEN_FIN,
        estado: "error",
        fin: new Date().toISOString(),
        detalle: { origen: "manual", error: (err as Error).message, inscritas: [], fallidas: [], omitidas: [], avisos: [] },
      });
    }
  });
  return NextResponse.json({ iniciado }, { status: 202 });
}

/** La última corrida (manual o del cron) de Buen Fin y lo aceptado después. */
export async function GET() {
  const c = await contexto();
  if ("error" in c) return c.error;
  const { data } = await c.admin
    .from("sync_log")
    .select("fin, detalle")
    .eq("account_id", c.cuentaId)
    .eq("tarea", TAREA_BUEN_FIN)
    .order("fin", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return NextResponse.json(null);
  // Lo aceptado a mano DESPUÉS de esa corrida, para que la pantalla no lo
  // vuelva a enseñar como rechazado.
  const aceptadas = await leerAceptadasBuenFin(c.admin, c.cuentaId, (data as { fin: string }).fin).catch(() => []);
  return NextResponse.json({ ...data, aceptadas });
}
