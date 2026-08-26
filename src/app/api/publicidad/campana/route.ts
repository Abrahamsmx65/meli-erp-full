import { NextResponse } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import {
  invalidarCachePublicidad,
  modificarCampanaAds,
} from "@/lib/servicios/publicidad";

export const dynamic = "force-dynamic";

/**
 * POST -> cambia el presupuesto diario y/o el ACOS objetivo de una campaña
 * de Product Ads.
 *
 * Cuerpo: { campanaId, presupuesto?, acosObjetivo? } — presupuesto en MXN,
 * ACOS objetivo en % (como lo maneja MELI). Al menos uno de los dos.
 */
export async function POST(req: Request) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "No hay cuenta de MELI conectada." }, { status: 400 });
  }

  const cuerpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const campanaId = String(cuerpo.campanaId ?? "");
  if (!/^\d+$/.test(campanaId)) {
    return NextResponse.json({ error: "Campaña inválida." }, { status: 400 });
  }

  const num = (x: unknown): number | undefined => {
    if (x == null || x === "") return undefined;
    const v = Number(x);
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  const presupuesto = num(cuerpo.presupuesto);
  const acosObjetivo = num(cuerpo.acosObjetivo);
  if (presupuesto == null && acosObjetivo == null) {
    return NextResponse.json(
      { error: "Manda presupuesto y/o ACOS objetivo (mayores a cero)." },
      { status: 400 },
    );
  }
  if (acosObjetivo != null && acosObjetivo > 100) {
    return NextResponse.json(
      { error: "El ACOS objetivo es un porcentaje: entre 0 y 100." },
      { status: 400 },
    );
  }

  const cliente = await clienteDeCuenta(clienteAdmin(), cuenta.id);
  if (!cliente) {
    return NextResponse.json(
      { error: "La cuenta no tiene tokens de MELI guardados." },
      { status: 500 },
    );
  }

  try {
    await modificarCampanaAds(cliente, cuenta.site_id, campanaId, {
      presupuesto,
      acosObjetivo,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "MELI no aceptó el cambio." },
      { status: 502 },
    );
  }

  invalidarCachePublicidad();
  return NextResponse.json({ ok: true, campanaId });
}
