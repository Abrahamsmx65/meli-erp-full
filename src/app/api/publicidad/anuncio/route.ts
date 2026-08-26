import { NextResponse } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import {
  cambiarEstadoAnuncio,
  invalidarCachePublicidad,
} from "@/lib/servicios/publicidad";

export const dynamic = "force-dynamic";

/**
 * POST -> pausa o enciende un anuncio de Product Ads.
 *
 * Cuerpo: { itemId, estado: "paused" | "active", modelo?, motivo? }
 *
 * Al pausar se apunta en `publicidad_pausas` (la memoria de POR QUÉ se pausó);
 * al encender se marca reactivado. De ahí salen los recordatorios de
 * "ya rellenaste, enciende el anuncio" del panel.
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
  const itemId = String(cuerpo.itemId ?? "");
  const estado =
    cuerpo.estado === "paused" ? "paused" : cuerpo.estado === "active" ? "active" : null;
  if (!/^ML[A-Z]\d{4,}$/.test(itemId) || !estado) {
    return NextResponse.json({ error: "Petición inválida." }, { status: 400 });
  }
  const modelo = String(cuerpo.modelo ?? "").slice(0, 40);
  const motivo = String(cuerpo.motivo ?? "").slice(0, 200);
  const campanaId = /^\d+$/.test(String(cuerpo.campanaId ?? ""))
    ? String(cuerpo.campanaId)
    : null;

  const cliente = await clienteDeCuenta(clienteAdmin(), cuenta.id);
  if (!cliente) {
    return NextResponse.json(
      { error: "La cuenta no tiene tokens de MELI guardados." },
      { status: 500 },
    );
  }

  try {
    await cambiarEstadoAnuncio(cliente, cuenta.site_id, itemId, estado, campanaId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "MELI no aceptó el cambio." },
      { status: 502 },
    );
  }

  // La memoria de pausas es cortesía: si la tabla aún no existe, el cambio
  // en MELI ya quedó y no se reporta como error.
  try {
    if (estado === "paused") {
      await supabase.from("publicidad_pausas").upsert(
        {
          account_id: cuenta.id,
          item_id: itemId,
          modelo,
          motivo,
          pausado_en: new Date().toISOString(),
          reactivado_en: null,
        },
        { onConflict: "account_id,item_id" },
      );
    } else {
      await supabase
        .from("publicidad_pausas")
        .update({ reactivado_en: new Date().toISOString() })
        .eq("account_id", cuenta.id)
        .eq("item_id", itemId);
    }
  } catch {
    // sin memoria de pausa, pero el anuncio ya cambió en MELI
  }

  invalidarCachePublicidad();
  return NextResponse.json({ ok: true, itemId, estado });
}
