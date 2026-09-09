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
import {
  esErrorObjetoLegacy,
  mensajeErrorDatos,
  resultadoErrorLecturaCache,
  type ResultadoLecturaDatos,
} from "./errores-datos";

export interface GuardadoApp<T> {
  datos: T;
  generadoEn: string;
  vigente: boolean;
}

export type ResultadoLecturaCache<T> = ResultadoLecturaDatos<T>;

export type TipoFalloCacheApp = "permisos" | "red" | "timeout" | "desconocido";

/**
 * El renglón guardado TAL CUAL esté: vigente o invalidado, fresco o viejo.
 * Para los lectores que sirven lo guardado y refrescan por atrás (cortes).
 */
export async function leerCacheAppGuardado<T>(
  db: DB,
  accountId: string,
  clave: string,
): Promise<ResultadoLecturaCache<GuardadoApp<T>>> {
  try {
    const { data, error } = await db
      .from("app_cache")
      .select("datos, vigente, generado_en")
      .eq("account_id", accountId)
      .eq("clave", clave)
      .maybeSingle();
    if (error) return resultadoErrorLecturaCache("app_cache", clave, error);
    if (!data?.datos) return { estado: "ausente" };
    return {
      estado: "encontrado",
      valor: {
        datos: revivirTipos(data.datos) as T,
        generadoEn: data.generado_en,
        vigente: data.vigente !== false,
      },
    };
  } catch (error) {
    return resultadoErrorLecturaCache("app_cache", clave, error);
  }
}

export async function leerCacheApp<T>(
  db: DB,
  accountId: string,
  clave: string,
  edadMaxMs?: number,
): Promise<ResultadoLecturaCache<T>> {
  try {
    const { data, error } = await db
      .from("app_cache")
      .select("datos, vigente, generado_en")
      .eq("account_id", accountId)
      .eq("clave", clave)
      .maybeSingle();
    if (error) return resultadoErrorLecturaCache("app_cache", clave, error);
    if (!data?.datos || data.vigente === false) return { estado: "ausente" };
    if (edadMaxMs != null && Date.now() - Date.parse(data.generado_en) > edadMaxMs) {
      return { estado: "ausente" };
    }
    return { estado: "encontrado", valor: revivirTipos(data.datos) as T };
  } catch (error) {
    return resultadoErrorLecturaCache("app_cache", clave, error);
  }
}

export async function guardarCacheApp(
  db: DB,
  accountId: string,
  clave: string,
  datos: unknown,
  msCalculo: number,
): Promise<void> {
  try {
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
    if (error) {
      const fallo = falloOperacion("guardar", clave, error);
      if (fallo) throw fallo;
    }
  } catch (error) {
    if (error instanceof ErrorOperacionCacheApp) throw error;
    const fallo = falloOperacion("guardar", clave, error);
    if (fallo) throw fallo;
  }
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
  if (guardado.estado === "encontrado") return guardado.valor;
  if (guardado.estado === "fallo") throw guardado.error;

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
    const { error } = await q;
    if (error) {
      const clave = filtro?.claves?.join(",") ?? `${filtro?.prefijo ?? "*"}*`;
      const fallo = falloOperacion("invalidar", clave, error);
      if (fallo) throw fallo;
    }
  } catch (error) {
    if (error instanceof ErrorOperacionCacheApp) throw error;
    const clave = filtro?.claves?.join(",") ?? `${filtro?.prefijo ?? "*"}*`;
    const fallo = falloOperacion("invalidar", clave, error);
    if (fallo) throw fallo;
  }
}

export class ErrorOperacionCacheApp extends Error {
  readonly name = "ErrorOperacionCacheApp";

  constructor(
    readonly operacion: OperacionCacheApp,
    readonly tipo: TipoFalloCacheApp,
    readonly clave: string,
    detalle: string,
  ) {
    super(`No se pudo ${operacion} app_cache (${clave}) [${tipo}]: ${detalle}`);
  }
}

function codigoError(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return String((error as { code?: unknown }).code ?? "").toUpperCase();
}

export type OperacionCacheApp = "guardar" | "invalidar";

function tipoFalloCache(error: unknown): TipoFalloCacheApp {
  const codigo = codigoError(error);
  const mensaje = mensajeErrorDatos(error).toLowerCase();
  if (codigo === "42501" || /permission denied|not authorized|unauthorized|forbidden/.test(mensaje)) {
    return "permisos";
  }
  if (codigo === "57014" || /timeout|timed out|canceling statement/.test(mensaje)) {
    return "timeout";
  }
  if (
    /fetch failed|failed to fetch|network|socket|econn|enotfound|connection|dns/.test(mensaje)
  ) {
    return "red";
  }
  return "desconocido";
}

function falloOperacion(
  operacion: OperacionCacheApp,
  clave: string,
  error: unknown,
): ErrorOperacionCacheApp | null {
  if (esErrorObjetoLegacy(error, ["app_cache"])) return null;
  const fallo = new ErrorOperacionCacheApp(
    operacion,
    tipoFalloCache(error),
    clave,
    mensajeErrorDatos(error),
  );
  console.error(fallo.message);
  return fallo;
}
