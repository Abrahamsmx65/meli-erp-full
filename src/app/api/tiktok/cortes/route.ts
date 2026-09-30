import { after } from "next/server";
import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { calentarEtiquetasDelCorte, conCandadoDeCorte, ERROR_CORTE_EN_CURSO, hacerCorte, hacerCorteAyer, hacerCorteLunes, releerSinPrepararDeCortesRecientes } from "@/lib/servicios/tiktok-despacho";
import { contarSinTiempo } from "@/lib/tiktok/lunes";
import { dispararEtiquetasDelCorte } from "@/lib/servicios/disparar-etiquetas";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Hace un corte: confirma todos los envíos pendientes en TikTok y los agrupa. */
export async function POST(req: NextRequest) {
  const inicioRuta = Date.now();
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
    // Las etiquetas se arman y se guardan en cuanto se contesta, con TODO
    // el rato que le quede a la función (hasta ~5 min): cuando el usuario
    // pida el PDF ya está en el bucket. Si el corte se quedó por tiempo
    // (viene otra ronda que se le va a unir y renumerar), solo se bajan las
    // guías: armar tomos que se van a tirar es trabajo perdido. Lo que no
    // alcance aquí lo sigue un ESLABÓN de fondo (`dispararEtiquetasDelCorte`
    // → POST a `/calentar` con CRON_SECRET, que se encadena hasta acabar):
    // TikTok da ~1 guía por segundo y un corte grande necesita más de lo
    // que le queda a esta función. Dueño, 30-sep-2026: «que después de
    // confirmar el corte se hagan y se guarden ahí».
    const origen = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
    const calentar = (cortes: { corteId: number | null; errores?: { orderId: string; error: string }[] }[]) =>
      after(async () => {
        for (const c of cortes) {
          if (c.corteId == null) continue;
          const restante = 295_000 - (Date.now() - inicioRuta) - 5_000;
          const soloGuias = contarSinTiempo(c.errores ?? []) > 0;
          let falta = true;
          if (restante >= 20_000) {
            const r = await calentarEtiquetasDelCorte(admin, cuenta.id, c.corteId, restante, { soloGuias }).catch(() => null);
            falta = !r || r.ocupado ? !r : !r.completo || r.guiasSinRevisar > 0 || soloGuias;
          }
          if (falta) await dispararEtiquetasDelCorte(origen, cuenta.id, c.corteId, 1);
        }
        // Y los cortes recientes se ponen al día: lo que se canceló después
        // del corte deja de salir como faltante.
        await releerSinPrepararDeCortesRecientes(admin, cuenta.id).catch(() => undefined);
      });

    // "Corte lunes": primero TODO lo de antes de hoy (viernes, sábado,
    // domingo y lo más viejo, hasta las 23:59 de México) y luego lo de hoy.
    if (body?.modo === "lunes") {
      const r = await conCandadoDeCorte(admin, cuenta.id, () => hacerCorteLunes(admin, cuenta.id, opciones));
      calentar(r.cortes);
      return NextResponse.json({ ok: true, modo: "lunes", ...r });
    }

    // "Corte ayer": UN corte con todo lo de antes de hoy (hasta ayer a las
    // 23:59 de México); lo de hoy se queda para mañana. Para adelantar
    // trabajo un día.
    if (body?.modo === "ayer") {
      const r = await conCandadoDeCorte(admin, cuenta.id, () => hacerCorteAyer(admin, cuenta.id, opciones));
      calentar(r.cortes);
      return NextResponse.json({ ok: true, modo: "ayer", ...r });
    }

    const r = await conCandadoDeCorte(admin, cuenta.id, () => hacerCorte(admin, cuenta.id, opciones));
    calentar([r]);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    const m = (err as Error).message;
    return NextResponse.json({ error: m }, { status: m === ERROR_CORTE_EN_CURSO ? 409 : 500 });
  }
}
