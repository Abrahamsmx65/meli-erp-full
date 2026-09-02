import { NextResponse, type NextRequest } from "next/server";
import { upsertEnTandas } from "@/lib/datos/repos";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";
import { leerCostos } from "@/lib/yapanizcel/costos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Sube el Excel de costos (MODELO, COSTO) y lo guarda. Se acumula: un modelo nuevo se agrega y uno viejo se actualiza. */
export async function POST(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;

  const form = await req.formData().catch(() => null);
  const archivo = form?.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return NextResponse.json({ error: "No recibí el archivo de costos." }, { status: 400 });
  }

  try {
    const r = await leerCostos(Buffer.from(await archivo.arrayBuffer()), archivo.name);
    const ahora = new Date().toISOString();
    await upsertEnTandas(
      ctx.db,
      "yz_costos",
      r.filas.map((f) => ({ account_id: ctx.cuenta.id, modelo: f.modelo, etiqueta: f.etiqueta, costo: f.costo, actualizado_en: ahora })),
      "account_id,modelo",
    );
    return NextResponse.json({ ok: true, modelos: r.filas.length, avisos: r.avisos });
  } catch (err) {
    return errorJson(err, 400);
  }
}

/** Captura de un costo a mano. */
export async function PUT(req: NextRequest) {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  const body = await req.json().catch(() => null);
  const modelo = String(body?.modelo ?? "").trim().toUpperCase();
  const costo = Number(body?.costo);
  if (!modelo || !Number.isFinite(costo) || costo < 0) {
    return NextResponse.json({ error: "Falta el modelo o el costo no es válido." }, { status: 400 });
  }
  const { error } = await ctx.db
    .from("yz_costos")
    .upsert({ account_id: ctx.cuenta.id, modelo, etiqueta: modelo, costo, actualizado_en: new Date().toISOString() }, { onConflict: "account_id,modelo" });
  if (error) return errorJson(error);
  return NextResponse.json({ ok: true });
}
