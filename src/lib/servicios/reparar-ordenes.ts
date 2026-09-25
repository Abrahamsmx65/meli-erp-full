/**
 * Registro HACIA ATRÁS de las órdenes de calzado que nunca entraron a
 * `ordenes_neto` (pedido del dueño, 25-sep-2026: junio salía con 29 % de
 * cobertura). La reparación del historial de agosto (`reparacion_ventas_v7`)
 * solo llegó 60 días atrás, así que del 1 al 18 de junio el corte tenía la
 * venta de `ventas_diarias` pero ni una orden con su depósito real: ~12,600
 * órdenes y $2.8 millones que el corte dejaba fuera del neto.
 *
 * Cada corrida barre UN día con `recalcularDiaVentas` —el mismo barrido de
 * siempre: pide el día a MELI y registra hasta 150 órdenes con su pago real
 * de Mercado Pago— y se queda en ese día mientras siga registrando órdenes
 * nuevas. Cuando un barrido ya no agrega ninguna, el día está completo y
 * pasa al anterior, hasta `FONDO_REPARAR_ORDENES`. Corre en el cron
 * `/api/cron/reparar-ordenes` con presupuesto de reloj; el avance vive en
 * `sync_log` (tarea `TAREA_REPARAR_ORDENES`).
 */
import type { DB } from "../datos/repos";
import { invalidarCortesDePeriodos } from "./corte-invalidar";
import { clienteDeCuenta, recalcularDiaVentas } from "./webhooks";

// v2: el dueño la extendió al inicio del año (25-sep-2026); la v1 terminó
// junio y arrancaba del 1-jun.
export const TAREA_REPARAR_ORDENES = "reparacion_ordenes_v2";

/** Hasta dónde hacia atrás se registran órdenes (decisión del dueño: todo el año). */
export const FONDO_REPARAR_ORDENES = "2026-01-01";

export interface EstadoReparacion {
  /** el día que toca barrer (YYYY-MM-DD, México) */
  siguiente: string | null;
  completo: boolean;
}

/**
 * Qué sigue después de barrer `fecha`: si el barrido registró órdenes
 * nuevas, el día aún puede tener más (el barrido lee 150 por vez) y se
 * queda; si no registró ninguna, el día está completo y se pasa al anterior.
 */
export function siguienteDia(fecha: string, registradasAntes: number, registradasDespues: number, fondo: string): EstadoReparacion {
  if (registradasDespues > registradasAntes) return { siguiente: fecha, completo: false };
  const anterior = new Date(Date.parse(`${fecha}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return anterior < fondo ? { siguiente: null, completo: true } : { siguiente: anterior, completo: false };
}

/** El día anterior al primero que ya tiene órdenes registradas. */
export function primerDiaFaltante(primeraOrden: string | null, hoy: string): string {
  const base = primeraOrden ? primeraOrden.slice(0, 10) : hoy;
  return new Date(Date.parse(`${base}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** Hoy en México (UTC−6 fijo). */
function hoyMx(): string {
  return new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
}

/** Órdenes del día con su depósito ya leído (`fecha` es el día de la orden). */
async function contarRegistradas(db: DB, accountId: string, fecha: string): Promise<number> {
  const { count, error } = await db
    .from("ordenes_neto")
    .select("order_id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("fecha", fecha)
    .not("neto_en", "is", null);
  if (error) throw new Error(`contar órdenes de ${fecha}: ${error.message}`);
  return count ?? 0;
}

export interface ResultadoReparacion {
  barridos: number;
  completo: boolean;
  siguiente: string | null;
  bitacora: { fecha: string; ordenesDelDia: number; antes: number; despues: number; error?: string }[];
}

export async function repararOrdenesAntiguas(db: DB, accountId: string, finMs: number): Promise<ResultadoReparacion> {
  const vacio: ResultadoReparacion = { barridos: 0, completo: false, siguiente: null, bitacora: [] };
  const { data: marca } = await db
    .from("sync_log")
    .select("detalle")
    .eq("account_id", accountId)
    .eq("tarea", TAREA_REPARAR_ORDENES)
    .eq("estado", "ok")
    .order("inicio", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (marca?.detalle?.completo) return { ...vacio, completo: true };

  let fecha: string | null = typeof marca?.detalle?.siguiente === "string" ? marca.detalle.siguiente : null;
  if (!fecha) {
    const { data: primera } = await db
      .from("ordenes_neto")
      .select("fecha")
      .eq("account_id", accountId)
      .order("fecha", { ascending: true })
      .limit(1)
      .maybeSingle();
    fecha = primerDiaFaltante(primera?.fecha ?? null, hoyMx());
  }
  if (fecha < FONDO_REPARAR_ORDENES) {
    await db.from("sync_log").insert({ account_id: accountId, tarea: TAREA_REPARAR_ORDENES, estado: "ok", fin: new Date().toISOString(), detalle: { siguiente: null, completo: true } });
    return { ...vacio, completo: true };
  }

  const cliente = await clienteDeCuenta(db, accountId);
  if (!cliente) return vacio;

  const r: ResultadoReparacion = { ...vacio, siguiente: fecha };
  const periodos = new Set<string>();
  while (fecha && Date.now() < finMs) {
    const antes = await contarRegistradas(db, accountId, fecha);
    let ordenesDelDia = 0;
    let error: string | undefined;
    try {
      ordenesDelDia = (await recalcularDiaVentas(db, accountId, cliente, fecha)).ordenesLeidas;
    } catch (err) {
      // Una respuesta degradada de MELI detiene el barrido sin tocar nada;
      // el día se anota y se sigue con el anterior para no atorarse en él.
      error = (err as Error).message.slice(0, 300);
    }
    const despues = await contarRegistradas(db, accountId, fecha);
    r.barridos++;
    r.bitacora.push({ fecha, ordenesDelDia, antes, despues, ...(error ? { error } : {}) });
    if (despues > antes) periodos.add(fecha.slice(0, 7));
    const paso = siguienteDia(fecha, antes, despues, FONDO_REPARAR_ORDENES);
    fecha = paso.siguiente;
    r.siguiente = paso.siguiente;
    r.completo = paso.completo;
  }

  await db.from("sync_log").insert({
    account_id: accountId,
    tarea: TAREA_REPARAR_ORDENES,
    estado: "ok",
    fin: new Date().toISOString(),
    detalle: { siguiente: r.siguiente, completo: r.completo, barridos: r.barridos, bitacora: r.bitacora },
  });
  // El corte del mes (y el general) se rehacen con las órdenes nuevas.
  if (periodos.size) {
    await invalidarCortesDePeriodos(db, { meliAccountId: accountId }, periodos, "Se registraron órdenes viejas con su depósito real.").catch(() => undefined);
  }
  return r;
}
