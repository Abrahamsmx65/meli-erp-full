/**
 * Caché del plan de FBA, con el mismo espíritu que `plan_cache` (el de Full).
 *
 * Hasta ahora /amazon recalculaba TODO en cada visita: dos agregaciones en
 * Postgres, el catálogo de cajas de bodega y el optimizador de cajas — 3 a 5
 * segundos por clic, tapados con un caché de 60 s en memoria que en Vercel
 * ni siquiera se comparte entre instancias. Aquí el resultado se guarda
 * masticado en `plan_fba_cache` y se invalida cuando cambian sus insumos:
 * las sincronizaciones de Amazon (latido-amazon) y todo lo que ya invalida
 * al plan de Full (bodega, corridas, amarres, envíos — `invalidar()` en
 * cache.ts marca los dos).
 *
 * El resultado trae Maps adentro (en camino por SKU, sobrantes por caja),
 * que JSON no sabe guardar: se aplanan con una marca de tipo y se rehidratan
 * al leer, sin tocar la forma que las pantallas ya consumen.
 */
import type { DB } from "../datos/repos";
import { traerTodo } from "../datos/repos";
import { VERSION_MOTOR } from "./cache";
import { cargarAmazon, PERIODO_OMISION, SIN_LIMITE, type TotalesAmazon } from "./amazon";
import { mapaCorridas, sugerirEnvioFba, type SugerenciaFba } from "./fba";
import { aplicarEnCamino, enCaminoFba, type EnCaminoFba } from "./fba-en-camino";
import { planFbaConCajas, type PlanFbaCajas } from "./fba-plan";
import { catalogoBodega } from "./inventario";
import { separarEnvios, type PlanDeEnvios } from "./envios";
import { desglosarOpcionales, type DesgloseOpcionales } from "../reporte/opcionales";
import { normalizarParametros } from "../engine/params";
import { indexarCatalogo } from "../etiquetas/resolver";

/** Lo que la pantalla de /amazon necesita, ya calculado. */
export interface DatosPlanFba {
  totales: TotalesAmazon;
  enCamino: EnCaminoFba | null;
  sugerencias: SugerenciaFba[];
  planFba: PlanFbaCajas;
  desglose: DesgloseOpcionales;
  enviosFba: PlanDeEnvios;
}

// ---------------------------------------------------------------------------
// Aplanar / rehidratar (Map, Set y Date no sobreviven un viaje por JSON)
// ---------------------------------------------------------------------------

export function marcarTipos(valor: unknown): unknown {
  if (valor instanceof Map) {
    return { __tipo: "map", v: [...valor.entries()].map(([k, x]) => [k, marcarTipos(x)]) };
  }
  if (valor instanceof Set) {
    return { __tipo: "set", v: [...valor.values()].map(marcarTipos) };
  }
  if (valor instanceof Date) return { __tipo: "fecha", v: valor.toISOString() };
  if (typeof valor === "number" && !Number.isFinite(valor)) {
    return { __tipo: "num", v: String(valor) };
  }
  if (Array.isArray(valor)) return valor.map((x) => marcarTipos(x === undefined ? null : x));
  if (valor && typeof valor === "object") {
    const salida: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(valor)) {
      if (x !== undefined) salida[k] = marcarTipos(x);
    }
    return salida;
  }
  return valor === undefined ? null : valor;
}

export function revivirTipos(valor: any): any {
  if (Array.isArray(valor)) return valor.map(revivirTipos);
  if (valor && typeof valor === "object") {
    if (valor.__tipo === "map" && Array.isArray(valor.v)) {
      return new Map(valor.v.map(([k, x]: [unknown, unknown]) => [k, revivirTipos(x)]));
    }
    if (valor.__tipo === "set" && Array.isArray(valor.v)) {
      return new Set(valor.v.map(revivirTipos));
    }
    if (valor.__tipo === "fecha" && typeof valor.v === "string") return new Date(valor.v);
    if (valor.__tipo === "num" && typeof valor.v === "string") return Number(valor.v);
    const salida: any = {};
    for (const [k, x] of Object.entries(valor)) salida[k] = revivirTipos(x);
    return salida;
  }
  return valor;
}

// ---------------------------------------------------------------------------
// Cálculo completo (lo que antes vivía dentro de la página)
// ---------------------------------------------------------------------------

/**
 * Todo el trabajo caro de /amazon: agregaciones, catálogo de bodega,
 * optimizador de cajas y separación por bodega. Es el mismo cálculo que
 * hacía la página; solo cambió de casa para poderse guardar.
 */
export async function calcularPlanFba(
  db: DB,
  cuentaAmazonId: string,
  cuentaMeliId: string | null,
  dias: number,
): Promise<DatosPlanFba> {
  const [{ renglones: renglonesCrudos, totales }, corridasRaw, skusMeli, bodega, paramsBd, enCamino] =
    await Promise.all([
      // SIN límite: con el top-500, el 64% del calzado con venta quedaba
      // invisible para el plan (esta página no pinta renglones crudos).
      cargarAmazon(db, dias, "", SIN_LIMITE),
      cuentaMeliId
        ? traerTodo<any>(db, "corridas", "modelo, color, tallas, total, pedido", (q) =>
            q.eq("account_id", cuentaMeliId),
          )
        : Promise.resolve([]),
      // El catálogo de MELI amarra los SKUs de Amazon (escritos en otro
      // orden) a su modelo+color real. SOLO activos: tras un renombre en
      // MELI, el nombre viejo (apagado) ganaba el amarre exacto y la
      // necesidad quedaba con una llave que ninguna caja usa — el SKU salía
      // "sin caja en bodega" con la bodega llena.
      cuentaMeliId
        ? traerTodo<any>(db, "skus", "sku, modelo, color, talla", (q) =>
            q.eq("account_id", cuentaMeliId).eq("activo", true),
          )
        : Promise.resolve([]),
      cuentaMeliId ? catalogoBodega(db, cuentaMeliId) : Promise.resolve(null),
      cuentaMeliId
        ? db.from("parametros").select("datos").eq("account_id", cuentaMeliId).maybeSingle()
        : Promise.resolve({ data: null } as any),
      enCaminoFba(db, cuentaAmazonId),
    ]);

  // El "en camino" del reporte se cambia por el REAL: solo lo pendiente de
  // envíos con movimiento reciente. Lo atorado hace semanas deja de tapar
  // faltantes (GT114-LT BROWN-26: 30 pares fantasma escondían 70 cajas).
  const renglones = aplicarEnCamino(renglonesCrudos, enCamino);

  const indiceMeli = indexarCatalogo(skusMeli);
  const sugerencias = sugerirEnvioFba(renglones, dias, mapaCorridas(corridasRaw), undefined, indiceMeli);

  // El plan de cajas REALES: mismo motor y mismos pesos que envíos a Full.
  const planFba = planFbaConCajas({
    renglones,
    dias,
    catalogo: bodega?.catalogo.cajas ?? [],
    indiceMeli,
    parametros: normalizarParametros((paramsBd?.data?.datos as Record<string, unknown>) ?? {}),
  });
  const desglose = desglosarOpcionales(
    planFba.cajas.map((c) => ({
      codigo: c.codigo,
      cantidad: c.cantidad,
      paresPorCaja: c.paresPorCaja,
      cantidadOpcional: c.cantidadOpcional,
      aporta: c.aporta.map((a) => ({ sku: a.sku, talla: a.talla, paresPorCaja: a.paresPorCaja })),
    })),
    planFba.lineas,
  );

  // Igual que MELI: un envío sale de UNA dirección. Caseshop e Industher van
  // juntas y EnvioPack aparte, según almacenes_activos.grupo_envio.
  const enviosFba = cuentaMeliId
    ? await separarEnvios(db, cuentaMeliId, planFba.cajas)
    : { envios: [], sinConfigurar: [] };

  return { totales, enCamino, sugerencias, planFba, desglose, enviosFba };
}

// ---------------------------------------------------------------------------
// Caché en la base
// ---------------------------------------------------------------------------

interface GuardadoFba {
  versionMotor: string;
  cuentaMeliId: string | null;
  datos: unknown;
}

/**
 * Devuelve el plan de FBA: el guardado si sigue vigente y del mismo motor;
 * si no, lo recalcula y lo guarda. A diferencia del plan de Full aquí no se
 * sirve el obsoleto con aviso: el recálculo toma segundos, no minutos, y el
 * latido lo deja precalculado casi siempre (periodo por omisión).
 */
export async function obtenerPlanFba(
  db: DB,
  cuentaAmazonId: string,
  cuentaMeliId: string | null,
  dias: number,
): Promise<DatosPlanFba> {
  const { data } = await db
    .from("plan_fba_cache")
    .select("datos, vigente")
    .eq("account_id", cuentaAmazonId)
    .eq("dias", dias)
    .maybeSingle();

  const guardado = (data?.datos ?? null) as GuardadoFba | null;
  if (
    guardado &&
    (data?.vigente ?? true) &&
    guardado.versionMotor === VERSION_MOTOR &&
    (guardado.cuentaMeliId ?? null) === (cuentaMeliId ?? null)
  ) {
    return revivirTipos(guardado.datos) as DatosPlanFba;
  }

  return recalcularPlanFba(db, cuentaAmazonId, cuentaMeliId, dias);
}

export async function recalcularPlanFba(
  db: DB,
  cuentaAmazonId: string,
  cuentaMeliId: string | null,
  dias: number,
): Promise<DatosPlanFba> {
  const t0 = Date.now();
  const datos = await calcularPlanFba(db, cuentaAmazonId, cuentaMeliId, dias);
  const ms = Date.now() - t0;

  const guardado: GuardadoFba = {
    versionMotor: VERSION_MOTOR,
    cuentaMeliId: cuentaMeliId ?? null,
    datos: marcarTipos(datos),
  };
  const { error } = await db.from("plan_fba_cache").upsert(
    {
      account_id: cuentaAmazonId,
      dias,
      meli_account_id: cuentaMeliId,
      generado_en: new Date().toISOString(),
      vigente: true,
      motivo: null,
      ms_calculo: ms,
      datos: guardado,
    },
    { onConflict: "account_id,dias" },
  );
  // Si no se pudo guardar (p. ej. la tabla aún no existe), el plan sirve
  // igual: solo se pierde el ahorro.
  if (error) console.error("No se pudo guardar el plan de FBA en caché:", error.message);

  return datos;
}

/** Marca como obsoletos los planes de FBA de una cuenta de Amazon. */
export async function invalidarPlanFba(db: DB, cuentaAmazonId: string, motivo: string): Promise<void> {
  await db
    .from("plan_fba_cache")
    .update({ vigente: false, motivo })
    .eq("account_id", cuentaAmazonId);
}

/**
 * Deja precalculado el plan del periodo por omisión si quedó obsoleto, para
 * que la visita a /amazon lea un renglón en vez de pagar el cálculo. Los
 * otros periodos se recalculan al pedirse.
 */
export async function precalcularPlanFba(
  admin: DB,
  cuentaAmazonId: string,
  cuentaMeliId: string | null,
): Promise<boolean> {
  const { data } = await admin
    .from("plan_fba_cache")
    .select("vigente, datos")
    .eq("account_id", cuentaAmazonId)
    .eq("dias", PERIODO_OMISION)
    .maybeSingle();
  const guardado = (data?.datos ?? null) as GuardadoFba | null;
  const alDia =
    guardado != null &&
    (data?.vigente ?? true) &&
    guardado.versionMotor === VERSION_MOTOR &&
    (guardado.cuentaMeliId ?? null) === (cuentaMeliId ?? null);
  if (alDia) return false;

  await recalcularPlanFba(admin, cuentaAmazonId, cuentaMeliId, PERIODO_OMISION);
  return true;
}
