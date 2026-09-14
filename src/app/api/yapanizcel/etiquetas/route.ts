import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/yapanizcel/cuenta";
import { resolverEtiquetasYz, varianteFunda } from "@/lib/yapanizcel/etiquetas";

export const dynamic = "force-dynamic";

/**
 * Etiquetas de Full para las FUNDAS: mismo contrato que `/api/etiquetas`
 * (POST resuelve SKUs, GET busca), pero contra el catálogo de la cuenta de
 * YAPANIZCEL (`yz_skus`). Solo Mercado Libre: aquí no hay FNSKU.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "La cuenta de YAPANIZCEL no está conectada." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const pedidas = Array.isArray(body?.skus) ? body.skus : [];
  if (!pedidas.length) {
    return NextResponse.json({ error: "No mandaste ningún SKU." }, { status: 400 });
  }
  if (pedidas.length > 2000) {
    return NextResponse.json({ error: "Son demasiados SKUs de un jalón." }, { status: 400 });
  }

  const etiquetas = await resolverEtiquetasYz(supabase, cuenta.id, pedidas);
  if (!etiquetas.length) {
    return NextResponse.json(
      { error: "Ninguna línea tenía SKU y cantidad válidos." },
      { status: 400 },
    );
  }
  return NextResponse.json({ etiquetas });
}

/** Búsqueda por SKU o título en el catálogo de fundas, para el buscador. */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "La cuenta de YAPANIZCEL no está conectada." }, { status: 400 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ resultados: [] });

  const patron = `%${q.replace(/[%_]/g, "")}%`;
  const { data } = await supabase
    .from("yz_skus")
    .select("sku, inventory_id, titulo, modelo, color")
    .eq("account_id", cuenta.id)
    .or(`sku.ilike.${patron},titulo.ilike.${patron}`)
    // Primero lo que ya tiene código Full: es lo que se puede imprimir.
    .order("inventory_id", { ascending: false, nullsFirst: false })
    .order("sku", { ascending: true })
    .limit(40);

  const resultados = (data ?? []).map((s) => ({
    sku: s.sku,
    codigoFull: s.inventory_id ?? null,
    fnsku: null as string | null,
    titulo: s.titulo ?? null,
    variante: varianteFunda(s.modelo, s.color),
  }));
  return NextResponse.json({ resultados });
}
