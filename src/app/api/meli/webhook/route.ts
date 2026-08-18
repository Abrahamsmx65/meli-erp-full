import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * Bandeja de entrada de los avisos de Mercado Libre.
 *
 * MELI exige un 200 en menos de 500 ms. Si tardas, reintenta; si sigues
 * tardando, te desactiva la suscripción y te quedas sin avisos sin enterarte.
 *
 * Por eso aquí NO se procesa nada: se guarda el aviso y se contesta. El
 * trabajo de verdad lo hace `procesarPendientes`, que corre cuando alguien
 * tiene la app abierta y en la pasada nocturna.
 *
 * Esta ruta es pública por necesidad —MELI no manda credenciales— así que se
 * valida que el aviso venga con la forma que MELI usa y que el vendedor sea
 * uno de los nuestros. Lo demás se descarta sin ruido.
 */
export async function POST(req: NextRequest) {
  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const topic = typeof cuerpo.topic === "string" ? cuerpo.topic : null;
  const resource = typeof cuerpo.resource === "string" ? cuerpo.resource : null;
  const meliUserId = Number(cuerpo.user_id);

  // Sin estos tres, el aviso no sirve para nada.
  if (!topic || !resource || !Number.isFinite(meliUserId)) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  try {
    const admin = clienteAdmin();

    const { data: cuenta } = await admin
      .from("meli_accounts")
      .select("id")
      .eq("meli_user_id", meliUserId)
      .maybeSingle();

    // Aviso de un vendedor que no es nuestro: 200 y a otra cosa, para que
    // MELI no lo reintente eternamente.
    if (!cuenta) return NextResponse.json({ ok: true }, { status: 200 });

    await admin.from("webhooks_meli").insert({
      account_id: cuenta.id,
      meli_user_id: meliUserId,
      topic,
      resource,
      raw: cuerpo,
    });
  } catch {
    // Aun si falla el guardado hay que contestar 200: un 500 hace que MELI
    // reintente y acabe suspendiendo la suscripción. El faltante lo recoge
    // la sincronización completa de la noche.
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

/** MELI valida la URL con un GET antes de activarla. */
export async function GET() {
  return NextResponse.json({ ok: true, servicio: "webhooks GETAC" });
}
