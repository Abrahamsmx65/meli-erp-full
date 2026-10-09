/**
 * Sugerencia de compra a China MASTICADA para Planificación China (/pedidos).
 *
 * Antes la página bajaba en cada visita el plan completo (~1.9 MB), el
 * inventario con sus crudos (~1.7 MB) y las sumas de Amazon y TikTok, y
 * solo DESPUÉS miraba si la sugerencia ya estaba guardada; si tenía más de
 * media hora la recalculaba en el clic, y si Amazon o TikTok traían avisos ni
 * siquiera la guardaba. Ahora la pantalla lee UN renglón (`app_cache`
 * `compras-china:v3`) y los insumos solo se bajan cuando hay que calcular:
 * por atrás (`servirConCacheApp`) o en el latido (`refrescarCompraChinaSiHaceFalta`).
 *
 * La receta es la MISMA de siempre (`sugerirCompra` con plan, inventario,
 * Amazon y TikTok): aquí solo cambia dónde y cuándo se calcula. Los avisos de
 * Amazon y TikTok viajan guardados con el resultado para que la pantalla los
 * siga diciendo.
 */
import type { DB } from "../datos/repos";
import { obtenerPlan } from "./cache";
import { servirConCacheApp, guardarCacheApp } from "./cache-app";
import { cargarInventario } from "./inventario";
import { sugerirCompra, type SugerenciaCompra } from "./compras";
import { amazonParaCompras } from "./fba";
import { tiktokParaCompras } from "./tiktok-compras";

/** La clave cambia con la receta o la forma: lo guardado con otra no sirve. */
export const CLAVE_COMPRA_CHINA = "compras-china:v3";
/** Media hora: cubre los insumos que cambian sin aviso (sumas de Amazon). */
export const EDAD_COMPRA_CHINA_MS = 30 * 60_000;
/** Con avisos de Amazon o TikTok se reintenta más seguido. */
export const EDAD_COMPRA_CHINA_CON_AVISOS_MS = 5 * 60_000;

export interface CompraChinaGuardada {
  /** `detalleSkus` va vacío: la pantalla no lo usa (el Excel calcula el suyo). */
  compra: SugerenciaCompra;
  amazon: { advertencias: string[]; disponible: boolean };
  tiktok: { advertencias: string[]; disponible: boolean };
}

/** Calcula la sugerencia con los insumos guardados. Trabajo pesado: fondo. */
export async function calcularCompraChina(db: DB, accountId: string): Promise<CompraChinaGuardada> {
  const [planEstado, inventario, amazonEstado, tiktokEstado] = await Promise.all([
    obtenerPlan(db, accountId),
    cargarInventario(db, accountId),
    amazonParaCompras(db).catch((err) => ({
      datos: new Map(),
      advertencias: [`No se pudieron leer ventas e inventario de Amazon: ${(err as Error).message}`],
      disponible: false,
    })),
    tiktokParaCompras(db, accountId),
  ]);

  const inventarioPorSku = new Map(
    inventario.renglones.map((r) => [
      r.sku,
      {
        enFull: r.enFull,
        enTransferencia: r.enTransferencia,
        enBodega: r.enBodega,
        enCamino: r.enCamino,
      },
    ]),
  );

  const compra = await sugerirCompra(
    db,
    accountId,
    planEstado.plan.lineas,
    inventarioPorSku,
    undefined,
    inventario.crudos,
    amazonEstado.datos,
    tiktokEstado.datos,
  );

  return {
    compra: { ...compra, detalleSkus: [] },
    amazon: { advertencias: amazonEstado.advertencias, disponible: amazonEstado.disponible },
    tiktok: { advertencias: tiktokEstado.advertencias, disponible: tiktokEstado.disponible },
  };
}

export function tieneAvisos(g: Pick<CompraChinaGuardada, "amazon" | "tiktok">): boolean {
  return (
    g.amazon.advertencias.length > 0 ||
    !g.amazon.disponible ||
    g.tiktok.advertencias.length > 0 ||
    !g.tiktok.disponible
  );
}

/** Para la pantalla: lo guardado aunque esté viejo; refresca por atrás. */
export function servirCompraChina(db: DB, accountId: string) {
  return servirConCacheApp(db, accountId, CLAVE_COMPRA_CHINA, EDAD_COMPRA_CHINA_MS, () =>
    calcularCompraChina(db, accountId),
  );
}

/**
 * Decide si el renglón guardado hay que rehacerlo (puro, para el latido):
 * sin renglón, invalidado, más viejo que su vida, o con avisos y más viejo
 * que la vida corta.
 */
export function compraChinaNecesitaRefresco(
  guardado: { generadoEn: string; vigente: boolean; conAvisos: boolean } | null,
  ahora = Date.now(),
): boolean {
  if (!guardado) return true;
  if (!guardado.vigente) return true;
  const edad = ahora - Date.parse(guardado.generadoEn);
  if (!Number.isFinite(edad)) return true;
  if (edad > EDAD_COMPRA_CHINA_MS) return true;
  return guardado.conAvisos && edad > EDAD_COMPRA_CHINA_CON_AVISOS_MS;
}

/** Latido: deja la sugerencia lista para que la pantalla nunca calcule. */
export async function refrescarCompraChinaSiHaceFalta(db: DB, accountId: string): Promise<boolean> {
  // Solo la fecha y los avisos: el renglón completo pesa y aquí no hace falta.
  const { data, error } = await db
    .from("app_cache")
    .select("generado_en, vigente, amazon:datos->amazon, tiktok:datos->tiktok")
    .eq("account_id", accountId)
    .eq("clave", CLAVE_COMPRA_CHINA)
    .maybeSingle();
  if (error) throw new Error(`app_cache ${CLAVE_COMPRA_CHINA}: ${error.message}`);
  const fila = data as {
    generado_en: string;
    vigente: boolean | null;
    amazon: CompraChinaGuardada["amazon"] | null;
    tiktok: CompraChinaGuardada["tiktok"] | null;
  } | null;
  const estado = fila?.generado_en
    ? {
        generadoEn: fila.generado_en,
        vigente: fila.vigente !== false,
        conAvisos:
          !fila.amazon || !fila.tiktok
            ? true
            : tieneAvisos({ amazon: fila.amazon, tiktok: fila.tiktok }),
      }
    : null;
  if (!compraChinaNecesitaRefresco(estado)) return false;
  const t0 = Date.now();
  const datos = await calcularCompraChina(db, accountId);
  await guardarCacheApp(db, accountId, CLAVE_COMPRA_CHINA, datos, Date.now() - t0);
  return true;
}
