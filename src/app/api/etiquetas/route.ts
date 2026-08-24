import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { resolverEtiquetas, claveOrdenada } from "@/lib/etiquetas/resolver";
import { claveComparacion } from "@/lib/importar/sku";

export const dynamic = "force-dynamic";

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

  const etiquetas = await resolverEtiquetas(supabase, cuenta.id, pedidas);

  if (!etiquetas.length) {
    return NextResponse.json(
      { error: "Ninguna línea tenía SKU y cantidad válidos." },
      { status: 400 },
    );
  }

  return NextResponse.json({ etiquetas });
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
