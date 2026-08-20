import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import { indexarCatalogo, claveOrdenada } from "@/lib/etiquetas/resolver";
import { claveAplastada, claveComparacion } from "@/lib/importar/sku";
import { obtenerPlan, invalidar } from "@/lib/servicios/cache";
import { separarEnvios } from "@/lib/servicios/envios";
import {
  marcarRecibido,
  registrarEnvio,
  registrarEnvioManual,
} from "@/lib/servicios/envios-registrados";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Registrar que un envío del plan ya se dio de alta en Mercado Libre.
 *
 * Desde ese clic, las cajas del envío dejan de contar como disponibles en
 * bodega y sus pares cuentan como en camino a Full: el plan ya no puede
 * volver a sugerirlas. Es el puente que MELI no da por API.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));

  // Registro MANUAL: folio + lista de SKU y pares (envíos ya dados de alta
  // en MELI antes de que existiera el botón, o armados fuera del plan).
  if (Array.isArray(body?.renglones)) {
    // El SKU capturado a mano se amarra contra el catálogo real de MELI
    // (mayúsculas, sufijo -MX, espacios): un SKU escrito distinto creaba un
    // renglón fantasma y el plan seguía sin ver esos pares en camino.
    const catalogo = await traerTodo<any>(supabase, "skus", "sku", (q) =>
      q.eq("account_id", cuenta.id),
    );
    const indice = indexarCatalogo(catalogo ?? []);
    const amarrar = (sku: string): string => {
      const dado =
        indice.exacto.get(sku.toUpperCase()) ??
        indice.canonico.get(claveComparacion(sku)) ??
        indice.aplastado.get(claveAplastada(sku)) ??
        indice.ordenado.get(claveOrdenada(sku));
      return dado?.sku ?? sku;
    };
    const renglones = (body.renglones as { sku?: unknown; pares?: unknown }[])
      .map((r) => ({ sku: amarrar(String(r.sku ?? "").trim()), pares: Math.round(Number(r.pares)) }))
      .filter((r) => r.sku && Number.isFinite(r.pares) && r.pares > 0);
    if (!renglones.length) {
      return NextResponse.json(
        { error: "No encontré ningún SKU con pares en la lista." },
        { status: 400 },
      );
    }
    try {
      const id = await registrarEnvioManual(
        supabase,
        cuenta.id,
        String(body?.folio ?? "").trim(),
        renglones,
      );
      await invalidar(clienteAdmin(), cuenta.id, "Se registró un envío a Full en camino.");
      const pares = renglones.reduce((a, r) => a + r.pares, 0);
      return NextResponse.json({ ok: true, id, skus: renglones.length, pares });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  const grupo = typeof body?.grupo === "string" ? body.grupo.trim() : "";
  if (!grupo) return NextResponse.json({ error: "Falta el envío (grupo)." }, { status: 400 });

  const { plan } = await obtenerPlan(supabase, cuenta.id);
  const { envios } = await separarEnvios(supabase, cuenta.id, plan.cajas);
  const envio = envios.find((e) => e.grupo === grupo);
  if (!envio) {
    return NextResponse.json(
      { error: "Ese envío ya no está en el plan. Recalcula y vuelve a intentar." },
      { status: 404 },
    );
  }

  try {
    const id = await registrarEnvio(supabase, cuenta.id, envio);
    await invalidar(clienteAdmin(), cuenta.id, "Se registró un envío a Full en camino.");
    return NextResponse.json({ ok: true, id, cajas: envio.totalCajas, pares: envio.totalPares });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** Marcar un envío registrado como recibido en Full. */
export async function PATCH(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Falta el id del envío." }, { status: 400 });

  try {
    await marcarRecibido(supabase, id);
    await invalidar(clienteAdmin(), cuenta.id, "Un envío a Full llegó: hay que replanear.");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
