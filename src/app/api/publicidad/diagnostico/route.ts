import { NextResponse } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { resolverAdvertiser } from "@/lib/servicios/publicidad";

export const dynamic = "force-dynamic";

/**
 * GET -> diagnóstico del permiso de escritura de Product Ads.
 *
 * MELI contesta "User does not have permission to write" al modificar una
 * campaña. Este endpoint fuerza una renovación de token (la respuesta del
 * OAuth trae los scopes REALES) y separa las dos causas posibles:
 *
 * - el token NO trae el scope write -> es cosa de la app en el DevCenter y
 *   de reconectar en Ajustes;
 * - el token SÍ trae write -> el bloqueo es el ROL del usuario dentro de
 *   Mercado Ads (el advertiser): hay que revisarlo en la consola de
 *   publicidad, no en el DevCenter.
 */
export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "No hay cuenta de MELI conectada." }, { status: 400 });
  }

  const cliente = await clienteDeCuenta(clienteAdmin(), cuenta.id);
  if (!cliente) {
    return NextResponse.json(
      { error: "La cuenta no tiene tokens de MELI guardados." },
      { status: 500 },
    );
  }

  try {
    await cliente.renovarAhora();
  } catch (err) {
    return NextResponse.json(
      { error: `No se pudo renovar el token: ${err instanceof Error ? err.message : err}` },
      { status: 502 },
    );
  }

  let advertiser: { advertiserId: string; siteId: string } | null = null;
  let errorAdvertiser: string | null = null;
  try {
    advertiser = await resolverAdvertiser(cliente, cuenta.site_id);
  } catch (err) {
    errorAdvertiser = err instanceof Error ? err.message : String(err);
  }

  const scope = cliente.scope;
  const tieneWrite = scope != null && scope.split(/\s+/).includes("write");

  return NextResponse.json({
    meli_user_id: cuenta.meli_user_id,
    nickname: cuenta.nickname,
    advertiser,
    errorAdvertiser,
    scopes: scope ?? "(MELI no reportó scopes en la renovación)",
    tieneScopeWrite: scope == null ? null : tieneWrite,
    conclusion:
      scope == null
        ? "MELI no regresó los scopes; renueva la conexión en Ajustes y vuelve a abrir este diagnóstico."
        : tieneWrite
          ? "El token SÍ trae el scope write: el bloqueo NO es la app, es el rol del usuario dentro de Mercado Ads. En la consola de Publicidad de Mercado Libre (Publicidad → configuración → usuarios del advertiser) revisa que esta cuenta sea administrador del advertiser, o que el advertiser no esté administrado por otra cuenta/agencia."
          : "El token NO trae el scope write: en el DevCenter la app necesita el scope de escritura marcado, y después hay que RECONECTAR Mercado Libre en Ajustes (renovar no basta: el scope se fija al autorizar).",
  });
}
