import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { invalidar } from "@/lib/servicios/cache";

export const dynamic = "force-dynamic";

/**
 * Tachar / destachar un envío pendiente de Industher. Tachado = no cuenta
 * como "en camino a Full" para el plan.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const body = await req.json().catch(() => null);
  const envioId = String(body?.envioId ?? "").trim();
  const omitir = Boolean(body?.omitir);
  if (!envioId) return NextResponse.json({ error: "Falta el id del envío." }, { status: 400 });

  const r = omitir
    ? await supabase.from("envios_pendientes_omitidos").upsert({
        account_id: cuenta.id,
        envio_id: envioId,
      })
    : await supabase
        .from("envios_pendientes_omitidos")
        .delete()
        .eq("account_id", cuenta.id)
        .eq("envio_id", envioId);

  if (r.error) {
    const falta = /envios_pendientes_omitidos/.test(r.error.message);
    return NextResponse.json(
      {
        error: falta
          ? "Falta aplicar la migración 0014 (tabla envios_pendientes_omitidos)."
          : r.error.message,
      },
      { status: 400 },
    );
  }

  await invalidar(supabase, cuenta.id, "Cambió qué envíos pendientes cuentan como en camino.");
  return NextResponse.json({ ok: true });
}
