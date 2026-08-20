import { NextResponse, after, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { latido, latidoApagado } from "@/lib/servicios/latido";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Bandeja de entrada de los avisos de Mercado Libre.
 *
 * MELI exige un 200 en menos de 500 ms. Si tardas, reintenta; si sigues
 * tardando, te desactiva la suscripción y te quedas sin avisos sin enterarte.
 *
 * Por eso aquí NO se procesa nada antes de contestar: se guarda el aviso y
 * se responde. El trabajo de verdad lo hace el latido, que corre cuando
 * alguien tiene la app abierta — y si nadie la abre en una hora, este mismo
 * webhook lo enciende DESPUÉS de haber contestado (los avisos de MELI llegan
 * a toda hora, así que hacen de reloj sin necesidad de ningún cron).
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

    // Con la respuesta ya entregada: si el latido lleva más de una hora sin
    // correr (app cerrada), este aviso lo enciende. El candado de latido()
    // evita que dos avisos simultáneos lo dupliquen.
    const accountId = cuenta.id;
    after(async () => {
      if (await latidoApagado(admin, accountId)) {
        await latido(admin, accountId);
      }
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
