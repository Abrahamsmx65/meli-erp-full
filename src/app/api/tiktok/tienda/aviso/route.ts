import { after, NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { avisarCambioInventario } from "@/lib/servicios/tienda-pedidos";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * La tienda en línea (`tienda/`, otro despliegue) avisa aquí cada vez que
 * aparta o suelta pares: un pedido nuevo, un pago, uno que caducó. Contesta
 * en el acto y en el fondo le publica a TikTok el disponible nuevo
 * (`sincronizarTikTok` con `soloPedidos`: primero lee los pedidos de
 * TikTok, luego escribe). Sin sesión: la puerta es el bearer TIENDA_SECRET.
 *
 * Cuerpo: { cuenta: "<account_id>" }
 */
export async function POST(req: NextRequest) {
  const secreto = (process.env.TIENDA_SECRET ?? "").trim();
  const auth = req.headers.get("authorization") ?? "";
  if (!secreto || auth !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const cuenta = String(body?.cuenta ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(cuenta)) return NextResponse.json({ error: "Falta la cuenta." }, { status: 400 });

  const admin = clienteAdmin();
  after(async () => {
    const avisos = await avisarCambioInventario(admin, cuenta);
    await admin.from("tiktok_sync_log").insert({
      account_id: cuenta,
      tarea: "tienda-aviso",
      inicio: new Date().toISOString(),
      fin: new Date().toISOString(),
      estado: avisos.length ? "con avisos" : "ok",
      detalle: { motivo: body?.motivo ?? null, avisos },
    });
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}
