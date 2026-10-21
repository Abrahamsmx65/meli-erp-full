/**
 * Confirmación de los pedidos a China contra el sheet de pedidos pendientes.
 *
 * China confirma un pedido SUBIÉNDOLO al sheet "PENDING ORDERS SHOES
 * INTERNET" (el mismo de `pedidos-sheet.ts`); el dueño lo revisaba a ojo.
 * Pedido del dueño, 21-oct-2026: «a las 8 am de aquí corra y revise si ya
 * subieron al sheets los pedidos nuevos y me salga ahí confirmado o en su
 * caso falta confirmar»; y «no necesito un correo, solo el cron y poder
 * verlo en el sistema».
 *
 * Cada mañana (cron `/api/cron/confirmacion-pedidos`, 14:00Z = 8:00 en
 * México) se relee el sheet, se guarda masticado (Órdenes de compra lo
 * enseña junto a cada pedido sin barco) y queda constancia en `sync_log`
 * (tarea `confirmacion-pedidos`): la pantalla dice cuándo fue la última
 * revisión y qué encontró. Sin correo.
 */
import type { Cuenta, DB } from "../datos/repos";
import { guardarCacheApp } from "./cache-app";
import { listarPedidos } from "./pedidos";
import { confirmacionDePedidos, faltantesDelSheet, type ConfirmacionPedido } from "./pedidos-sheet";
import { hoyMx } from "./resumen-diario";

export const TAREA_CONFIRMACION = "confirmacion-pedidos";

export interface RevisionConfirmacion {
  dia: string;
  revisadoEn: string;
  confirmacion: ConfirmacionPedido[];
  faltan: number;
  confirmados: number;
}

/** La última revisión automática, para que la pantalla diga cuándo fue y qué vio. */
export interface UltimaRevision {
  revisadoEn: string;
  faltan: string[];
  confirmados: string[];
  error: string | null;
}

export async function ultimaRevisionConfirmacion(db: DB, accountId: string): Promise<UltimaRevision | null> {
  const { data } = await db
    .from("sync_log")
    .select("fin, inicio, estado, detalle")
    .eq("account_id", accountId)
    .eq("tarea", TAREA_CONFIRMACION)
    .order("inicio", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const d = (data as { fin: string | null; inicio: string | null; estado: string; detalle?: Record<string, unknown> }).detalle ?? {};
  return {
    revisadoEn: String(data.fin ?? data.inicio ?? ""),
    faltan: Array.isArray(d.faltan) ? (d.faltan as string[]) : [],
    confirmados: Array.isArray(d.confirmados) ? (d.confirmados as string[]) : [],
    error: data.estado === "error" ? String(d.error ?? "falló") : null,
  };
}

/** Relee el sheet, lo deja masticado para la pantalla y anota qué encontró. */
export async function revisarConfirmacionPedidos(db: DB, cuenta: Cuenta): Promise<RevisionConfirmacion> {
  const inicio = new Date().toISOString();
  const t0 = Date.now();
  const [sheet, pedidos] = await Promise.all([faltantesDelSheet(db, cuenta.id), listarPedidos(db, cuenta.id)]);
  // Lo que la pantalla lee: el mismo renglón que ella refresca cada 10 min.
  await guardarCacheApp(db, cuenta.id, "pedidos-sheet", sheet, Date.now() - t0).catch(() => undefined);

  const confirmacion = confirmacionDePedidos(pedidos, [...sheet.cargados, ...sheet.faltan]);
  const r: RevisionConfirmacion = {
    dia: hoyMx(),
    revisadoEn: new Date().toISOString(),
    confirmacion,
    faltan: confirmacion.filter((c) => c.estado === "falta").length,
    confirmados: confirmacion.filter((c) => c.estado === "confirmado").length,
  };

  await db.from("sync_log").insert({
    account_id: cuenta.id,
    tarea: TAREA_CONFIRMACION,
    inicio,
    fin: r.revisadoEn,
    estado: "ok",
    detalle: {
      dia: r.dia,
      faltan: confirmacion.filter((c) => c.estado === "falta").map((c) => c.pedido),
      confirmados: confirmacion.filter((c) => c.estado === "confirmado").map((c) => c.pedido),
      fuera: confirmacion.filter((c) => c.estado === "fuera").map((c) => c.pedido),
    },
  });

  return r;
}
