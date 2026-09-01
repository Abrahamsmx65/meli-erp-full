import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { calcularCostos, leerRevision, sincronizarMedidas } from "@/lib/servicios/costos-envio";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** La revisión guardada: qué mide cada publicación y cuánto cobra de más. */
export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const modelos = await leerRevision(supabase, cuenta.id);
  return NextResponse.json({ ok: true, modelos });
}

/**
 * Vuelve a revisar: relee las medidas de MELI y le pregunta al simulador los
 * costos que falten.
 *
 * Va en dos pasos porque el segundo puede tardar: la primera revisión de un
 * catálogo completo son miles de llamadas al simulador. `pendientes > 0`
 * significa "se acabó el tiempo de la función, vuelve a llamarme"; todo lo
 * ya calculado queda guardado, así que la siguiente pasada arranca donde
 * quedó y las de después son casi instantáneas.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const cliente = await clienteDeCuenta(clienteAdmin(), cuenta.id);
  if (!cliente) return NextResponse.json({ error: "Sin tokens de MELI." }, { status: 500 });

  const cuerpo = (await req.json().catch(() => ({}))) as { medidas?: boolean };

  try {
    const arranque = Date.now();
    // Las medidas se llevan la mitad del tiempo y los costos la otra mitad:
    // así una pasada siempre avanza en las dos cosas, y ninguna se queda
    // esperando a que la otra termine el catálogo entero.
    const medidas =
      cuerpo.medidas === false
        ? null
        : await sincronizarMedidas(cliente, supabase, cuenta.id, { limiteMs: 130_000 });

    const costos = await calcularCostos(cliente, supabase, cuenta.id, cuenta.meli_user_id, {
      limiteMs: Math.max(30_000, 260_000 - (Date.now() - arranque)),
    });

    return NextResponse.json({
      ok: true,
      medidas,
      costos,
      pendientes: (medidas?.pendientes ?? 0) + costos.pendientes,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
