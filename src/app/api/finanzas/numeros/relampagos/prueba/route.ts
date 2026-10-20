import { NextResponse } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { mensajeMeli } from "@/lib/servicios/listados";
import { TAREA_RELAMPAGOS } from "@/lib/servicios/precios-modelos";
import type { MeliClient } from "@/lib/meli/client";
import type { PromoMeli } from "@/lib/precios/promociones";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Prueba de UNA relámpago propuesta (20-oct-2026: el dueño sí la puede
 * inscribir con «Participar» en MELI, pero por el API MELI contesta «sí» y
 * la propuesta del día se queda como candidata). Prueba varias formas del
 * POST, una a la vez, y después de cada una relee la publicación: se detiene
 * en la primera con la que la propuesta deja de ser candidata. Contesta el
 * crudo de todo (lecturas, cuerpos mandados y respuestas) y lo deja en
 * `sync_log` (tarea `relampagos-prueba`).
 *
 * `?item=MLM…&precio=229.99&ref=CANDIDATE-…`; sin `item` toma la primera
 * publicación de la última corrida que sigue con una relámpago propuesta, y
 * sin `precio` el precio relámpago con que esa corrida la intentó.
 */
const crudo = (x: unknown, max = 6000) => {
  const s = JSON.stringify(x ?? null);
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

async function leer(cliente: MeliClient, ruta: string, params?: Record<string, string>) {
  try {
    return { ruta, ok: true, respuesta: JSON.parse(crudo(await cliente.get(ruta, { app_version: "v2", ...params }, { reintentos: 1 }))) };
  } catch (err) {
    return { ruta, ok: false, error: mensajeMeli(err) };
  }
}

async function propuestas(cliente: MeliClient, itemId: string): Promise<PromoMeli[]> {
  const r = await cliente.get<PromoMeli[] | { results?: PromoMeli[] }>(`/seller-promotions/items/${itemId}`, { app_version: "v2" });
  const lista = Array.isArray(r) ? r : r?.results ?? [];
  return lista.filter((p) => (p.type ?? "").toUpperCase() === "LIGHTNING" && (p.status ?? "").toLowerCase() === "candidate");
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
  let precio = Number(url.searchParams.get("precio")) || null;
  let ref = url.searchParams.get("ref")?.trim() || null;
  let candidatas: PromoMeli[] = [];

  // Sin item: la primera «fallida» de la última corrida que siga propuesta.
  if (!itemId || !precio) {
    const { data } = await admin
      .from("sync_log")
      .select("detalle")
      .eq("account_id", cuenta.id)
      .eq("tarea", TAREA_RELAMPAGOS)
      .order("fin", { ascending: false })
      .limit(1)
      .maybeSingle();
    const fallidas = ((data as { detalle?: { fallidas?: { donde: string; detalle: string }[] } } | null)?.detalle?.fallidas ?? []).slice(0, 40);
    for (const f of fallidas) {
      const id = f.donde.split(" · ")[0];
      if (itemId && id !== itemId) continue;
      const p = Number(/\$([0-9.]+)/.exec(f.detalle)?.[1]);
      const c = await propuestas(cliente, id).catch(() => []);
      if (!c.length) continue;
      itemId = id;
      precio = precio ?? (Number.isFinite(p) ? p : null);
      candidatas = c;
      break;
    }
  }
  if (!itemId || !precio) return NextResponse.json({ error: "No encontré una relámpago propuesta para probar: pásame ?item=MLM…&precio=…" }, { status: 400 });
  if (!candidatas.length) candidatas = await propuestas(cliente, itemId);
  const objetivo = (ref ? candidatas.find((c) => c.ref_id === ref) : null) ?? candidatas[0];
  if (!objetivo) return NextResponse.json({ error: `${itemId} ya no tiene relámpagos propuestas.` }, { status: 400 });
  ref = objetivo.ref_id ?? null;
  const numero = ref?.split("-").pop() ?? null;
  const promoId = objetivo.id ?? "LGH-MLM1000";
  const stock = Math.max(5, Number(objetivo.stock?.min) || 0);

  const lecturas = [
    await leer(cliente, `/seller-promotions/items/${itemId}`),
    ...(ref ? [await leer(cliente, `/seller-promotions/candidates/${ref}`)] : []),
    ...(ref ? [await leer(cliente, `/seller-promotions/offers/${ref}`)] : []),
    await leer(cliente, `/seller-promotions/promotions/${promoId}/items`, { promotion_type: "LIGHTNING", item_id: itemId, limit: "50" }),
  ];

  const base = { promotion_type: "LIGHTNING", deal_price: precio };
  const formas: { nombre: string; cuerpo: Record<string, unknown> }[] = [
    { nombre: "como hoy (promotion_id + offer_id = ref_id)", cuerpo: { ...base, promotion_id: promoId, stock, offer_id: ref } },
    { nombre: "offer_id = ref_id, sin promotion_id", cuerpo: { ...base, stock, offer_id: ref } },
    { nombre: "offer_id = número del folio", cuerpo: { ...base, promotion_id: promoId, stock, offer_id: numero } },
    { nombre: "ref_id en vez de offer_id", cuerpo: { ...base, promotion_id: promoId, stock, ref_id: ref } },
    { nombre: "candidate_id = ref_id", cuerpo: { ...base, promotion_id: promoId, stock, candidate_id: ref } },
    { nombre: "sin stock (la propuesta no trae rango)", cuerpo: { ...base, promotion_id: promoId, offer_id: ref } },
  ];

  const intentos: unknown[] = [];
  let funciono: string | null = null;
  for (const f of formas) {
    let respuesta: unknown = null;
    let error: string | null = null;
    try {
      respuesta = JSON.parse(crudo(await cliente.post(`/seller-promotions/items/${itemId}?app_version=v2`, f.cuerpo)));
    } catch (err) {
      error = mensajeMeli(err);
    }
    let despues: PromoMeli[] = [];
    try {
      despues = await propuestas(cliente, itemId);
    } catch {
      /* se ve en el siguiente intento */
    }
    const sigue = despues.some((c) => c.ref_id === ref);
    intentos.push({ forma: f.nombre, cuerpo: f.cuerpo, respuesta, error, sigueComoPropuesta: sigue, propuestasDespues: despues.length });
    if (!error && !sigue) {
      funciono = f.nombre;
      break;
    }
  }

  const resultado = {
    itemId,
    precio,
    ref,
    funciono,
    conclusion: funciono ? `Entró con: ${funciono}` : "Ninguna forma sacó la propuesta de candidata.",
    propuestaAntes: objetivo,
    lecturas,
    intentos,
  };
  await admin.from("sync_log").insert({
    account_id: cuenta.id,
    tarea: "relampagos-prueba",
    estado: funciono ? "ok" : "error",
    fin: new Date().toISOString(),
    detalle: resultado,
  });
  return NextResponse.json(resultado);
}
