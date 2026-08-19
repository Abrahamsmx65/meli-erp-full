import { NextResponse } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { MeliClient } from "@/lib/meli/client";
import { esEnTransito } from "@/lib/meli/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Radiografía del stock "en camino" a Full, tal como lo cuenta MELI hoy.
 *
 * Existe para validar la clasificación de estados con el dato enfrente: la
 * lista ESTADOS_EN_TRANSITO decide qué se suma al plan como "ya viene", y si
 * clasifica mal —contar como en-camino algo retenido que nunca llegará, o al
 * revés— el plan manda de más o de menos. Aquí se consulta a MELI en vivo
 * para una muestra de SKUs y se devuelve cada estado crudo con su cantidad y
 * cómo lo estamos clasificando.
 *
 * Es de lectura y pide sesión. Se puede borrar cuando el amarre del tránsito
 * quede validado.
 */
export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const admin = clienteAdmin();

  const { data: tok } = await admin
    .from("meli_tokens")
    .select("access_token, refresh_token, expira_en")
    .eq("account_id", cuenta.id)
    .single();
  if (!tok) return NextResponse.json({ error: "Sin tokens guardados." }, { status: 400 });

  const cliente = new MeliClient({
    clientId: process.env.MELI_CLIENT_ID!,
    clientSecret: process.env.MELI_CLIENT_SECRET!,
    credenciales: {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiraEn: new Date(tok.expira_en).getTime(),
    },
    alRenovar: async (c) => {
      await admin
        .from("meli_tokens")
        .update({
          access_token: c.accessToken,
          refresh_token: c.refreshToken,
          expira_en: new Date(c.expiraEn).toISOString(),
          actualizado_en: new Date().toISOString(),
        })
        .eq("account_id", cuenta.id);
    },
  });

  // Lo guardado, para comparar contra lo vivo.
  const { data: guardado } = await admin
    .from("stock_full")
    .select("sku, en_transferencia, no_disponible")
    .eq("account_id", cuenta.id)
    .or("en_transferencia.gt.0,no_disponible.gt.0")
    .order("en_transferencia", { ascending: false })
    .limit(18);

  const skusMuestra = (guardado ?? []).map((g) => g.sku as string);
  const { data: infos } = await admin
    .from("skus")
    .select("sku, inventory_id")
    .eq("account_id", cuenta.id)
    .in("sku", skusMuestra.length ? skusMuestra : ["—"]);
  const inventarioDe = new Map((infos ?? []).map((i) => [i.sku as string, i.inventory_id as string | null]));

  const { data: cta } = await admin
    .from("meli_accounts")
    .select("meli_user_id")
    .eq("id", cuenta.id)
    .single();

  // Cada estado crudo que MELI devuelve, con cuánto pesa y cómo lo leemos.
  const estatus = new Map<string, { pares: number; skus: number; seCuentaComoEnCamino: boolean }>();
  const porSku: Record<string, unknown>[] = [];

  for (const g of guardado ?? []) {
    const inventoryId = inventarioDe.get(g.sku as string);
    if (!inventoryId) continue;
    try {
      const r = await cliente.get<{
        available_quantity?: number;
        not_available_detail?: { status?: string; quantity?: number }[];
      }>(`/inventories/${inventoryId}/stock/fulfillment`, { seller_id: cta?.meli_user_id });

      const detalle = (r.not_available_detail ?? []).map((d) => ({
        status: d.status ?? "(sin estado)",
        pares: d.quantity ?? 0,
        seCuentaComoEnCamino: esEnTransito(d.status),
      }));

      for (const d of detalle) {
        const e = estatus.get(d.status) ?? { pares: 0, skus: 0, seCuentaComoEnCamino: d.seCuentaComoEnCamino };
        e.pares += d.pares;
        e.skus += 1;
        estatus.set(d.status, e);
      }

      porSku.push({
        sku: g.sku,
        guardado: { enCamino: g.en_transferencia, noDisponible: g.no_disponible },
        vivo: { disponible: r.available_quantity ?? 0, detalle },
      });
    } catch (err) {
      porSku.push({ sku: g.sku, error: (err as Error).message.slice(0, 150) });
    }
  }

  const { data: totales } = await admin
    .from("stock_full")
    .select("en_transferencia, no_disponible")
    .eq("account_id", cuenta.id);
  const totalTransito = (totales ?? []).reduce((a, t) => a + (t.en_transferencia ?? 0), 0);
  const totalNoDisp = (totales ?? []).reduce((a, t) => a + (t.no_disponible ?? 0), 0);

  return NextResponse.json({
    totalesGuardados: { paresEnCamino: totalTransito, paresNoDisponibles: totalNoDisp },
    estatusVistos: [...estatus.entries()]
      .map(([status, e]) => ({ status, ...e }))
      .sort((a, b) => b.pares - a.pares),
    muestra: porSku,
  });
}
