import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import {
  leerRevision,
  medidasDeAtributos,
  preguntarTarifa,
  type Medida,
} from "@/lib/servicios/costos-envio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Solo los atributos que hablan de medidas, para que se lea de un vistazo. */
function soloMedidas(atributos: unknown[] | undefined) {
  return (atributos ?? []).filter((a) => {
    const id = String((a as { id?: string })?.id ?? "");
    return id.includes("PACKAGE") || id.includes("WEIGHT") || id.includes("DIMENSION");
  });
}

/**
 * Sonda SIN escribir nada: para un SKU (`?sku=GT229-TABACO BROWN-24-MX`),
 * qué dice MELI HOY en cada lugar donde puede vivir la medida —el item, la
 * variación y el user product— y qué contesta el simulador con la medida
 * que tenemos guardada y con la de consenso. Es para entender dónde puso
 * MELI la corrección cuando la pantalla sigue viendo la medida vieja.
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const sku = (req.nextUrl.searchParams.get("sku") ?? "").trim();
  if (!sku) return NextResponse.json({ error: "Falta ?sku=" }, { status: 400 });

  const cliente = await clienteDeCuenta(clienteAdmin(), cuenta.id);
  if (!cliente) return NextResponse.json({ error: "Sin tokens de MELI." }, { status: 500 });

  const { data: fila } = await supabase
    .from("medidas_envio")
    .select("*")
    .eq("account_id", cuenta.id)
    .eq("sku", sku)
    .maybeSingle();
  const { data: catalogo } = await supabase
    .from("skus")
    .select("sku, item_id, variation_id, user_product_id, inventory_id, modelo, activo")
    .eq("account_id", cuenta.id)
    .eq("sku", sku)
    .maybeSingle();

  const itemId = fila?.item_id ?? catalogo?.item_id ?? null;
  if (!itemId) return NextResponse.json({ error: "Ese SKU no tiene publicación.", fila, catalogo }, { status: 404 });

  const salida: Record<string, unknown> = { sku, guardado: fila, catalogo };

  try {
    const item = await cliente.get<{
      id: string;
      price?: number;
      listing_type_id?: string;
      shipping?: unknown;
      attributes?: unknown[];
      variations?: { id: number | string; price?: number; user_product_id?: string; inventory_id?: string; attributes?: unknown[] }[];
    }>(`/items/${itemId}`, undefined, { reintentos: 1 });
    const variacion =
      item.variations?.find((v) => String(v.id) === String(catalogo?.variation_id ?? "")) ?? null;
    salida.item = {
      id: item.id,
      price: item.price,
      listing_type_id: item.listing_type_id,
      shipping: item.shipping,
      medidas: medidasDeAtributos(item.attributes as never),
      atributos: soloMedidas(item.attributes),
      variaciones: item.variations?.length ?? 0,
    };
    salida.variacion = variacion
      ? {
          id: variacion.id,
          user_product_id: variacion.user_product_id ?? null,
          inventory_id: variacion.inventory_id ?? null,
          medidas: medidasDeAtributos(variacion.attributes as never),
          atributos: soloMedidas(variacion.attributes),
        }
      : null;

    const up = variacion?.user_product_id ?? catalogo?.user_product_id ?? fila?.user_product_id ?? null;
    if (up) {
      try {
        const cuerpo = await cliente.get<{ attributes?: unknown[] }>(`/user-products/${up}`, undefined, { reintentos: 1 });
        salida.userProduct = {
          id: up,
          medidas: medidasDeAtributos(cuerpo.attributes as never),
          atributos: soloMedidas(cuerpo.attributes),
        };
      } catch (err) {
        salida.userProduct = { id: up, error: (err as Error).message };
      }
    }

    // Los precios que MELI le conoce a la publicación: el de lista, el de la
    // promoción vigente y el de reventa. El costo de envío cambia de tramo con
    // el precio ($299–$498 lleva descuento; desde $499 se paga completo), así
    // que el simulador se pregunta con CADA precio distinto.
    const precios: { origen: string; precio: number }[] = [];
    const agregar = (origen: string, p: unknown) => {
      if (typeof p === "number" && p > 0 && !precios.some((x) => x.precio === p)) precios.push({ origen, precio: p });
    };
    agregar("guardado en medidas_envio", fila?.precio != null ? Number(fila.precio) : null);
    agregar("item.price (lista)", item.price);
    if (variacion) agregar("variación.price", (variacion as { price?: number }).price);
    try {
      const sp = await cliente.get<{ amount?: number; regular_amount?: number; metadata?: unknown }>(
        `/items/${itemId}/sale_price`,
        { context: "channel_marketplace" },
        { reintentos: 1 },
      );
      salida.salePrice = sp;
      agregar("sale_price.amount (lo que ve el comprador)", sp?.amount);
      agregar("sale_price.regular_amount", sp?.regular_amount);
    } catch (err) {
      salida.salePrice = { error: (err as Error).message };
    }
    try {
      const pr = await cliente.get<{ prices?: { type?: string; amount?: number; conditions?: unknown }[] }>(
        `/items/${itemId}/prices`,
        undefined,
        { reintentos: 1 },
      );
      salida.prices = pr?.prices?.map((x) => ({ type: x.type, amount: x.amount, conditions: x.conditions }));
      for (const x of pr?.prices ?? []) agregar(`prices[${x.type}]`, x.amount);
    } catch (err) {
      salida.prices = { error: (err as Error).message };
    }

    // El simulador, con la medida guardada y con la de consenso del modelo,
    // a cada precio.
    const tipo = fila?.tipo_publicacion ?? item.listing_type_id ?? "gold_special";
    const guardada: Medida | null =
      fila?.alto != null
        ? { alto: Number(fila.alto), ancho: Number(fila.ancho), largo: Number(fila.largo), peso: Number(fila.peso) }
        : null;
    const modelo = (await leerRevision(supabase, cuenta.id)).find((m) => m.modelo === (fila?.modelo ?? catalogo?.modelo));
    const consenso = modelo?.medidaReal ?? null;
    const simulador: unknown[] = [];
    for (const { origen, precio } of precios) {
      try {
        simulador.push({
          precio,
          origen,
          conMedidaGuardada: guardada ? await preguntarTarifa(cliente, cuenta.meli_user_id, guardada, precio, tipo) : null,
          conMedidaDeConsenso: consenso ? await preguntarTarifa(cliente, cuenta.meli_user_id, consenso, precio, tipo) : null,
        });
      } catch (err) {
        simulador.push({ precio, origen, error: (err as Error).message });
      }
    }
    salida.simulador = { tipo, guardada, consenso, porPrecio: simulador };
  } catch (err) {
    salida.error = (err as Error).message;
  }

  return NextResponse.json(salida);
}
