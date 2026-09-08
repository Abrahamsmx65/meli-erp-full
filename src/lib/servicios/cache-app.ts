/**
 * Caché genérico de resultados masticados (`app_cache`), lado calzado/Amazon.
 *
 * El mismo contrato que `yz_cache` en fundas: el trabajo pesado se hace UNA
 * vez, se guarda por (cuenta, clave) y las visitas leen un renglón. La
 * frescura la da un TTL corto o la invalidación explícita, y si no hay
 * renglón vigente el llamador calcula como siempre y lo guarda: nunca datos
 * a medias. Maps y Sets se aplanan con la marca de tipos del plan de FBA.
 */
import type { DB } from "../datos/repos";
import { marcarTipos, revivirTipos } from "./plan-fba-cache";

export interface GuardadoApp<T> {
  datos: T;
  generadoEn: string;
  vigente: boolean;
}

/**
 * El renglón guardado TAL CUAL esté: vigente o invalidado, fresco o viejo.
 * Para los lectores que sirven lo guardado y refrescan por atrás (cortes).
 */
export async function leerCacheAppGuardado<T>(db: DB, accountId: string, clave: string): Promise<GuardadoApp<T> | null> {
  try {
    const { data, error } = await db
      .from("app_cache")
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
    return null;
  }
}

export async function leerCacheApp<T>(
  db: DB,
  accountId: string,
  clave: string,
  edadMaxMs?: number,
): Promise<T | null> {
  try {
    const { data, error } = await db
      .from("app_cache")
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

export async function guardarCacheApp(
  db: DB,
  accountId: string,
  clave: string,
  datos: unknown,
  msCalculo: number,
): Promise<void> {
  const { error } = await db.from("app_cache").upsert(
    {
      account_id: accountId,
      clave,
      generado_en: new Date().toISOString(),
      vigente: true,
      motivo: null,
      ms_calculo: msCalculo,
      datos: marcarTipos(datos),
    },
    { onConflict: "account_id,clave" },
  );
  if (error) console.error(`app_cache (${clave}):`, error.message);
}

/** Lee el resultado masticado o lo calcula y lo guarda (TTL obligatorio). */
export async function conCacheApp<T>(
  db: DB,
  accountId: string,
  clave: string,
  edadMaxMs: number,
  calcular: () => Promise<T>,
): Promise<T> {
  const guardado = await leerCacheApp<T>(db, accountId, clave, edadMaxMs);
  if (guardado != null) return guardado;

  const t0 = Date.now();
  const datos = await calcular();
  await guardarCacheApp(db, accountId, clave, datos, Date.now() - t0);
  return datos;
}

/** Marca claves exactas o todo un prefijo ("contenido:") como obsoleto. */
export async function invalidarApp(
  db: DB,
  accountId: string,
  motivo: string,
  filtro?: { claves?: readonly string[]; prefijo?: string },
): Promise<void> {
  try {
    let q = db.from("app_cache").update({ vigente: false, motivo }).eq("account_id", accountId);
    if (filtro?.claves?.length) q = q.in("clave", [...filtro.claves]);
    else if (filtro?.prefijo) q = q.like("clave", `${filtro.prefijo}%`);
    await q;
  } catch {
    // Tabla aún sin migrar: no hay nada que invalidar.
  }
}
