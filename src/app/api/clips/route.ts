import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { origenReal } from "@/lib/servicios/origen";
import { cuentaActiva, traerTodo, upsertEnTandas } from "@/lib/datos/repos";
import {
  dispararProcesoClips,
  itemsDelCatalogo,
  planAplicaciones,
  videosErpPorModelo,
  type FilaPlan,
} from "@/lib/servicios/clips";

export const dynamic = "force-dynamic";

interface FilaClip {
  item_id: string;
  tiene_clip: boolean;
  clip_url: string | null;
  leido_en: string | null;
  estado: string;
  origen_item_id: string | null;
  ultimo_error: string | null;
  aplicado_en: string | null;
}

/**
 * Resumen para la sección de Clips: por modelo (así agrupa el agrupador de
 * variantes), qué publicaciones activas tienen clip y a cuáles se les puede
 * aplicar el video de una hermana. La lectura del catálogo corre en segundo
 * plano; aquí solo se arma la foto.
 */
export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  let items: Awaited<ReturnType<typeof itemsDelCatalogo>>;
  let filas: FilaClip[];
  let videosErp: Map<string, string>;
  try {
    [items, filas, videosErp] = await Promise.all([
      itemsDelCatalogo(supabase, cuenta.id),
      traerTodo<FilaClip>(
        supabase,
        "clips_meli",
        "item_id, tiene_clip, clip_url, leido_en, estado, origen_item_id, ultimo_error, aplicado_en",
        (q) => q.eq("account_id", cuenta.id),
      ),
      videosErpPorModelo(supabase, cuenta.id),
    ]);
  } catch (err) {
    const mensaje = (err as Error).message;
    return NextResponse.json(
      {
        error: mensaje.includes("clips_meli")
          ? "Falta aplicar la migración 0027 en Supabase (tabla clips_meli)."
          : mensaje,
      },
      { status: 500 },
    );
  }

  const porItem = new Map(filas.map((f) => [f.item_id, f]));
  const activos = items.filter((i) => i.estado === "active");

  // Solo lo LEÍDO entra al plan: de una publicación sin escanear no se sabe
  // si tiene clip, y encolarla a ciegas subiría videos duplicados.
  const paraPlan: FilaPlan[] = activos
    .filter((i) => porItem.get(i.item_id)?.leido_en)
    .map((i) => {
      const f = porItem.get(i.item_id)!;
      return {
        itemId: i.item_id,
        modelo: i.modelo,
        estadoPub: i.estado,
        tieneClip: f.tiene_clip,
        clipUrl: f.clip_url,
        videoErpUrl: i.modelo ? (videosErp.get(i.modelo) ?? null) : null,
        enCola: f.estado === "pendiente",
      };
    });
  const plan = planAplicaciones(paraPlan);
  const aplicablesPorModelo = new Map<string, number>();
  const origenPorModelo = new Map<string, "hermana" | "erp">();
  {
    const modeloDeItem = new Map(activos.map((i) => [i.item_id, i.modelo]));
    for (const a of plan) {
      const m = modeloDeItem.get(a.itemId);
      if (!m) continue;
      aplicablesPorModelo.set(m, (aplicablesPorModelo.get(m) ?? 0) + 1);
      if (!origenPorModelo.has(m) || a.origen === "hermana") origenPorModelo.set(m, a.origen);
    }
  }

  interface ItemUi {
    itemId: string;
    color: string | null;
    estado: string; // sin_leer | ok | sin_clip | pendiente | error
    ultimoError: string | null;
  }
  interface ModeloUi {
    modelo: string;
    titulo: string | null;
    activos: number;
    conClip: number;
    sinClip: number;
    sinLeer: number;
    enCola: number;
    errores: number;
    aplicables: number;
    origen: "hermana" | "erp" | null;
    items: ItemUi[];
  }

  const modelos = new Map<string, ModeloUi>();
  const resumen = {
    activas: activos.length,
    conClip: 0,
    sinClip: 0,
    sinLeer: 0,
    enCola: 0,
    errores: 0,
    aplicables: plan.length,
  };

  for (const i of activos) {
    const clave = i.modelo ?? "(sin modelo)";
    const m =
      modelos.get(clave) ??
      ({
        modelo: clave,
        titulo: i.titulo,
        activos: 0,
        conClip: 0,
        sinClip: 0,
        sinLeer: 0,
        enCola: 0,
        errores: 0,
        aplicables: aplicablesPorModelo.get(clave) ?? 0,
        origen: origenPorModelo.get(clave) ?? null,
        items: [],
      } satisfies ModeloUi);
    m.activos++;

    const f = porItem.get(i.item_id);
    let estado = "sin_leer";
    if (f?.estado === "pendiente") {
      estado = "pendiente";
      m.enCola++;
      resumen.enCola++;
    } else if (f?.estado === "error") {
      estado = "error";
      m.errores++;
      resumen.errores++;
    } else if (f?.leido_en && f.tiene_clip) {
      estado = "ok";
      m.conClip++;
      resumen.conClip++;
    } else if (f?.leido_en) {
      estado = "sin_clip";
      m.sinClip++;
      resumen.sinClip++;
    } else {
      m.sinLeer++;
      resumen.sinLeer++;
    }
    m.items.push({
      itemId: i.item_id,
      color: i.color,
      estado,
      ultimoError: f?.ultimo_error ?? null,
    });
    modelos.set(clave, m);
  }

  // A la pantalla van los modelos con algo que revisar o hacer; los que ya
  // están completos solo suman al resumen.
  const conTrabajo = [...modelos.values()]
    .filter((m) => m.sinClip || m.enCola || m.errores || m.aplicables)
    .sort(
      (a, b) =>
        b.aplicables - a.aplicables ||
        b.sinClip - a.sinClip ||
        a.modelo.localeCompare(b.modelo),
    );

  const { data: vivo } = await supabase
    .from("sync_log")
    .select("id")
    .eq("account_id", cuenta.id)
    .eq("tarea", "clips_meli")
    .eq("estado", "corriendo")
    .gte("inicio", new Date(Date.now() - 6 * 60_000).toISOString())
    .limit(1);

  // Si la última corrida murió (p. ej. el API de clips no contestó en
  // ninguna ruta), la página debe enseñar el motivo y DEJAR de encender el
  // proceso en automático: relanzarlo solo repetiría el mismo golpe.
  const { data: ultimo } = await supabase
    .from("sync_log")
    .select("estado, detalle")
    .eq("account_id", cuenta.id)
    .eq("tarea", "clips_meli")
    .neq("estado", "corriendo")
    .order("inicio", { ascending: false })
    .limit(1)
    .maybeSingle();
  const procesoError =
    ultimo?.estado === "error"
      ? String((ultimo.detalle as { mensaje?: string } | null)?.mensaje ?? "El proceso falló.")
      : null;

  return NextResponse.json({
    resumen,
    modelos: conTrabajo.slice(0, 400),
    trabajando: Boolean(vivo?.length),
    procesoError,
  });
}

/**
 * Acciones de la sección:
 *  - {accion: "escanear"}: vuelve a leer de MELI qué publicación tiene clip.
 *  - {accion: "aplicar", modelos?: [...]}: encola la propagación (el video de
 *    una hermana, o el del ERP como respaldo) para esos modelos — o para
 *    todos los aplicables si no se manda la lista. El proceso de fondo sube.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const accion = typeof body?.accion === "string" ? body.accion : "";
  // origenReal, no NEXT_PUBLIC_APP_URL: con el valor de relleno del ejemplo,
  // el disparo le pegaba a un dominio inexistente y moría en silencio.
  const origen = origenReal(req);

  if (accion === "escanear") {
    // La foto vieja se invalida y el proceso vuelve a preguntar a MELI.
    // Lo encolado no se toca: está esperando subirse.
    const { error } = await supabase
      .from("clips_meli")
      .update({ leido_en: null, estado: "sin_leer", ultimo_error: null })
      .eq("account_id", cuenta.id)
      .in("estado", ["ok", "sin_clip", "error"]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await dispararProcesoClips(origen, req.headers.get("cookie"));
    return NextResponse.json({ ok: true });
  }

  if (accion !== "aplicar") {
    return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
  }

  const soloModelos: string[] | null = Array.isArray(body?.modelos)
    ? body.modelos.filter((m: unknown) => typeof m === "string")
    : null;

  const [items, filas, videosErp] = await Promise.all([
    itemsDelCatalogo(supabase, cuenta.id),
    traerTodo<{
      item_id: string;
      tiene_clip: boolean;
      clip_url: string | null;
      leido_en: string | null;
      estado: string;
    }>(supabase, "clips_meli", "item_id, tiene_clip, clip_url, leido_en, estado", (q) =>
      q.eq("account_id", cuenta.id),
    ),
    videosErpPorModelo(supabase, cuenta.id),
  ]);
  const porItem = new Map(filas.map((f) => [f.item_id, f]));

  const paraPlan: FilaPlan[] = items
    .filter((i) => i.estado === "active" && porItem.get(i.item_id)?.leido_en)
    .filter((i) => !soloModelos || (i.modelo && soloModelos.includes(i.modelo)))
    .map((i) => {
      const f = porItem.get(i.item_id)!;
      return {
        itemId: i.item_id,
        modelo: i.modelo,
        estadoPub: i.estado,
        tieneClip: f.tiene_clip,
        clipUrl: f.clip_url,
        videoErpUrl: i.modelo ? (videosErp.get(i.modelo) ?? null) : null,
        enCola: f.estado === "pendiente",
      };
    });

  const plan = planAplicaciones(paraPlan);
  if (!plan.length) {
    return NextResponse.json({
      ok: true,
      encolados: 0,
      mensaje:
        "No hay nada que aplicar: o las hermanas no traen la URL del video, o ya todas tienen clip.",
    });
  }

  const ahora = new Date().toISOString();
  const datosItem = new Map(items.map((i) => [i.item_id, i]));
  await upsertEnTandas(
    supabase,
    "clips_meli",
    plan.map((a) => ({
      account_id: cuenta.id,
      item_id: a.itemId,
      modelo: datosItem.get(a.itemId)?.modelo ?? null,
      titulo: datosItem.get(a.itemId)?.titulo ?? null,
      color: datosItem.get(a.itemId)?.color ?? null,
      estado_pub: "active",
      estado: "pendiente",
      origen_item_id: a.origenItemId,
      origen_video_url: a.url,
      ultimo_error: null,
      actualizado_en: ahora,
    })),
    "account_id,item_id",
  );

  await dispararProcesoClips(origen, req.headers.get("cookie"));
  return NextResponse.json({ ok: true, encolados: plan.length });
}
