/**
 * Recarga histórica de ventas, encolada.
 *
 * Un año son 13 reportes de 30 días (el tope que Amazon acepta por reporte) y
 * cada uno tarda minutos en generarse. Nada de eso cabe en una función de 60 s,
 * así que el trabajo se parte en ventanas y el cron avanza una por corrida:
 * la pide, y en la siguiente pasada la recoge.
 */
import type { Cliente } from "./spapi";
import { VENTAS, descargarReporte, estadoReporte, solicitarReporte } from "./reportes";
import { agregarDesdeReporte, guardarEnLotes, husoDe } from "./sync";

/** Amazon limita cada reporte de órdenes a 30 días. */
const DIAS_POR_VENTANA = 30;

/** Tras varios intentos fallidos se abandona la ventana y se sigue con la que sigue. */
const INTENTOS_MAX = 5;

export interface Ventana {
  account_id: string;
  desde: string;
  hasta: string;
}

/** Parte un periodo en ventanas de 30 días, de la más reciente a la más vieja. */
export function partirEnVentanas(accountId: string, dias: number, hoy = new Date()): Ventana[] {
  const ventanas: Ventana[] = [];
  const fin = new Date(hoy.getTime());
  const inicio = new Date(hoy.getTime() - dias * 86_400_000);

  let cursor = new Date(fin.getTime());
  while (cursor > inicio) {
    const desde = new Date(
      Math.max(inicio.getTime(), cursor.getTime() - DIAS_POR_VENTANA * 86_400_000),
    );
    ventanas.push({
      account_id: accountId,
      desde: desde.toISOString().slice(0, 10),
      hasta: cursor.toISOString().slice(0, 10),
    });
    cursor = desde;
  }
  return ventanas;
}

export interface ResultadoRecarga {
  estado: "sin_cola" | "solicitada" | "procesando" | "cargada" | "abandonada";
  desde?: string;
  hasta?: string;
  filas?: number;
  pendientes?: number;
}

/**
 * Avanza UNA ventana de la cola. La más antigua primero, para que el histórico
 * se rellene en orden y se note el avance.
 */
export async function procesarRecarga(
  admin: any,
  cliente: Cliente,
): Promise<ResultadoRecarga> {
  const accountId = cliente.cuenta.accountId;

  const { data: fila } = await admin
    .from("amazon_recargas")
    .select("id, desde, hasta, estado, report_id, intentos")
    .eq("account_id", accountId)
    .in("estado", ["pendiente", "solicitado"])
    .order("desde", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!fila) return { estado: "sin_cola" };

  const restantes = async () => {
    const { count } = await admin
      .from("amazon_recargas")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .in("estado", ["pendiente", "solicitado"]);
    return count ?? 0;
  };

  const marcar = (cambios: Record<string, unknown>) =>
    admin
      .from("amazon_recargas")
      .update({ ...cambios, actualizado_en: new Date().toISOString() })
      .eq("id", fila.id);

  // Paso 1: pedir el reporte.
  if (fila.estado === "pendiente" || !fila.report_id) {
    if (fila.intentos >= INTENTOS_MAX) {
      await marcar({ estado: "error", error: "Se agotaron los intentos." });
      return { estado: "abandonada", desde: fila.desde, hasta: fila.hasta };
    }

    const reportId = await solicitarReporte(cliente, VENTAS, cliente.cuenta.marketplaceId, {
      desde: new Date(`${fila.desde}T00:00:00Z`),
      hasta: new Date(`${fila.hasta}T23:59:59Z`),
    });
    if (!reportId) {
      await marcar({ intentos: fila.intentos + 1 });
      return { estado: "procesando", desde: fila.desde, pendientes: await restantes() };
    }

    await marcar({ estado: "solicitado", report_id: reportId, intentos: fila.intentos + 1 });
    return { estado: "solicitada", desde: fila.desde, hasta: fila.hasta, pendientes: await restantes() };
  }

  // Paso 2: recogerlo.
  const st = await estadoReporte(cliente, fila.report_id);

  if (st.estado === "procesando") {
    return { estado: "procesando", desde: fila.desde, pendientes: await restantes() };
  }

  if (st.estado === "vacio") {
    await marcar({ estado: "listo", filas: 0 });
    return { estado: "cargada", desde: fila.desde, hasta: fila.hasta, filas: 0, pendientes: await restantes() };
  }

  if (st.estado === "fallido") {
    // Amazon a veces marca FATAL un reporte válido; se vuelve a pedir.
    await marcar({ estado: "pendiente", report_id: null });
    return { estado: "procesando", desde: fila.desde, pendientes: await restantes() };
  }

  const filas = await descargarReporte(cliente, st.documentId);
  const { ventas, skus } = agregarDesdeReporte(filas, accountId, husoDe(cliente.cuenta.marketplaceId));

  // La ventana se pidió por días enteros, así que todo lo que trae es completo.
  await guardarEnLotes(admin, "amazon_skus", skus);
  await guardarEnLotes(admin, "amazon_ventas_diarias", ventas);
  await marcar({ estado: "listo", filas: ventas.length });

  return {
    estado: "cargada",
    desde: fila.desde,
    hasta: fila.hasta,
    filas: ventas.length,
    pendientes: await restantes(),
  };
}
