import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { motivosUsadosEnCancelaciones } from "@/lib/tiktok/api";
import { clienteDeCuenta } from "@/lib/servicios/tiktok";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Resumen de los MOTIVOS de cancelación de la tienda, tal como TikTok los
 * tiene (el ERP no guarda el motivo por pedido; TikTok sí, en su búsqueda
 * de cancelaciones). Agrupa por quién canceló (SELLER, BUYER, SYSTEM…) y
 * por motivo, con el texto en español y las veces. Pedido del dueño el
 * 24-sep-2026 («veo que tengo 1485 pedidos cancelados, ¿tendrías el
 * resumen de los motivos?»). Solo lectura.
 *
 *   /api/tiktok/diagnostico/cancelaciones?dias=45&paginas=40
 *
 * TikTok entrega 50 por página: 40 páginas cubren 2,000 cancelaciones.
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const dias = Math.min(180, Math.max(1, Number(req.nextUrl.searchParams.get("dias") ?? 45) || 45));
  const paginas = Math.min(80, Math.max(1, Number(req.nextUrl.searchParams.get("paginas") ?? 40) || 40));

  const admin = clienteAdmin();
  const cliente = await clienteDeCuenta(admin, cuenta.id, 100_000);
  if (!cliente || !cliente.tienda.shopCipher) return NextResponse.json({ error: "TikTok Shop no está conectado." }, { status: 400 });

  try {
    const motivos = await motivosUsadosEnCancelaciones(cliente, { dias, paginas });
    const total = motivos.reduce((a, m) => a + m.veces, 0);
    const porRol = new Map<string, number>();
    for (const m of motivos) porRol.set(m.rol ?? "(sin rol)", (porRol.get(m.rol ?? "(sin rol)") ?? 0) + m.veces);
    return NextResponse.json({
      dias,
      total,
      porQuien: [...porRol].map(([rol, veces]) => ({ rol, veces })).sort((a, b) => b.veces - a.veces),
      motivos: motivos.map((m) => ({ quien: m.rol, motivo: m.motivo, texto: m.texto, veces: m.veces, porcentaje: total ? Math.round((m.veces / total) * 1000) / 10 : 0 })),
      nota: total >= paginas * 50 ? `Se leyeron ${paginas} páginas de 50 y puede haber más: sube ?paginas=.` : null,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
