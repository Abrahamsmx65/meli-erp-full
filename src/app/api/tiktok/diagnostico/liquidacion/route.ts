import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { VERSION_TRANSACCIONES, VERSION_TRANSACCIONES_VIEJA } from "@/lib/tiktok/api";
import { estadoDePago, interpretarTransacciones } from "@/lib/tiktok/liquidacion";
import { clienteDeCuenta } from "@/lib/servicios/tiktok";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sonda de finanzas de UN pedido, sin escribir nada: le pide a TikTok sus
 * transacciones por las dos versiones del endpoint (la 202501, que trae
 * también las no liquidadas, y la 202309, solo liquidadas) y contesta el
 * crudo de cada una más cómo lo interpreta el ERP. Sirve para ver con un
 * pedido en camino qué dice TikTok que va a pagar antes de liquidarlo.
 *
 *   /api/tiktok/diagnostico/liquidacion?pedido=586212369477043968
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const orderId = req.nextUrl.searchParams.get("pedido")?.trim();
  if (!orderId) return NextResponse.json({ error: "Falta ?pedido=" }, { status: 400 });

  const cliente = await clienteDeCuenta(clienteAdmin(), cuenta.id, 50_000);
  if (!cliente || !cliente.tienda.shopCipher) return NextResponse.json({ error: "TikTok Shop no está conectado." }, { status: 400 });

  const resultado: Record<string, unknown> = { pedido: orderId };
  for (const version of [VERSION_TRANSACCIONES, VERSION_TRANSACCIONES_VIEJA]) {
    try {
      const crudo = await cliente.llamar<any>("GET", `/finance/${version}/orders/${encodeURIComponent(orderId)}/statement_transactions`);
      const t = interpretarTransacciones(crudo);
      resultado[`v${version}`] = { crudo, interpretado: t, estado: estadoDePago(t) };
    } catch (err) {
      resultado[`v${version}`] = { error: (err as Error).message };
    }
  }
  return NextResponse.json(resultado);
}
