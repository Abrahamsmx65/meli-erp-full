import { NextResponse, type NextRequest } from "next/server";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";
import { calcularPlanDeCuenta, cambiarEstadoEnvio, registrarEnvio } from "@/lib/yapanizcel/envios";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** El plan calculado ahora mismo. */
export async function GET() {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  try {
    const plan = await calcularPlanDeCuenta(ctx.db, ctx.cuenta.id);
    return NextResponse.json({
      ok: true,
      desde: plan.desde,
      hasta: plan.hasta,
      unidades: plan.unidades,
      skus: plan.skus,
      lineas: plan.lineas.map((l) => ({ ...l, cobertura: Number.isFinite(l.cobertura) ? l.cobertura : null, titulo: plan.titulos.get(l.sku) ?? null })),
    });
  } catch (err) {
    return errorJson(err);
  }
}

/** Registra un envío. `lineas` viene de la pantalla, ya editado por el usuario. */
export async function POST(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const body = await req.json().catch(() => null);
  const lineas = Array.isArray(body?.lineas) ? body.lineas : [];
  try {
    const r = await registrarEnvio(
      ctx.db,
      ctx.cuenta.id,
      lineas.map((l: any) => ({ skuMeli: String(l?.skuMeli ?? ""), unidades: Number(l?.unidades ?? 0) })),
      { folio: body?.folio, nota: body?.nota },
    );
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return errorJson(err, 400);
  }
}

export async function PATCH(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const body = await req.json().catch(() => null);
  const id = String(body?.id ?? "");
  const estado = String(body?.estado ?? "");
  if (!id || !["preparado", "enviado", "recibido", "cancelado"].includes(estado)) {
    return NextResponse.json({ error: "Falta el id o el estado no es válido." }, { status: 400 });
  }
  try {
    await cambiarEstadoEnvio(ctx.db, ctx.cuenta.id, id, estado as never);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorJson(err);
  }
}
