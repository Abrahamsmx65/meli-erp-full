import { NextResponse, after } from "next/server";
import { conSesion, errorJson } from "@/lib/yapanizcel/api";
import { sincronizarInventarioDesdeSheets } from "@/lib/yapanizcel/inventario";
import { recalcularInventarioAmarrado, recalcularInventarioPantalla } from "@/lib/yapanizcel/inventario-pantalla";
import { configuracionSheets, descargarSheet, leerInventario, leerLibro } from "@/lib/yapanizcel/sheets";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Baja el sheet de inventario y reemplaza la bodega. La pantalla lee el
 * renglón masticado (aunque esté viejo), así que después de leer el sheet
 * el amarre y la Bodega se recalculan en el fondo con `after()`: quien
 * apretó el botón quiere ver la bodega nueva al recargar, no en el
 * siguiente cron. Compras y plan los levanta el cron.
 */
export async function POST() {
  const ctx = await conSesion();
  if (!ctx.ok) return ctx.respuesta;
  try {
    const r = await sincronizarInventarioDesdeSheets(ctx.db, ctx.cuenta.id);
    after(async () => {
      try {
        await recalcularInventarioAmarrado(ctx.db, ctx.cuenta.id);
        await recalcularInventarioPantalla(ctx.db, ctx.cuenta.id);
      } catch (err) {
        console.error("sheets: recálculo de fondo:", (err as Error).message);
      }
    });
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
