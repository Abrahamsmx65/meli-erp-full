/**
 * Lecturas de tabla completas para YAPANIZCEL.
 *
 * Supabase corta en 1000 renglones por petición; aquí se pide por páginas
 * hasta vaciar. Las tablas de este ERP son chicas (cientos de SKUs), pero
 * ventas diarias × 90 días sí pasa del corte.
 */
import type { DB } from "../datos/repos";

export async function todo<T = Record<string, any>>(
  db: DB,
  tabla: string,
  columnas: string,
  filtrar: (q: any) => any,
  pagina = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; desde += pagina) {
    const { data, error } = await filtrar(db.from(tabla).select(columnas)).range(desde, desde + pagina - 1);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    const lote = (data ?? []) as T[];
    out.push(...lote);
    if (lote.length < pagina) break;
  }
  return out;
}

export function hoyMx(): string {
  return new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
}

export function restarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
