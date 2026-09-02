import { NextResponse } from "next/server";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";
import { sincronizarInventarioDesdeSheets } from "@/lib/yapanizcel/inventario";
import { configuracionSheets, descargarSheet, leerInventario, leerLibro } from "@/lib/yapanizcel/sheets";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Baja el sheet de inventario y reemplaza la bodega. */
export async function POST() {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  try {
    const r = await sincronizarInventarioDesdeSheets(ctx.db, ctx.cuenta.id);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return errorJson(err, 400);
  }
}

/** Vista previa: qué se leería de cada pestaña, sin guardar nada. */
export async function GET() {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  if (!configuracionSheets()) {
    return NextResponse.json({ error: "Falta YAPANIZCEL_SHEET_URL en el entorno." }, { status: 400 });
  }
  try {
    const hojas = await leerLibro(await descargarSheet());
    const r = leerInventario(hojas);
    return NextResponse.json({
      ok: true,
      hojas: r.hojas,
      avisos: r.avisos,
      muestra: r.filas.slice(0, 50),
      renglones: r.filas.length,
      unidades: r.filas.reduce((a, f) => a + f.cantidad, 0),
    });
  } catch (err) {
    return errorJson(err, 400);
  }
}
