import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { corridaParaIndusther, leerPaginacion, type FilaCorrida } from "@/lib/servicios/corridas-integracion";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Industher lee aquí las corridas de la sección Corridas (qué pares por
 * talla trae cada caja). Solo LECTURA. Sin sesión: la puerta es la llave
 * `x-api-key` = CORRIDAS_API_KEY, comparada en tiempo constante.
 *
 *   GET /api/integracion/corridas?limit=1000&offset=0[&desde=ISO]
 *
 * Orden estable (actualizado_en, pedido, modelo, color) para paginar sin
 * perder ni repetir; `desde` trae solo lo cambiado después de esa hora.
 */
function llaveValida(presentada: string): boolean {
  const esperada = (process.env.CORRIDAS_API_KEY ?? "").trim();
  if (!esperada || !presentada) return false;
  const a = Buffer.from(presentada);
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!llaveValida((req.headers.get("x-api-key") ?? "").trim())) {
    return NextResponse.json({ error: "API Key inválida." }, { status: 401 });
  }
  const pag = leerPaginacion(req.nextUrl.searchParams);
  if ("error" in pag) return NextResponse.json({ error: pag.error }, { status: 400 });

  const admin = clienteAdmin();
  const { data: cuentas, error: errCuenta } = await admin
    .from("meli_accounts")
    .select("id")
    .order("creado_en", { ascending: true })
    .limit(1);
  if (errCuenta) return NextResponse.json({ error: errCuenta.message }, { status: 500 });
  const cuenta = cuentas?.[0]?.id as string | undefined;
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta." }, { status: 404 });

  let q = admin
    .from("corridas")
    .select("pedido, modelo, color, tallas, total, origen, actualizado_en", { count: "exact" })
    .eq("account_id", cuenta);
  if (pag.desde) q = q.gt("actualizado_en", pag.desde);
  const { data, error, count } = await q
    .order("actualizado_en", { ascending: true })
    .order("pedido", { ascending: true })
    .order("modelo", { ascending: true })
    .order("color", { ascending: true })
    .range(pag.offset, pag.offset + pag.limit - 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const corridas = ((data ?? []) as FilaCorrida[]).map(corridaParaIndusther);
  const total = count ?? corridas.length;
  return NextResponse.json({
    ok: true,
    generado: new Date().toISOString(),
    total,
    limit: pag.limit,
    offset: pag.offset,
    hayMas: pag.offset + corridas.length < total,
    corridas,
  });
}
