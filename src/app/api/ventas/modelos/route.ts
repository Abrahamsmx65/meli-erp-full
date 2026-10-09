import { NextResponse } from "next/server";
import { sesionYCuenta } from "../_comun";
import { normalizarRango } from "@/lib/servicios/ventas-monitor";
import { filasModeloServidas } from "@/lib/servicios/ventas-vista";
import {
  compactarFilasModelo,
  paginarFilasTabla,
  type ClaveTablaVentas,
} from "@/lib/servicios/ventas-tabla";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CLAVES = new Set<ClaveTablaVentas>([
  "modelo", "categoria", "colores", "unidadesHoy", "unidades7",
  "unidades7Prev", "cambio", "importe7", "neto7", "publicidad7", "ganancia7",
]);

export async function GET(req: Request) {
  const sesion = await sesionYCuenta();
  if (!sesion.ok) return sesion.respuesta;

  const parametros = new URL(req.url).searchParams;
  const rango = normalizarRango(
    parametros.get("desde") ?? undefined,
    parametros.get("hasta") ?? undefined,
  );
  const clavePedida = parametros.get("orden") as ClaveTablaVentas | null;
  const clave = clavePedida && CLAVES.has(clavePedida) ? clavePedida : "unidades7";
  const pagina = Number(parametros.get("pagina") ?? 1);

  try {
    // Lee los MISMOS renglones guardados que /ventas (monitor y publicidad
    // en `app_cache`): buscar, ordenar o cambiar de página ya no recalcula.
    const filas = await filasModeloServidas(sesion.supabase, sesion.cuenta, rango);

    return NextResponse.json(
      paginarFilasTabla(compactarFilasModelo(filas), {
        busqueda: parametros.get("busqueda") ?? "",
        categoria: parametros.get("categoria") ?? "",
        orden: { clave, desc: parametros.get("desc") !== "false" },
        pagina,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "No se pudo cargar la tabla." },
      { status: 500 },
    );
  }
}