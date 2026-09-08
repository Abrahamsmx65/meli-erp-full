/**
 * Caché de resultados masticados de YAPANIZCEL (`yz_cache`).
 *
 * El mismo patrón que salvó al calzado (plan_cache / inventario_cache): el
 * trabajo pesado —bajar ~18 mil variantes, amarrarlas, agregarlas— se hace
 * UNA vez, se guarda por clave, y la pantalla lee un renglón.
 *
 * Regla de oro (decidida por el dueño): LA PANTALLA NUNCA CALCULA. Siempre
 * sirve el último renglón guardado, aunque un sync lo haya invalidado o
 * tenga horas; el recálculo es trabajo del fondo (el cron de netos), que
 * refresca lo invalidado Y lo viejo. La única excepción es cuando no existe
 * ningún renglón (la primera vez en la vida de la clave): ahí sí se calcula
 * en el request y se guarda, porque no hay nada que servir.
 *
 * Los resultados traen Maps y Sets adentro: se aplanan con la misma marca
 * de tipos del plan de FBA y se rehidratan al leer.
 */
import type { DB } from "../datos/repos";
import { marcarTipos, revivirTipos } from "../servicios/plan-fba-cache";

/** Las claves fijas que el cron refresca; las de publicidad son dinámicas ("ads:2026-09"). */
export const CLAVES_YZ = ["compras", "plan", "inventario", "amarre", "disenos", "pedidos"] as const;

/**
 * A partir de esta edad un renglón se considera para refrescar en el fondo
 * aunque nadie lo haya invalidado (red de seguridad por si a algún escritor
 * le falta el gancho). La pantalla lo sigue sirviendo mientras tanto.
 */
export const REFRESCO_YZ_MS = 4 * 3_600_000;

export interface GuardadoYz<T> {
  datos: T;
  generadoEn: string;
  vigente: boolean;
}

/**
 * El renglón guardado TAL CUAL esté: vigente o invalidado, fresco o viejo.
 * Es lo que leen las pantallas — servir un dato de hace un rato le gana a
 * cobrarle el cálculo al clic; el fondo lo refresca solo.
 */
export async function leerCacheYzGuardado<T>(db: DB, accountId: string, clave: string): Promise<GuardadoYz<T> | null> {
  try {
    const { data, error } = await db
      .from("yz_cache")
      .select("datos, vigente, generado_en")
      .eq("account_id", accountId)
      .eq("clave", clave)
      .maybeSingle();
    if (error || !data?.datos) return null;
    return {
      datos: revivirTipos(data.datos) as T,
      generadoEn: data.generado_en,
      vigente: data.vigente !== false,
    };
  } catch {
    // Tabla aún sin migrar o error de lectura: el llamador calcula.
    return null;
  }
}

/**
 * Solo lo VIGENTE y fresco. Para los que sí necesitan frescura estricta
 * (p. ej. la publicidad del mes corriente), no para las pantallas.
 */
export async function leerCacheYz<T>(
  db: DB,
  accountId: string,
  clave: string,
  edadMaxMs?: number,
): Promise<T | null> {
  const g = await leerCacheYzGuardado<T>(db, accountId, clave);
  if (!g || !g.vigente) return null;
  if (edadMaxMs != null && Date.now() - Date.parse(g.generadoEn) > edadMaxMs) return null;
  return g.datos;
}

export async function guardarCacheYz(
  db: DB,
  accountId: string,
  clave: string,
  datos: unknown,
  msCalculo: number,
): Promise<void> {
  await guardarCacheYzLote(db, accountId, [{ clave, datos }], msCalculo);
}

/**
 * Varios renglones de un mismo cálculo, de un jalón (en tandas de 100):
 * así se guardan las vistas DERIVADAS de un resultado grande (el resumen
 * y cada diseño de compras), que la pantalla lee chiquitas en vez de
 * bajar el cálculo completo en cada clic.
 */
export async function guardarCacheYzLote(
  db: DB,
  accountId: string,
  filas: { clave: string; datos: unknown }[],
  msCalculo: number,
): Promise<void> {
  const generadoEn = new Date().toISOString();
  for (let i = 0; i < filas.length; i += 100) {
    const { error } = await db.from("yz_cache").upsert(
      filas.slice(i, i + 100).map((f) => ({
        account_id: accountId,
        clave: f.clave,
        generado_en: generadoEn,
        vigente: true,
        motivo: null,
        ms_calculo: msCalculo,
        datos: marcarTipos(f.datos),
      })),
      { onConflict: "account_id,clave" },
    );
    // Sin guardar, el dato sirve igual: solo se pierde el ahorro.
    if (error) console.error(`yz_cache (${filas[i]?.clave}…):`, error.message);
  }
}

/**
 * Lo que leen las pantallas: el renglón guardado aunque esté invalidado o
 * viejo (el fondo lo refresca); solo si NO EXISTE se calcula y se guarda.
 */
export async function conCacheYz<T>(
  db: DB,
  accountId: string,
  clave: string,
  calcular: () => Promise<T>,
): Promise<T> {
  const guardado = await leerCacheYzGuardado<T>(db, accountId, clave);
  if (guardado != null) return guardado.datos;
  return recalcularCacheYz(db, accountId, clave, calcular);
}

/** Calcula y guarda una clave (lo que hace el cron, y el respaldo sin renglón). */
export async function recalcularCacheYz<T>(
  db: DB,
  accountId: string,
  clave: string,
  calcular: () => Promise<T>,
): Promise<T> {
  const t0 = Date.now();
  const datos = await calcular();
  await guardarCacheYz(db, accountId, clave, datos, Date.now() - t0);
  return datos;
}

/**
 * Marca claves como obsoletas (todas si no se pasan). Lo llaman los syncs
 * (catálogo, stock, ventas, sheet) y las rutas que escriben (amarres,
 * pedidos, envíos, costos, parámetros). La pantalla sigue sirviendo el
 * renglón invalidado; el cron de netos lo recalcula en su siguiente corrida.
 */
export async function invalidarYz(
  db: DB,
  accountId: string,
  motivo: string,
  claves?: readonly string[],
): Promise<void> {
  try {
    if (!claves?.length) {
      await db.from("yz_cache").update({ vigente: false, motivo }).eq("account_id", accountId);
      return;
    }
    // Las vistas derivadas ("compras:resumen", "compras:d:499") caen con su
    // cálculo padre: la clave exacta O lo que empieza con "clave:".
    const filtro = [
      `clave.in.(${claves.map((c) => `"${c}"`).join(",")})`,
      ...claves.map((c) => `clave.like.${c}:*`),
    ].join(",");
    await db.from("yz_cache").update({ vigente: false, motivo }).eq("account_id", accountId).or(filtro);
  } catch {
    // Tabla aún sin migrar: no hay nada que invalidar.
  }
}

/**
 * Qué claves fijas necesitan refresco, para que el cron las deje listas:
 * las que no existen, las invalidadas Y las que ya pasaron de
 * `REFRESCO_YZ_MS` de edad aunque nadie las haya invalidado (antes solo se
 * miraba `vigente` y el primer clic de la mañana pagaba el cálculo).
 * Primero las invalidadas o faltantes, luego las más viejas.
 */
export async function clavesObsoletasYz(db: DB, accountId: string): Promise<string[]> {
  try {
    const { data, error } = await db
      .from("yz_cache")
      .select("clave, vigente, generado_en")
      .eq("account_id", accountId)
      .in("clave", [...CLAVES_YZ]);
    if (error) return [];
    const filas = new Map((data ?? []).map((f: { clave: string; vigente: boolean | null; generado_en: string }) => [f.clave, f]));
    const ahora = Date.now();
    const urgentes: string[] = [];
    const viejas: { clave: string; edad: number }[] = [];
    for (const clave of CLAVES_YZ) {
      const f = filas.get(clave);
      if (!f || f.vigente === false) {
        urgentes.push(clave);
        continue;
      }
      const edad = ahora - Date.parse(f.generado_en);
      if (edad > REFRESCO_YZ_MS) viejas.push({ clave, edad });
    }
    viejas.sort((a, b) => b.edad - a.edad);
    return [...urgentes, ...viejas.map((v) => v.clave)];
  } catch {
    return [];
  }
}
