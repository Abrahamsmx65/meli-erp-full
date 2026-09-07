import { NextResponse, type NextRequest } from "next/server";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const body = await req.json().catch(() => null);
  const entero = (v: unknown, min: number, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const fila = {
    account_id: ctx.cuenta.id,
    dias_venta: entero(body?.diasVenta, 7, 180),
    dias_objetivo: entero(body?.diasObjetivo, 7, 180),
    multiplo_envio: entero(body?.multiploEnvio, 1, 100),
    minimo_envio: entero(body?.minimoEnvio, 1, 500),
    dias_caducidad_envio: entero(body?.diasCaducidadEnvio, 1, 60),
    actualizado_en: new Date().toISOString(),
  };
  if (Object.values(fila).some((v) => v === null)) {
    return NextResponse.json({ error: "Algún parámetro está fuera de rango." }, { status: 400 });
  }
  const { error } = await ctx.db.from("yz_parametros").upsert(fila, { onConflict: "account_id" });
  if (error) return errorJson(error);
  return NextResponse.json({ ok: true });
}
