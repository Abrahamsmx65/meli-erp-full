import { NextResponse } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { mensajeMeli } from "@/lib/servicios/listados";
import { TAREA_BUEN_FIN } from "@/lib/servicios/precios-modelos";
import { MeliError, type MeliClient } from "@/lib/meli/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Sonda de una promoción de Buen Fin que MELI rechazó por precio
 * (ERROR_CREDIBILITY_DISCOUNTED_PRICE; 22-oct-2026, dueño: «sí debe haber
 * alguna parte que dice el precio mínimo»). `/seller-promotions/items/{id}`
 * no trae `min_discounted_price` en las DEAL, así que aquí se lee TODO lo
 * que MELI dice de esa publicación y esa promoción (la publicación, sus
 * precios, el listado de la promoción con ese item, la promoción) y se
 * vuelve a mandar el precio rechazado para guardar el error COMPLETO
 * (`cause`, status, cuerpo). Un POST rechazado no inscribe nada.
 *
 * `?item=MLM…&promo=P-MLM…&precio=249.99`; sin `item` toma la primera
 * fallida por credibilidad de la última corrida. Deja el crudo en `sync_log`
 * tarea `buen-fin-diagnostico`.
 */
const crudo = (x: unknown, max = 8000) => {
  const s = JSON.stringify(x ?? null);
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

async function leer(cliente: MeliClient, ruta: string, params?: Record<string, string>) {
  try {
    return { ruta, params, ok: true, respuesta: JSON.parse(crudo(await cliente.get(ruta, params, { reintentos: 1 }))) };
  } catch (err) {
    const e = err instanceof MeliError ? { status: err.status, cuerpo: err.cuerpo } : null;
    return { ruta, params, ok: false, error: mensajeMeli(err), ...e };
  }
}

interface Fallida {
  donde: string;
  aceptar?: { itemId: string; promoId: string | null; tipo: string; queriamos: number; razon: string; offerId: string | null };
}

export async function GET(req: Request) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  const admin = clienteAdmin() as DB;
  const cliente = await clienteDeCuenta(admin, cuenta.id);
  if (!cliente) return NextResponse.json({ error: "La cuenta no tiene tokens de MELI guardados." }, { status: 500 });

  const url = new URL(req.url);
  let itemId = url.searchParams.get("item")?.trim().toUpperCase() || null;
  let promoId = url.searchParams.get("promo")?.trim() || null;
  let precio = Number(url.searchParams.get("precio")) || null;
  let tipo = url.searchParams.get("tipo")?.trim().toUpperCase() || "DEAL";
  let offerId: string | null = null;

  const { data } = await admin
    .from("sync_log")
    .select("detalle")
    .eq("account_id", cuenta.id)
    .eq("tarea", TAREA_BUEN_FIN)
    .order("fin", { ascending: false })
    .limit(1)
    .maybeSingle();
  const fallidas = ((data as { detalle?: { fallidas?: Fallida[] } } | null)?.detalle?.fallidas ?? []).filter(
    (f) => f.aceptar?.razon === "credibilidad",
  );
  const elegida = fallidas.find((f) => !itemId || f.aceptar?.itemId === itemId) ?? null;
  if (elegida?.aceptar) {
    itemId ??= elegida.aceptar.itemId;
    promoId ??= elegida.aceptar.promoId;
    precio ??= elegida.aceptar.queriamos;
    tipo = elegida.aceptar.tipo || tipo;
    offerId = elegida.aceptar.offerId;
  }
  if (!itemId || !promoId) return NextResponse.json({ error: "Falta ?item=MLM…&promo=P-MLM… (no hay fallidas por credibilidad en la última corrida)." }, { status: 400 });

  const lecturas = [
    await leer(cliente, `/seller-promotions/items/${itemId}`, { app_version: "v2" }),
    await leer(cliente, `/seller-promotions/promotions/${promoId}/items`, { promotion_type: tipo, item_id: itemId, app_version: "v2" }),
    await leer(cliente, `/seller-promotions/promotions/${promoId}`, { promotion_type: tipo, app_version: "v2" }),
    await leer(cliente, `/items/${itemId}`, { attributes: "id,price,base_price,original_price,status,variations,sale_terms,deal_ids" }),
    await leer(cliente, `/items/${itemId}/prices`),
    await leer(cliente, `/items/${itemId}/sale_price`, { context: "channel_marketplace" }),
    await leer(cliente, `/seller-promotions/items/${itemId}/promotions`, { app_version: "v2" }),
  ];

  // El mismo POST que MELI rechazó, para guardar el error entero.
  let intento: Record<string, unknown> | null = null;
  if (precio) {
    const cuerpo: Record<string, unknown> = { promotion_id: promoId, promotion_type: tipo, deal_price: precio };
    if (offerId) cuerpo.offer_id = offerId;
    try {
      intento = { cuerpo, ok: true, respuesta: JSON.parse(crudo(await cliente.post(`/seller-promotions/items/${itemId}?app_version=v2`, cuerpo))) };
    } catch (err) {
      intento = {
        cuerpo,
        ok: false,
        error: mensajeMeli(err),
        ...(err instanceof MeliError ? { status: err.status, cuerpoError: err.cuerpo } : {}),
      };
    }
  }

  const resultado = { itemId, promoId, tipo, precio, lecturas, intento };
  await admin.from("sync_log").insert({
    account_id: cuenta.id,
    tarea: "buen-fin-diagnostico",
    estado: "ok",
    fin: new Date().toISOString(),
    detalle: resultado,
  });
  return NextResponse.json(resultado);
}
