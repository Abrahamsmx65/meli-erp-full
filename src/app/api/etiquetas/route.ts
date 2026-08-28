import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import {
  resolverEtiquetas,
  claveOrdenada,
  FALTA_FNSKU,
  SIN_FNSKU_EN_AMAZON,
  type EtiquetaResuelta,
} from "@/lib/etiquetas/resolver";
import { claveComparacion } from "@/lib/importar/sku";
import { Cliente, cuentasAmazon } from "@/lib/amazon/spapi";
import { completarFnskus } from "@/lib/amazon/fnsku";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Cuánto se le espera a Amazon para completar un FNSKU que falta. Es un
 * extra dentro de la petición de las etiquetas: si no alcanza, la etiqueta
 * sale igual con lo que ya se tenía y se dice qué le falta.
 */
const PLAZO_FNSKU_MS = 20_000;

export interface DatosEtiqueta {
  sku: string;
  codigoFull: string | null;
  titulo: string | null;
  variante: string;
  cantidad: number;
  /** por qué no se pudo armar la etiqueta, si es el caso */
  problema: string | null;
}

function variante(color: string | null, talla: string | null): string {
  const p: string[] = [];
  if (color) p.push(color);
  if (talla) p.push(`Talla ${talla}`);
  return p.join(" · ");
}

/**
 * Resuelve una lista de SKUs a los datos que van impresos en la etiqueta.
 *
 * El código Full no se captura: sale del catálogo que ya se sincroniza de
 * Mercado Libre, igual que el título y la variante. Por eso solo hay que dar
 * el SKU y cuántas etiquetas.
 *
 * Si el SKU no trae el sufijo del sitio (`-MX`) o lo trae de más, se compara
 * igual: es el mismo enredo que ya se resuelve al amarrar las cajas, y no
 * tiene caso que aquí falle por una diferencia que el sistema sabe ignorar.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const body = await req.json().catch(() => null);
  const pedidas = Array.isArray(body?.skus) ? body.skus : [];

  if (!pedidas.length) {
    return NextResponse.json({ error: "No mandaste ningún SKU." }, { status: 400 });
  }
  if (pedidas.length > 2000) {
    return NextResponse.json({ error: "Son demasiados SKUs de un jalón." }, { status: 400 });
  }

  const etiquetas = await completarLosQueFaltan(
    await resolverEtiquetas(supabase, cuenta.id, pedidas),
  );

  if (!etiquetas.length) {
    return NextResponse.json(
      { error: "Ninguna línea tenía SKU y cantidad válidos." },
      { status: 400 },
    );
  }

  return NextResponse.json({ etiquetas });
}

/**
 * Completa en el momento el FNSKU que falte.
 *
 * El reporte de inventario FBA solo trae los listings vivos, así que todo lo
 * agotado o pausado en FBA llega sin FNSKU y su etiqueta de Amazon no se
 * puede armar. Ese dato sí lo contesta el API de inventario preguntando por
 * SKU, y son 50 por llamada: cabe de sobra dentro de esta petición, así que
 * se resuelve aquí mismo en vez de dejarle el pendiente a quien imprime.
 *
 * Lo que Amazon conteste queda guardado en el catálogo, así que la segunda
 * vez que se pida el mismo SKU ya no hace falta preguntar.
 *
 * Si algo falla —Amazon caído, cuenta desconectada, se acaba el plazo— las
 * etiquetas salen igual con lo que ya se tenía. Nunca se inventa un FNSKU.
 */
async function completarLosQueFaltan(
  etiquetas: EtiquetaResuelta[],
): Promise<EtiquetaResuelta[]> {
  const faltantes = etiquetas.filter((e) => e.faltaFnsku && e.skuAmazon);
  if (!faltantes.length) return etiquetas;

  try {
    const admin = clienteAdmin();
    const cuentas = await cuentasAmazon(admin);
    if (!cuentas.length) return etiquetas;

    const limite = Date.now() + PLAZO_FNSKU_MS;
    const skus = [...new Set(faltantes.map((e) => e.skuAmazon!))];

    for (const cuenta of cuentas) {
      const { encontrados } = await completarFnskus(admin, new Cliente(cuenta, limite), { skus });
      for (const e of faltantes) {
        const fnsku = encontrados.get(e.skuAmazon!);
        if (!fnsku) continue;
        e.fnsku = fnsku;
        e.faltaFnsku = false;
        // Solo se borra el problema que hablaba del FNSKU. Un SKU de MELI
        // puede traer además el suyo (sin código Full), y ese sigue vivo.
        if (e.problema === FALTA_FNSKU) e.problema = null;
      }
    }

    // A los que Amazon tampoco conoce ya se les preguntó: el texto deja de
    // decir "todavía no se conoce" y dice por qué no lo va a haber.
    for (const e of etiquetas) {
      if (!e.faltaFnsku) continue;
      e.faltaFnsku = false;
      if (e.problema === FALTA_FNSKU) e.problema = SIN_FNSKU_EN_AMAZON;
    }
  } catch {
    // Se queda como estaba: con su problema explicado y sin FNSKU inventado.
  }

  return etiquetas;
}

/** Búsqueda por SKU o título, para el buscador de la pantalla. */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ resultados: [] });

  const patron = `%${q.replace(/[%_]/g, "")}%`;

  const { data } = await supabase
    .from("skus")
    .select("sku, inventory_id, titulo, color, talla")
    .eq("account_id", cuenta.id)
    .eq("activo", true)
    .or(`sku.ilike.${patron},titulo.ilike.${patron}`)
    .limit(30);

  const deMeli = (data ?? []).map((s) => ({
    sku: s.sku,
    codigoFull: s.inventory_id ?? null,
    fnsku: null as string | null,
    titulo: s.titulo ?? null,
    variante: variante(s.color, s.talla),
  }));

  // Productos solo-de-Amazon (las fundas: SKUs que empiezan con número y no
  // existen en MELI). El FNSKU casi nunca viene en el listado: se completa
  // con el inventario FBA. Si Amazon no está conectado, esto sale vacío.
  const yaVistos = new Set(deMeli.flatMap((s) => [claveComparacion(s.sku), claveOrdenada(s.sku)]));
  let deAmazon: typeof deMeli = [];
  try {
    const { data: am } = await supabase
      .from("amazon_skus")
      .select("seller_sku, fnsku, titulo")
      .eq("activo", true)
      .or(`seller_sku.ilike.${patron},titulo.ilike.${patron}`)
      .limit(30);

    const sinFnsku = (am ?? []).filter((a) => !a.fnsku).map((a) => a.seller_sku);
    const fnskus = new Map<string, string>();
    if (sinFnsku.length) {
      const { data: inv } = await supabase
        .from("amazon_inventario")
        .select("seller_sku, fnsku")
        .in("seller_sku", sinFnsku);
      for (const i of inv ?? []) if (i.fnsku) fnskus.set(i.seller_sku, i.fnsku);
    }

    deAmazon = (am ?? [])
      .map((a) => ({
        sku: a.seller_sku,
        codigoFull: null,
        fnsku: a.fnsku ?? fnskus.get(a.seller_sku) ?? null,
        titulo: a.titulo ?? null,
        variante: "",
      }))
      // Sin FNSKU no hay etiqueta que imprimir; y los que ya salieron por
      // MELI (el mismo calzado dado de alta en los dos lados) no se repiten.
      .filter((a) => a.fnsku && !yaVistos.has(claveComparacion(a.sku)) && !yaVistos.has(claveOrdenada(a.sku)));
  } catch {
    deAmazon = [];
  }

  return NextResponse.json({ resultados: [...deMeli, ...deAmazon].slice(0, 40) });
}
