/**
 * Caché de resultados masticados de YAPANIZCEL (`yz_cache`).
 *
 * El mismo patrón que salvó al calzado (plan_cache / inventario_cache): el
 * trabajo pesado —bajar ~18 mil variantes, amarrarlas, agregarlas— se hace
 * UNA vez, se guarda por clave, y la pantalla lee un renglón. Los syncs y
 * las escrituras invalidan (`invalidarYz`); el cron de netos deja todo
 * precalculado. Si no hay renglón vigente, el llamador calcula como siempre
 * y lo guarda: nunca datos a medias.
 *
 * Los resultados traen Maps y Sets adentro: se aplanan con la misma marca
 * de tipos del plan de FBA y se rehidratan al leer.
 */
import type { DB } from "../datos/repos";
import { marcarTipos, revivirTipos } from "../servicios/plan-fba-cache";

/** Las claves fijas; las de publicidad son dinámicas ("ads:2026-09"). */
export const CLAVES_YZ = ["compras", "plan", "inventario", "amarre"] as const;

export async function leerCacheYz<T>(
  db: DB,
  accountId: string,
  clave: string,
  edadMaxMs?: number,
): Promise<T | null> {
  try {
    const { data, error } = await db
      .from("yz_cache")
      .select("datos, vigente, generado_en")
      .eq("account_id", accountId)
      .eq("clave", clave)
      .maybeSingle();
    if (error || !data?.datos) return null;
    if (data.vigente === false) return null;
    if (edadMaxMs != null && Date.now() - Date.parse(data.generado_en) > edadMaxMs) return null;
    return revivirTipos(data.datos) as T;
  } catch {
    // Tabla aún sin migrar o error de lectura: el llamador calcula.
    return null;
  }
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
 * Lee el resultado masticado o lo calcula y lo guarda. `edadMaxMs` es el
 * tope duro de vejez aunque nadie lo haya invalidado (red de seguridad por
 * si a algún escritor le falta el gancho de invalidación).
 */
export async function conCacheYz<T>(
  db: DB,
  accountId: string,
  clave: string,
  calcular: () => Promise<T>,
  opts?: { edadMaxMs?: number },
): Promise<T> {
  const guardado = await leerCacheYz<T>(db, accountId, clave, opts?.edadMaxMs ?? 6 * 3_600_000);
  if (guardado != null) return guardado;

  const t0 = Date.now();
  const datos = await calcular();
  await guardarCacheYz(db, accountId, clave, datos, Date.now() - t0);
  return datos;
}

/**
 * Marca claves como obsoletas (todas si no se pasan). Lo llaman los syncs
 * (catálogo, stock, ventas, sheet) y las rutas que escriben (amarres,
 * pedidos, envíos, costos, parámetros). El cron de netos recalcula lo
 * marcado en su siguiente corrida; mientras tanto, la primera visita paga
 * el cálculo una vez y lo deja guardado.
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

/** Qué claves fijas están vencidas o no existen, para que el cron las deje listas. */
export async function clavesObsoletasYz(db: DB, accountId: string): Promise<string[]> {
  try {
    const { data, error } = await db
      .from("yz_cache")
      .select("clave, vigente")
      .eq("account_id", accountId)
      .in("clave", [...CLAVES_YZ]);
    if (error) return [];
    const vivas = new Set((data ?? []).filter((f: any) => f.vigente !== false).map((f: any) => f.clave));
    return CLAVES_YZ.filter((c) => !vivas.has(c));
  } catch {
    return [];
  }
}
