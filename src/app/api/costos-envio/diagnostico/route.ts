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
      variations?: { id: number | string; user_product_id?: string; inventory_id?: string; attributes?: unknown[] }[];
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

    // El simulador, con la medida guardada y con la de consenso del modelo.
    const precio = fila?.precio ?? item.price ?? null;
    const tipo = fila?.tipo_publicacion ?? item.listing_type_id ?? "gold_special";
    const guardada: Medida | null =
      fila?.alto != null ? { alto: fila.alto, ancho: fila.ancho, largo: fila.largo, peso: fila.peso } : null;
    const modelo = (await leerRevision(supabase, cuenta.id)).find((m) => m.modelo === (fila?.modelo ?? catalogo?.modelo));
    const consenso = modelo?.medidaReal ?? null;
    if (precio != null) {
      salida.simulador = {
        conMedidaGuardada: guardada ? await preguntarTarifa(cliente, cuenta.meli_user_id, guardada, precio, tipo) : null,
        conMedidaDeConsenso: consenso ? await preguntarTarifa(cliente, cuenta.meli_user_id, consenso, precio, tipo) : null,
        consenso,
      };
    }
  } catch (err) {
    salida.error = (err as Error).message;
  }

  return NextResponse.json(salida);
}
