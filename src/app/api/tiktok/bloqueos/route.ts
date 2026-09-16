import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { bloquearRenglon, bloquearSku, desbloquear, resumenBloqueos } from "@/lib/servicios/tiktok-bloqueos";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function sesion() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 }) };
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return { error: NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 }) };
  return { supabase, user, cuenta };
}

/** Los SKUs por despachar y los bloqueos vivos. */
export async function GET() {
  const s = await sesion();
  if ("error" in s) return s.error;
  try {
    return NextResponse.json(await resumenBloqueos(clienteAdmin(), s.cuenta.id));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** Bloquear: `{ sku, motivo }` (todos los pendientes de ese SKU) o `{ lineItemId, motivo }`. */
export async function POST(req: NextRequest) {
  const s = await sesion();
  if ("error" in s) return s.error;
  const body = await req.json().catch(() => ({}));
  const motivo = String(body?.motivo ?? "").trim() || "Sin stock";
  try {
    const admin = clienteAdmin();
    if (body?.lineItemId) {
      return NextResponse.json({ ok: true, ...(await bloquearRenglon(admin, s.cuenta.id, String(body.lineItemId), motivo, s.user.id)) });
    }
    const sku = String(body?.sku ?? "").trim();
    if (!sku) return NextResponse.json({ error: "Falta el SKU." }, { status: 400 });
    return NextResponse.json({ ok: true, ...(await bloquearSku(admin, s.cuenta.id, sku, motivo, s.user.id)) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** Quitar el bloqueo: `{ sku }` o `{ lineItemIds: [] }`. */
export async function DELETE(req: NextRequest) {
  const s = await sesion();
  if ("error" in s) return s.error;
  const body = await req.json().catch(() => ({}));
  try {
    const n = await desbloquear(clienteAdmin(), s.cuenta.id, {
      sku: body?.sku ? String(body.sku) : undefined,
      lineItemIds: Array.isArray(body?.lineItemIds) ? body.lineItemIds.map(String) : undefined,
    });
    return NextResponse.json({ ok: true, renglones: n });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
