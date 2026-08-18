import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { MeliClient } from "@/lib/meli/client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Radiografía de UNA publicación, tal como la devuelve MELI.
 *
 * Existe porque el catálogo descarta variantes por "venir sin SKU" y desde
 * afuera no hay forma de saber si el SKU falta de verdad en la publicación o
 * si está en un campo que el lector no mira. Devuelve la forma de la
 * respuesta —qué llaves trae cada variante y qué atributos— para poder
 * decidirlo con el dato enfrente en vez de adivinar.
 *
 * Es de lectura y pide sesión. Se puede borrar cuando el amarre esté resuelto.
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const itemId = req.nextUrl.searchParams.get("item");
  if (!itemId) return NextResponse.json({ error: "Falta ?item=MLM..." }, { status: 400 });

  const { data: tok } = await clienteAdmin()
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
      await clienteAdmin()
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

  try {
    const item = await cliente.get<Record<string, unknown>>(`/items/${itemId}`);
    const variaciones = (item.variations as Record<string, unknown>[] | undefined) ?? [];

    // Las variantes vienen sin atributos y sin seller_custom_field, pero
    // traen user_product_id. Si el SKU vive ahí, esto lo enseña.
    const upid = variaciones[0]?.user_product_id;
    let userProduct: unknown = null;
    if (upid) {
      try {
        const up = await cliente.get<Record<string, unknown>>(`/user-products/${upid}`);
        userProduct = {
          ok: true,
          llaves: Object.keys(up).sort(),
          atributos: ((up.attributes as Record<string, unknown>[] | undefined) ?? []).map((a) => ({
            id: a.id,
            value_name: a.value_name,
            values: a.values,
          })),
        };
      } catch (e) {
        userProduct = { ok: false, error: (e as Error).message };
      }
    }

    // ¿El stock de Full trae el SKU? Si sí, sale gratis: esa consulta ya se
    // hace para todo el catálogo y no la limita MELI como a /user-products.
    const inv = variaciones[0]?.inventory_id;
    let stockFull: unknown = null;
    if (inv) {
      try {
        const st = await cliente.get<Record<string, unknown>>(
          `/inventories/${inv}/stock/fulfillment`,
        );
        stockFull = { ok: true, llaves: Object.keys(st).sort(), crudo: st };
      } catch (e) {
        stockFull = { ok: false, error: (e as Error).message };
      }
    }

    // ¿user-products acepta varios ids de un jalón, como /items?
    const upids = variaciones
      .slice(0, 3)
      .map((v) => v.user_product_id)
      .filter(Boolean);
    let loteUserProducts: unknown = null;
    if (upids.length > 1) {
      try {
        const lote = await cliente.get<unknown>(`/user-products`, { ids: upids.join(",") });
        loteUserProducts = { ok: true, muestra: JSON.stringify(lote).slice(0, 600) };
      } catch (e) {
        loteUserProducts = { ok: false, error: (e as Error).message };
      }
    }

    return NextResponse.json({
      itemId,
      stockFull,
      loteUserProducts,
      userProductIdDeLaPrimera: upid ?? null,
      userProduct,
      llavesDelItem: Object.keys(item).sort(),
      skuDelItem: item.seller_custom_field ?? null,
      atributosDelItem: ((item.attributes as { id?: string }[] | undefined) ?? [])
        .map((a) => a.id)
        .filter(Boolean),
      totalVariantes: variaciones.length,
      // Las primeras tres bastan para ver la forma.
      variantes: variaciones.slice(0, 3).map((v) => ({
        id: v.id,
        llaves: Object.keys(v).sort(),
        seller_custom_field: v.seller_custom_field ?? null,
        atributos: ((v.attributes as Record<string, unknown>[] | undefined) ?? []).map((a) => ({
          id: a.id,
          value_name: a.value_name,
          values: a.values,
        })),
        combinaciones: v.attribute_combinations,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
