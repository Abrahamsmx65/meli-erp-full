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
 * sin `precio` el precio relámpago de Números de su modelo. Desde el 20-oct
 * prueba mandando las FECHAS de la propuesta (las del listado de la
 * promoción): sin ellas MELI editaba la relámpago ya programada.
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

  // Sin item: una publicación de la última corrida que siga con propuesta
  // (de sus fallidas o de sus omitidas por tener otra programada).
  if (!itemId) {
    const { data } = await admin
      .from("sync_log")
      .select("detalle")
      .eq("account_id", cuenta.id)
      .eq("tarea", TAREA_RELAMPAGOS)
      .order("fin", { ascending: false })
      .limit(1)
      .maybeSingle();
    const d = (data as { detalle?: { fallidas?: { donde: string }[]; omitidas?: string[] } } | null)?.detalle;
    const ids = [...(d?.fallidas ?? []).map((f) => f.donde), ...(d?.omitidas ?? [])].map((x) => x.split(" · ")[0]).slice(0, 40);
    for (const id of ids) {
      const c = await propuestas(cliente, id).catch(() => []);
      if (!c.length) continue;
      // Sirve la que ya tiene una programada: de ahí sale el precio y es el
      // caso que hay que resolver (agregar OTRA fecha).
      const r = await cliente
        .get<{ results?: { id?: string; status?: string; price?: number }[] }>(`/seller-promotions/promotions/${c[0].id ?? "LGH-MLM1000"}/items`, {
          app_version: "v2",
          promotion_type: "LIGHTNING",
          item_id: id,
          limit: 50,
        })
        .catch(() => null);
      const programada = (r?.results ?? []).some((x) => (!x.id || x.id === id) && x.status !== "candidate" && x.price);
      if (!programada) continue;
      itemId = id;
      candidatas = c;
      break;
    }
  }
  if (!itemId) return NextResponse.json({ error: "No encontré una relámpago propuesta para probar: pásame ?item=MLM…&precio=…" }, { status: 400 });
  if (!candidatas.length) candidatas = await propuestas(cliente, itemId);
  const objetivo = (ref ? candidatas.find((c) => c.ref_id === ref) : null) ?? candidatas[0];
  if (!objetivo) return NextResponse.json({ error: `${itemId} ya no tiene relámpagos propuestas.` }, { status: 400 });
  ref = objetivo.ref_id ?? null;
  const promoId = objetivo.id ?? "LGH-MLM1000";
  const stock = Math.max(5, Number(objetivo.stock?.min) || 0);

  // Las fechas de cada relámpago solo vienen en el listado de la promoción.
  type Fecha = { id?: string; ref_id?: string; status?: string; price?: number; start_date?: string; finish_date?: string };
  const fechas = async (): Promise<Fecha[]> => {
    const r = await cliente.get<{ results?: Fecha[] }>(`/seller-promotions/promotions/${promoId}/items`, {
      app_version: "v2",
      promotion_type: "LIGHTNING",
      item_id: itemId,
      limit: 50,
    });
    return (r?.results ?? []).filter((x) => !x.id || x.id === itemId);
  };
  const antes = await fechas().catch(() => [] as Fecha[]);
  const slot = antes.find((x) => x.ref_id === ref);
  const programadasAntes = antes.filter((x) => x.status !== "candidate").length;
  // Sin precio: el precio relámpago de Números del modelo de la publicación
  // (dueño, 20-oct-2026: «el precio de nuestro sistema, si no, no jala»).
  let modelo: string | null = null;
  if (!precio) {
    const { data: sku } = await admin
      .from("skus")
      .select("modelo")
      .eq("account_id", cuenta.id)
      .eq("item_id", itemId)
      .not("modelo", "is", null)
      .limit(1)
      .maybeSingle();
    modelo = ((sku as { modelo?: string } | null)?.modelo ?? "").toUpperCase() || null;
    if (modelo) {
      const { data: n } = await admin
        .from("numeros_modelos")
        .select("precio_relampago")
        .eq("account_id", cuenta.id)
        .eq("modelo", modelo)
        .maybeSingle();
      const p = Number((n as { precio_relampago?: unknown } | null)?.precio_relampago);
      precio = Number.isFinite(p) && p > 0 ? p : null;
    }
  }
  if (!precio) return NextResponse.json({ error: `${modelo ?? itemId} no tiene precio relámpago en Números: pásame &precio=…` }, { status: 400 });
  const inicio = slot?.start_date ?? null;
  const fin = slot?.finish_date ?? null;
  const conZona = (x: string | null) => (x && !/[zZ]|[+-]\d\d:\d\d$/.test(x) ? `${x}-06:00` : x);

  const lecturas = [
    await leer(cliente, `/seller-promotions/items/${itemId}`),
    ...(ref ? [await leer(cliente, `/seller-promotions/candidates/${ref}`)] : []),
    { ruta: "fechas", ok: true, respuesta: antes },
  ];

  const base = { promotion_type: "LIGHTNING", promotion_id: promoId, deal_price: precio, stock };
  const formas: { nombre: string; cuerpo: Record<string, unknown> }[] = inicio
    ? [
        { nombre: "offer_id + fechas de la propuesta", cuerpo: { ...base, offer_id: ref, start_date: inicio, finish_date: fin } },
        { nombre: "solo fechas, sin offer_id", cuerpo: { ...base, start_date: inicio, finish_date: fin } },
        { nombre: "offer_id + fechas con zona -06:00", cuerpo: { ...base, offer_id: ref, start_date: conZona(inicio), finish_date: conZona(fin) } },
        { nombre: "fechas con zona, sin offer_id", cuerpo: { ...base, start_date: conZona(inicio), finish_date: conZona(fin) } },
        { nombre: "ref_id + fechas", cuerpo: { ...base, ref_id: ref, start_date: inicio, finish_date: fin } },
      ]
    : [];

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
    const despues = await fechas().catch(() => [] as Fecha[]);
    const sigue = despues.some((x) => x.ref_id === ref && x.status === "candidate");
    const nuevaEnSuFecha = despues.some((x) => x.status !== "candidate" && inicio && x.start_date === inicio);
    intentos.push({ forma: f.nombre, cuerpo: f.cuerpo, respuesta, error, sigueComoPropuesta: sigue, nuevaEnSuFecha, fechasDespues: despues });
    if (!error && (!sigue || nuevaEnSuFecha)) {
      funciono = f.nombre;
      break;
    }
  }

  const resultado = {
    itemId,
    modelo,
    precio,
    ref,
    funciono,
    inicio,
    programadasAntes,
    conclusion: !inicio
      ? "El listado de MELI no trajo la fecha de la propuesta."
      : funciono
        ? `Entró con: ${funciono}`
        : "Ninguna forma sacó la propuesta de candidata.",
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
