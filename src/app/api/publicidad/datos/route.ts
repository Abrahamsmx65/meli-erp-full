import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { cargarPublicidad } from "@/lib/servicios/publicidad";
import { cargarPublicidadAmazon } from "@/lib/servicios/publicidad-amazon";
import { fechaMx, normalizarRango } from "@/lib/servicios/ventas-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET -> qué tanto de la información llega REALMENTE a cada panel de
 * publicidad, en números.
 *
 * Cuando el panel "no jala toda la info" hay que poder ver, sin adivinar,
 * cuántos renglones llegaron, cuánto suman y si algo falló en el camino.
 * Acepta ?desde=&hasta= para revisar el mismo periodo que se ve en pantalla;
 * sin ellos, los últimos 30 días, como los paneles.
 */
export async function GET(req: Request) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const url = new URL(req.url);
  const rango = normalizarRango(
    url.searchParams.get("desde") ?? fechaMx(29),
    url.searchParams.get("hasta") ?? undefined,
  );

  const salida: Record<string, unknown> = { rango };

  // --- Mercado Libre ------------------------------------------------------
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    salida.meli = { estado: "sin cuenta de MELI conectada" };
  } else {
    try {
      const p = await cargarPublicidad(supabase, cuenta, rango);
      salida.meli = {
        errorAds: p.errorAds,
        modelosEnLaTabla: p.filas.length,
        modelosConGastoAds: p.filas.filter((f) => f.gastoAds > 0).length,
        gastoAdsTotal: Math.round(p.totales.gastoAds),
        ventaDelPeriodo: Math.round(p.totales.importe),
        unidades: p.totales.unidades,
        anunciosSinAmarre: p.sinAmarre,
        recomendaciones: p.recomendaciones.length,
      };
    } catch (err) {
      salida.meli = { tronó: err instanceof Error ? err.message : String(err) };
    }
  }

  // --- Amazon -------------------------------------------------------------
  const amz = await cuentaAmazon(supabase);
  if (!amz) {
    salida.amazon = { estado: "sin cuenta de Amazon conectada" };
  } else {
    try {
      const a = await cargarPublicidadAmazon(supabase, amz.id, cuenta?.id ?? null, rango);
      salida.amazon = {
        aviso: a.aviso,
        economiaHasta: a.economiaHasta,
        modelosEnLaTabla: a.filas.length,
        modelosConGastoAds: a.filas.filter((f) => (f.gastoAds ?? 0) > 0).length,
        gastoAdsTotal: Math.round(a.totales.gastoAds),
        ventaDelPeriodo: Math.round(a.totales.importe),
        unidades: a.totales.unidades,
        ventaDelReporteDeEconomia: Math.round(a.totales.ventasEconomia),
      };
    } catch (err) {
      salida.amazon = { tronó: err instanceof Error ? err.message : String(err) };
    }
  }

  return NextResponse.json(salida);
}
