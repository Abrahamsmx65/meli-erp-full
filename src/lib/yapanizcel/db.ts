/**
 * Lecturas de tabla completas para YAPANIZCEL.
 *
 * Supabase corta en 1000 renglones por petición; aquí se pide por páginas
 * hasta vaciar. Las tablas de este ERP son chicas (cientos de SKUs), pero
 * ventas diarias × 90 días sí pasa del corte.
 */
import { TOPE_FILAS_SERVIDOR, type DB } from "../datos/repos";

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
 * Se avanza por lo que REALMENTE llegó: si el servidor recorta la página
 * (PostgREST nunca da más de 1,000), un lote de exactamente 1,000 no es el
 * final aunque se hayan pedido 10 mil. Solo un lote más corto que lo pedido
 * Y que ese tope lo es (igual que traerRpcTodo del calzado).
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
    // Llegó menos que lo pedido Y menos que el tope del servidor (PostgREST
    // nunca da más de 1,000 por respuesta): ya no hay más. Antes solo se
    // paraba con un lote vacío y, con el tope de 1,000, cada mes de fundas
    // corría la función completa una vez de más por cada mil renglones
    // (~35 corridas en mayo): por eso el corte de fundas moría por tiempo.
    if (lote.length === 0 || (lote.length < pagina && lote.length < TOPE_FILAS_SERVIDOR)) break;
    desde += lote.length;
    // Tope de seguridad: 500 mil renglones es muchísimo más que cualquier
    // mes real; llegar ahí es que algo se salió de control.
    if (out.length >= 500_000) break;
  }
  return out;
}
