import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { unificarAtributo } from "@/lib/servicios/listados";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Unifica el valor de un atributo (el caso típico: el material) en las
 * publicaciones indicadas. Escribe directo en MELI; no toca Supabase.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const atributoId = typeof body.atributoId === "string" ? body.atributoId.trim() : "";
  const valor = typeof body.valor === "string" ? body.valor.trim() : "";
  const itemIds = Array.isArray(body.itemIds)
    ? body.itemIds.filter((x): x is string => typeof x === "string" && /^ML[A-Z]\d{4,}$/.test(x))
    : [];

  if (!atributoId || !valor || !itemIds.length) {
    return NextResponse.json(
      { error: "Faltan datos: atributo, valor y publicaciones." },
      { status: 400 },
    );
  }

  // Solo publicaciones del propio catálogo: el id llega del navegador y no
  // hay que aceptar cualquier MLM que alguien teclee.
  const { data: propias } = await supabase
    .from("skus")
    .select("item_id")
    .eq("account_id", cuenta.id)
    .in("item_id", itemIds);
  const conocidas = new Set((propias ?? []).map((f) => f.item_id as string));
  const ajenas = itemIds.filter((id) => !conocidas.has(id));
  if (ajenas.length) {
    return NextResponse.json(
      { error: `Publicaciones fuera del catálogo: ${ajenas.join(", ")}.` },
      { status: 400 },
    );
  }

  const cliente = await clienteDeCuenta(clienteAdmin(), cuenta.id);
  if (!cliente) {
    return NextResponse.json(
      { error: "La cuenta no tiene tokens de MELI guardados." },
      { status: 500 },
    );
  }

  const resultados = await unificarAtributo(cliente, itemIds, atributoId, valor);
  const errores = resultados.filter((r) => r.estado === "error").length;

  return NextResponse.json({ ok: errores === 0, resultados });
}
