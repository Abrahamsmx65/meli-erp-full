/**
 * De la base al renglón masticado. Lee lo que Postgres ya sumó por día —dos
 * RPC acotados por el rango, nunca las tablas crudas— y se lo entrega al
 * motor. Aquí vive el único I/O de finanzas.
 */
import { ordenesPorDiaDesdeRpc } from "../corte-meli";
import { armarFinanzas, type DiaDeVenta } from "./motor";
import type { FinanzasPeriodo } from "./tipos";
import type { DB } from "../../datos/repos";

export async function ventasPorDiaDesdeRpc(
  db: DB,
  accountId: string,
  desde: string,
  hasta: string,
): Promise<DiaDeVenta[]> {
  const { data, error } = await db.rpc("ventas_totales_dia", {
    p_account: accountId,
    p_desde: desde,
    p_hasta: hasta,
  });
  if (error) throw new Error(`ventas_totales_dia: ${error.message}`);
  return ((data ?? []) as any[]).map((d) => ({ fecha: String(d.fecha), importe: Number(d.importe) || 0 }));
}

/** Calcula las finanzas de MELI calzado del rango, desde la base. */
export async function masticarFinanzasMeli(
  db: DB,
  accountId: string,
  rango: { desde: string; hasta: string },
): Promise<FinanzasPeriodo> {
  const [dias, ventas] = await Promise.all([
    ordenesPorDiaDesdeRpc(db, "cortes_ordenes_por_dia", accountId, rango.desde, rango.hasta),
    ventasPorDiaDesdeRpc(db, accountId, rango.desde, rango.hasta),
  ]);
  return armarFinanzas({ rango, dias, ventas, generadoEn: new Date().toISOString() });
}
