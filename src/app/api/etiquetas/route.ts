import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
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

  const { data: catalogo } = await supabase
    .from("skus")
    .select("sku, inventory_id, titulo, color, talla, logistica")
    .eq("account_id", cuenta.id);

  // Dos índices: el SKU tal cual y el SKU sin el sufijo del sitio.
  const exacto = new Map<string, any>();
  const flexible = new Map<string, any>();
  for (const s of catalogo ?? []) {
    exacto.set(s.sku.trim().toUpperCase(), s);
    const c = claveComparacion(s.sku);
    if (!flexible.has(c)) flexible.set(c, s);
  }

  const etiquetas: DatosEtiqueta[] = [];

  for (const p of pedidas) {
    const sku = String(p?.sku ?? "").trim().toUpperCase();
    const cantidad = Math.max(0, Math.min(999, Math.round(Number(p?.cantidad) || 0)));
    if (!sku || cantidad <= 0) continue;

    const encontrado = exacto.get(sku) ?? flexible.get(claveComparacion(sku));

    if (!encontrado) {
      etiquetas.push({
        sku,
        codigoFull: null,
        titulo: null,
        variante: "",
        cantidad,
        problema: "Este SKU no está en el catálogo de Mercado Libre.",
      });
      continue;
    }

    etiquetas.push({
      sku: encontrado.sku,
      codigoFull: encontrado.inventory_id ?? null,
      titulo: encontrado.titulo ?? null,
      variante: variante(encontrado.color, encontrado.talla),
      cantidad,
      problema: encontrado.inventory_id
        ? null
        : "Todavía no tiene código Full. Aparece cuando la publicación entra a Full; sincroniza y vuelve a intentar.",
    });
  }

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

  return NextResponse.json({
    resultados: (data ?? []).map((s) => ({
      sku: s.sku,
      codigoFull: s.inventory_id ?? null,
      titulo: s.titulo ?? null,
      variante: variante(s.color, s.talla),
    })),
  });
}
