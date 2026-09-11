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
  // Paginar SIN ORDER BY no es determinista en Postgres: con escrituras
  // concurrentes (el cron de netos escribe cada 10 minutos) una fila leída
  // en la página 0 puede reaparecer en la 3 y sumarse dos veces, o perderse.
  // Mismo arreglo que traerTodo del calzado: orden estable por la primera
  // columna pedida (si el llamador ya ordena, este solo queda de desempate).
  const primera = (columnas.split(",")[0] ?? "").trim().split(":")[0]?.trim();
  const out: T[] = [];
  for (let desde = 0; ; desde += pagina) {
    let q = filtrar(db.from(tabla).select(columnas));
    if (primera) q = q.order(primera, { ascending: true });
    const { data, error } = await q.range(desde, desde + pagina - 1);
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

/**
 * Una función de la base que devuelve tabla, completa, por páginas.
 * `orden` da el orden estable entre páginas (mismo motivo que en todo()):
 * sin él, dos páginas del mismo agregado pueden traslaparse o dejar huecos.
 *
 * Cada página vuelve a correr la función entera, así que las páginas chicas
 * salen CARAS: la venta de fundas de mayo son 34 mil renglones y de mil en
 * mil eran 35 corridas del mes completo. Por eso el tamaño se puede subir.
 *
 * Se avanza por lo que REALMENTE llegó y solo se para con lote vacío: si el
 * servidor recorta la página (PostgREST puede traer menos de lo pedido), el
 * corte anterior —«llegaron menos de los que pedí, ya acabé»— se quedaba con
 * una parte y no lo decía. Perder renglones en silencio es peor que tardar.
 */
export async function rpcTodo<T>(
  db: DB,
  fn: string,
  args: Record<string, unknown>,
  orden: string[] = [],
  pagina = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; ) {
    let q: any = db.rpc(fn, args);
    for (const col of orden) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(desde, desde + pagina - 1);
    if (error) throw new Error(`${fn}: ${error.message}`);
    const lote = (data ?? []) as T[];
    out.push(...lote);
    if (lote.length === 0) break;
    desde += lote.length;
    // Tope de seguridad: 500 mil renglones es muchísimo más que cualquier
    // mes real; llegar ahí es que algo se salió de control.
    if (out.length >= 500_000) break;
  }
  return out;
}
