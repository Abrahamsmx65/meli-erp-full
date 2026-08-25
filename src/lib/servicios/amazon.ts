/**
 * Datos de Amazon para la pantalla.
 *
 * La agregación vive en Postgres (funciones `amazon_resumen_skus` y
 * `amazon_totales`), no aquí: son ~136 mil renglones de venta diaria y
 * traerlos al servidor de Next para sumarlos sería tirar el ancho de banda y
 * la memoria a la basura. Aquí solo se normaliza lo que devuelve.
 */
import type { DB } from "@/lib/datos/repos";

export interface CuentaAmazon {
  id: string;
  nombre: string | null;
  pais: string;
}

export interface RenglonAmazon {
  sku: string;
  titulo: string | null;
  asin: string | null;
  unidades: number;
  ordenes: number;
  importe: number;
  disponible: number;
  enTransferencia: number;
  totalFba: number;
  /** Días que dura el stock al ritmo del periodo. Nulo si no hubo ventas. */
  cobertura: number | null;
}

export interface TotalesAmazon {
  skus: number;
  conVenta: number;
  unidades: number;
  importe: number;
  disponible: number;
  enTransito: number;
  sinStock: number;
}

/** Periodos ofrecidos. 365 permite ver estacionalidad completa. */
export const PERIODOS = [7, 15, 30, 60, 90, 365] as const;
export const PERIODO_OMISION = 30;

/** Tope de renglones que se mandan al navegador; la búsqueda va en Postgres. */
export const LIMITE_FILAS = 500;

/**
 * Para el PLAN de envíos el tope no aplica: con el top-500, el 64% de los
 * SKUs de calzado con venta (~21% de las unidades) quedaba invisible — justo
 * las tallas de las orillas que más se agotan. La pantalla puede paginar; el
 * plan tiene que ver todo.
 */
export const SIN_LIMITE = 100_000;

export function normalizarDias(valor: string | undefined): number {
  const n = Number(valor);
  return (PERIODOS as readonly number[]).includes(n) ? n : PERIODO_OMISION;
}

export async function cuentaAmazon(db: DB): Promise<CuentaAmazon | null> {
  const { data } = await db
    .from("amazon_accounts")
    .select("id, nombre, pais")
    .order("creado_en", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as CuentaAmazon) ?? null;
}

/** PostgREST devuelve los `numeric` como texto; hay que convertirlos siempre. */
function num(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Un minuto de caché por instancia: las dos funciones de agregación en
 * Postgres cuestan ~0.5 s cada una y esta lectura corre en cada visita a
 * /amazon, su Excel y el monitor. Los datos solo cambian cuando sincroniza
 * el cron (cada 15-60 min); el minuto de retraso no cambia ninguna decisión.
 */
const cacheCarga = new Map<
  string,
  { en: number; datos: { renglones: RenglonAmazon[]; totales: TotalesAmazon } }
>();
const VIDA_CACHE_CARGA_MS = 60_000;

export async function cargarAmazon(
  db: DB,
  dias: number,
  busqueda: string,
  limite: number = LIMITE_FILAS,
): Promise<{ renglones: RenglonAmazon[]; totales: TotalesAmazon }> {
  const q = busqueda.trim() === "" ? null : busqueda.trim();

  const clave = `${dias}|${q ?? ""}|${limite}`;
  const guardado = cacheCarga.get(clave);
  if (guardado && Date.now() - guardado.en < VIDA_CACHE_CARGA_MS) return guardado.datos;

  const [resumen, totales] = await Promise.all([
    db.rpc("amazon_resumen_skus", {
      p_dias: dias,
      p_busqueda: q,
      p_limite: limite,
    }),
    db.rpc("amazon_totales", { p_dias: dias, p_busqueda: q }),
  ]);

  if (resumen.error) throw new Error(`amazon_resumen_skus: ${resumen.error.message}`);
  if (totales.error) throw new Error(`amazon_totales: ${totales.error.message}`);

  const renglones: RenglonAmazon[] = ((resumen.data ?? []) as any[]).map((r) => ({
    sku: String(r.seller_sku ?? ""),
    titulo: r.titulo ?? null,
    asin: r.asin ?? null,
    unidades: num(r.unidades),
    ordenes: num(r.ordenes),
    importe: num(r.importe),
    disponible: num(r.disponible),
    enTransferencia: num(r.en_transferencia),
    totalFba: num(r.total_fba),
    cobertura: r.dias_cobertura === null || r.dias_cobertura === undefined
      ? null
      : num(r.dias_cobertura),
  }));

  const t = (((totales.data ?? []) as any[])[0] ?? {}) as Record<string, unknown>;

  const datos = {
    renglones,
    totales: {
      skus: num(t.skus),
      conVenta: num(t.con_venta),
      unidades: num(t.unidades),
      importe: num(t.importe),
      disponible: num(t.disponible),
      enTransito: num(t.en_transito),
      sinStock: num(t.sin_stock),
    },
  };
  cacheCarga.set(clave, { en: Date.now(), datos });
  return datos;
}

export interface EstadoRecarga {
  pendientes: number;
  listas: number;
  total: number;
  /** Ventana más antigua que falta: es lo que se está procesando ahora. */
  enCurso: string | null;
}

/** Avance de la recarga histórica encolada, para mostrarlo en pantalla. */
export async function estadoRecarga(db: DB, accountId: string): Promise<EstadoRecarga> {
  const { data } = await db
    .from("amazon_recargas")
    .select("desde, estado")
    .eq("account_id", accountId)
    .order("desde", { ascending: true });

  const filas = (data ?? []) as { desde: string; estado: string }[];
  const pendientes = filas.filter(
    (f) => f.estado === "pendiente" || f.estado === "solicitado",
  );

  return {
    pendientes: pendientes.length,
    listas: filas.filter((f) => f.estado === "listo").length,
    total: filas.length,
    enCurso: pendientes[0]?.desde ?? null,
  };
}
