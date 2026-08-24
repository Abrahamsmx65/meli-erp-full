import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import {
  dispararProcesoFiscal,
  tieneDatos,
  validarValores,
  type ValoresFiscales,
} from "@/lib/servicios/fiscal";

export const dynamic = "force-dynamic";

interface FilaLocal {
  sku: string;
  estado: string;
  sat: string | null;
  iva: string | null;
  ieps: number | null;
  unidad: string | null;
  ultimo_error: string | null;
  leido_en: string | null;
}

/**
 * Resumen para la sección de datos fiscales: qué tanto del catálogo ya se
 * leyó de MELI y, por modelo, cuántos SKUs siguen sin la información cargada.
 */
export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  // traerTodo pagina: sin él, Supabase corta en 1000 y el resumen mentiría
  // en catálogos más grandes.
  let skus: { sku: string; modelo: string | null; titulo: string | null }[];
  let fiscales: FilaLocal[];
  try {
    skus = await traerTodo(supabase, "skus", "sku, modelo, titulo", (q) =>
      q.eq("account_id", cuenta.id).eq("activo", true).not("item_id", "is", null),
    );
    fiscales = await traerTodo(
      supabase,
      "datos_fiscales",
      "sku, estado, sat, iva, ieps, unidad, ultimo_error, leido_en",
      (q) => q.eq("account_id", cuenta.id),
    );
  } catch (err) {
    const mensaje = (err as Error).message;
    return NextResponse.json(
      {
        error: mensaje.includes("datos_fiscales")
          ? "Falta aplicar la migración 0019 en Supabase (tabla datos_fiscales)."
          : mensaje,
      },
      { status: 500 },
    );
  }

  const porSku = new Map<string, FilaLocal>();
  for (const f of fiscales) porSku.set(f.sku, f);

  interface Modelo {
    modelo: string;
    titulo: string | null;
    totalSkus: number;
    sinLeer: number;
    sinDatos: number;
    pendientes: number;
    errores: number;
    ultimoError: string | null;
    satSugerido: string | null;
    ivaSugerida: string | null;
    iepsSugerido: number | null;
    unidadSugerida: string | null;
  }
  const modelos = new Map<string, Modelo>();
  const resumen = { catalogo: 0, leidos: 0, sinLeer: 0, sinDatos: 0, pendientes: 0, errores: 0 };

  for (const s of skus ?? []) {
    const clave = (s.modelo as string) || "(sin modelo)";
    const m =
      modelos.get(clave) ??
      ({
        modelo: clave,
        titulo: (s.titulo as string) || null,
        totalSkus: 0,
        sinLeer: 0,
        sinDatos: 0,
        pendientes: 0,
        errores: 0,
        ultimoError: null,
        satSugerido: null,
        ivaSugerida: null,
        iepsSugerido: null,
        unidadSugerida: null,
      } satisfies Modelo);
    m.totalSkus++;
    resumen.catalogo++;

    const f = porSku.get(s.sku as string);
    if (!f || !f.leido_en) {
      m.sinLeer++;
      resumen.sinLeer++;
    } else {
      resumen.leidos++;
      if (f.estado === "pendiente") {
        m.pendientes++;
        resumen.pendientes++;
      } else if (f.estado === "error") {
        m.errores++;
        resumen.errores++;
        if (!m.ultimoError) m.ultimoError = f.ultimo_error;
      } else if (!tieneDatos(f)) {
        m.sinDatos++;
        resumen.sinDatos++;
      } else if (m.satSugerido == null) {
        // Lo que otro color/talla del MISMO modelo ya tiene cargado en MELI
        // es la mejor sugerencia: dato real, no inventado.
        m.satSugerido = f.sat;
        m.ivaSugerida = f.iva;
        m.iepsSugerido = f.ieps;
        m.unidadSugerida = f.unidad;
      }
    }
    modelos.set(clave, m);
  }

  const conTrabajo = [...modelos.values()]
    .filter((m) => m.sinDatos || m.pendientes || m.errores)
    .sort((a, b) => b.sinDatos - a.sinDatos || a.modelo.localeCompare(b.modelo));

  return NextResponse.json({ resumen, modelos: conTrabajo });
}

/**
 * Encola la captura de un modelo: todos sus SKUs sin datos (o con error)
 * quedan `pendiente` con los valores nuevos, y el proceso en segundo plano
 * los empuja a MELI con la mutación documentada.
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
  const modelo = typeof body?.modelo === "string" ? body.modelo.trim() : "";
  if (!modelo) return NextResponse.json({ error: "Falta el modelo." }, { status: 400 });

  const valores: ValoresFiscales = {
    sat: typeof body?.sat === "string" ? body.sat.trim() : undefined,
    iva: typeof body?.iva === "string" && body.iva.trim() !== "" ? body.iva.trim() : undefined,
    ieps: Number.isFinite(Number(body?.ieps)) ? Number(body.ieps) : undefined,
    unidad:
      typeof body?.unidad === "string" && body.unidad.trim() !== ""
        ? body.unidad.trim().toUpperCase()
        : undefined,
  };
  const invalido = validarValores(valores);
  if (invalido) return NextResponse.json({ error: invalido }, { status: 400 });

  const { data: skus, error: errSkus } = await supabase
    .from("skus")
    .select("sku")
    .eq("account_id", cuenta.id)
    .eq("activo", true)
    .eq("modelo", modelo)
    .limit(5000);
  if (errSkus) return NextResponse.json({ error: errSkus.message }, { status: 500 });
  const lista = (skus ?? []).map((s) => s.sku as string);
  if (!lista.length) {
    return NextResponse.json({ error: `No hay SKUs del modelo ${modelo}.` }, { status: 400 });
  }

  const ahora = new Date().toISOString();
  const { data: marcadas, error: errMarca } = await supabase
    .from("datos_fiscales")
    .update({
      estado: "pendiente",
      sat_nuevo: valores.sat,
      iva_nuevo: valores.iva ?? null,
      ieps_nuevo: valores.ieps ?? null,
      unidad_nueva: valores.unidad ?? null,
      ultimo_error: null,
      actualizado_en: ahora,
    })
    .eq("account_id", cuenta.id)
    .in("sku", lista)
    .in("estado", ["sin_datos", "error", "pendiente"])
    .select("sku");
  if (errMarca) return NextResponse.json({ error: errMarca.message }, { status: 500 });

  const encolados = marcadas?.length ?? 0;
  if (encolados) {
    const origen = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
    await dispararProcesoFiscal(origen, req.headers.get("cookie"));
  }

  return NextResponse.json({ ok: true, encolados });
}
