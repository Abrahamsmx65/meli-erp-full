import { NextResponse } from "next/server";
import { sesionYCuenta } from "../_comun";
import { cargarMonitor, aplicarPublicidadAlMonitor, normalizarRango } from "@/lib/servicios/ventas-monitor";
import { cargarPublicidad, type FilaPublicidad } from "@/lib/servicios/publicidad";
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
    const [monitor, publicidad] = await Promise.all([
      cargarMonitor(sesion.supabase, sesion.cuenta.id, rango),
      cargarPublicidad(sesion.supabase, sesion.cuenta, rango).catch((err) => ({
        filas: [] as FilaPublicidad[],
        totales: { gastoAds: 0 },
        errorAds: `No se pudo leer Product Ads: ${(err as Error).message}`,
      })),
    ]);
    const adsPorModelo = publicidad.errorAds
      ? null
      : new Map(publicidad.filas.map((f) => [f.modelo, f.gastoAds]));
    const filas = aplicarPublicidadAlMonitor(monitor, adsPorModelo).porModelo;

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