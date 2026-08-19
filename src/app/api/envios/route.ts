import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { obtenerPlan, invalidar } from "@/lib/servicios/cache";
import { separarEnvios } from "@/lib/servicios/envios";
import { marcarRecibido, registrarEnvio } from "@/lib/servicios/envios-registrados";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Registrar que un envío del plan ya se dio de alta en Mercado Libre.
 *
 * Desde ese clic, las cajas del envío dejan de contar como disponibles en
 * bodega y sus pares cuentan como en camino a Full: el plan ya no puede
 * volver a sugerirlas. Es el puente que MELI no da por API.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const grupo = typeof body?.grupo === "string" ? body.grupo.trim() : "";
  if (!grupo) return NextResponse.json({ error: "Falta el envío (grupo)." }, { status: 400 });

  const { plan } = await obtenerPlan(supabase, cuenta.id);
  const { envios } = await separarEnvios(supabase, cuenta.id, plan.cajas);
  const envio = envios.find((e) => e.grupo === grupo);
  if (!envio) {
    return NextResponse.json(
      { error: "Ese envío ya no está en el plan. Recalcula y vuelve a intentar." },
      { status: 404 },
    );
  }

  try {
    const id = await registrarEnvio(supabase, cuenta.id, envio);
    await invalidar(clienteAdmin(), cuenta.id, "Se registró un envío a Full en camino.");
    return NextResponse.json({ ok: true, id, cajas: envio.totalCajas, pares: envio.totalPares });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** Marcar un envío registrado como recibido en Full. */
export async function PATCH(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Falta el id del envío." }, { status: 400 });

  try {
    await marcarRecibido(supabase, id);
    await invalidar(clienteAdmin(), cuenta.id, "Un envío a Full llegó: hay que replanear.");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
