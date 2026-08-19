import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { partirEnVentanas } from "@/lib/amazon/recarga";

export const dynamic = "force-dynamic";

/** Tope de un año: más atrás Amazon ya no conserva los reportes de órdenes. */
const DIAS_MAX = 365;

/**
 * Encola una recarga histórica de ventas.
 *
 * Solo encola: el trabajo pesado lo hace el cron, una ventana por corrida. Si
 * esta ruta intentara descargar un año se quedaría sin plazo en el primer mes.
 *
 * Escribe con la sesión del usuario, no con service_role: así RLS confirma que
 * la cuenta de Amazon es suya y no hace falta comprobarlo a mano.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();

  const { data: sesion } = await supabase.auth.getUser();
  if (!sesion?.user) {
    return NextResponse.json({ error: "Inicia sesión." }, { status: 401 });
  }

  const cuenta = await cuentaAmazon(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "No hay cuenta de Amazon." }, { status: 404 });
  }

  const cuerpo = (await req.json().catch(() => ({}))) as { dias?: unknown };
  const dias = Math.min(Math.max(Math.round(Number(cuerpo.dias) || 0), 1), DIAS_MAX);
  if (!dias) {
    return NextResponse.json({ error: "Indica cuántos días recargar." }, { status: 400 });
  }

  // Si ya hay cola, no se apila otra encima: duplicaría el trabajo y la espera.
  const { count } = await supabase
    .from("amazon_recargas")
    .select("id", { count: "exact", head: true })
    .eq("account_id", cuenta.id)
    .in("estado", ["pendiente", "solicitado"]);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: `Ya hay una recarga en curso (${count} ventanas pendientes).` },
      { status: 409 },
    );
  }

  const ventanas = partirEnVentanas(cuenta.id, dias);
  const { error } = await supabase.from("amazon_recargas").insert(ventanas);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ dias, ventanas: ventanas.length });
}
