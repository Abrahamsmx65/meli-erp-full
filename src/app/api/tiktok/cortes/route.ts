import { after } from "next/server";
import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { hacerCorte, hacerCorteAyer, hacerCorteLunes, pdfEtiquetasDelCorte, releerSinPrepararDeCortesRecientes } from "@/lib/servicios/tiktok-despacho";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Hace un corte: confirma todos los envíos pendientes en TikTok y los agrupa. */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  try {
    const admin = clienteAdmin();
    const opciones = {
      handover: (body?.handover === "DROP_OFF" ? "DROP_OFF" : "PICKUP") as "DROP_OFF" | "PICKUP",
      creadoPor: user.id,
      sinDefensa: body?.sinDefensa === true,
    };
    // Las guías se bajan y se guardan en cuanto se contesta: cuando el
    // usuario pida el PDF ya está armado.
    const calentar = (ids: number[]) =>
      after(async () => {
        for (const id of ids) await pdfEtiquetasDelCorte(admin, cuenta.id, id).catch(() => undefined);
        // Y los cortes recientes se ponen al día: lo que se canceló después
        // del corte deja de salir como faltante.
        await releerSinPrepararDeCortesRecientes(admin, cuenta.id).catch(() => undefined);
      });

    // "Corte lunes": primero TODO lo de antes de hoy (viernes, sábado,
    // domingo y lo más viejo, hasta las 23:59 de México) y luego lo de hoy.
    if (body?.modo === "lunes") {
      const r = await hacerCorteLunes(admin, cuenta.id, opciones);
      calentar(r.cortes.map((c) => c.corteId).filter((id): id is number => id != null));
      return NextResponse.json({ ok: true, modo: "lunes", ...r });
    }

    // "Corte ayer": UN corte con todo lo de antes de hoy (hasta ayer a las
    // 23:59 de México); lo de hoy se queda para mañana. Para adelantar
    // trabajo un día.
    if (body?.modo === "ayer") {
      const r = await hacerCorteAyer(admin, cuenta.id, opciones);
      calentar(r.cortes.map((c) => c.corteId).filter((id): id is number => id != null));
      return NextResponse.json({ ok: true, modo: "ayer", ...r });
    }

    const r = await hacerCorte(admin, cuenta.id, opciones);
    calentar(r.corteId != null ? [r.corteId] : []);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
