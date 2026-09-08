/**
 * Caché del plan.
 *
 * Calcular el plan cuesta segundos: decenas de miles de renglones de ventas y
 * movimientos, 90 días de stock reconstruidos por SKU, y el optimizador de
 * cajas encima. Pero los insumos solo cambian cuando sincronizas, importas
 * archivos o tocas un amarre — no cada vez que abres la pantalla.
 *
 * Así que se calcula una vez, se guarda masticado, y la pantalla lee un
 * renglón. Cuando algo lo invalida, se marca y se vuelve a calcular.
 */
import type { EstadoSku, Parametros, ResumenPlan } from "../engine/types";
import { generarPlanCompleto, type PlanCompleto } from "./plan";
import { desglosarSku } from "./sync";
import type { DB } from "../datos/repos";
import type { FilaSinCorrida, SkuSinAmarre } from "../importar/cajas";

/** Un SKU del plan, ya aplanado y listo para pantalla y para Excel. */
export interface LineaGuardada {
  sku: string;
  modelo: string;
  color: string;
  talla: string;
  estado: EstadoSku;
  demandaDiaria: number;
  tasaObservada: number;
  factorCorreccion: number;
  diasSinStock: number;
  unidadesTotales: number;
  /**
   * Unidades REALMENTE vendidas en los últimos 30 días (bucket más reciente
   * del motor). Opcional porque los planes cacheados viejos no lo traen; el
   * que lo lea debe caer a `tasaObservada × 30` cuando falte.
   */
  unidades30?: number;
  disponible: number;
  enTransferencia: number;
  posicion: number;
  /** null = sin venta medible; JSON no sabe representar infinito */
  coberturaDias: number | null;
  fechaQuiebre: string | null;
  stockSeguridad: number;
  puntoReorden: number;
  nivelObjetivo: number;
  sugerido: number;
  enviado: number;
  confianza: string;
  explicacion: string;
}

export interface CajaGuardada {
  codigo: string;
  skuCaja: string;
  pedido: string;
  modelo: string;
  color: string;
  almacen: string;
  esCorrida: boolean;
  talla: string;
  cantidad: number;
  cajasDisponibles: number;
  paresPorCaja: number;
  paresTotales: number;
  contenedores: string[];
  /** cuántas de estas cajas van como OPCIONALES (rescate de talla faltante) */
  cantidadOpcional?: number;
  aporta: { sku: string; talla: string; paresPorCaja: number; paresTotales: number }[];
}

/**
 * Versión del MOTOR de cálculo. Se sube a mano cuando cambia la matemática
 * del plan (demanda, cajas, reabasto): un plan cacheado con versión vieja
 * se marca no vigente y el latido lo recalcula solo. Sin esto, un deploy
 * que corrige el motor seguía sirviendo números del motor anterior.
 */
export const VERSION_MOTOR = "2026-09-07.1";

export interface PlanGuardado {
  versionMotor?: string;
  generadoEn: string;
  parametros: Parametros;
  resumen: ResumenPlan;
  catalogo: PlanCompleto["catalogo"];
  avisos: string[];
  pendientes: { sinCorrida: FilaSinCorrida[]; sinAmarre: SkuSinAmarre[] };
  lineas: LineaGuardada[];
  cajas: CajaGuardada[];
}

export interface PlanConEstado {
  plan: PlanGuardado;
  /** false = los insumos cambiaron después de calcularlo */
  vigente: boolean;
  motivo: string | null;
  msCalculo: number | null;
  /** true si se acabó de calcular en esta petición */
  recienCalculado: boolean;
}

/** Aplana el plan a algo que sobrevive un viaje por JSON. */
export function aplanar(completo: PlanCompleto): PlanGuardado {
  const { plan, cajasPlaneadas, pendientes, catalogo } = completo;

  return {
    generadoEn: new Date().toISOString(),
    parametros: plan.parametros,
    resumen: plan.resumen,
    catalogo,
    avisos: completo.avisos,
    pendientes,
    lineas: plan.lineas.map((l) => {
      const d = desglosarSku(l.sku);
      return {
        sku: l.sku,
        modelo: d.modelo ?? "",
        color: d.color ?? "",
        talla: d.talla ?? "",
        estado: l.estado,
        demandaDiaria: Number(l.demanda.demandaDiaria.toFixed(3)),
        tasaObservada: Number(l.demanda.tasaObservada.toFixed(3)),
        factorCorreccion: Number(l.demanda.factorCorreccion.toFixed(3)),
        diasSinStock: l.demanda.diasSinStock,
        unidadesTotales: l.demanda.unidadesTotales,
        // El bucket 0 siempre es el más reciente ("Últimos 30 días").
        unidades30: l.demanda.buckets[0]?.unidades ?? 0,
        disponible: l.disponible,
        enTransferencia: l.enTransferencia,
        posicion: l.posicion,
        coberturaDias: Number.isFinite(l.coberturaDias)
          ? Number(l.coberturaDias.toFixed(1))
          : null,
        fechaQuiebre: l.fechaQuiebre,
        stockSeguridad: l.stockSeguridad,
        puntoReorden: l.puntoReorden,
        nivelObjetivo: l.nivelObjetivo,
        sugerido: l.sugerido,
        enviado: plan.cajas.enviadoPorSku.get(l.sku) ?? 0,
        confianza: l.demanda.confianza,
        explicacion: l.explicacion,
      };
    }),
    cajas: cajasPlaneadas.map((c) => ({
      codigo: c.codigo,
      skuCaja: c.skuCaja,
      pedido: c.pedido,
      modelo: c.modelo,
      color: c.color,
      almacen: c.almacen,
      esCorrida: c.esCorrida,
      talla: c.talla,
      cantidad: c.cantidad,
      cajasDisponibles: c.cajasDisponibles,
      paresPorCaja: c.paresPorCaja,
      paresTotales: c.paresTotales,
      contenedores: c.contenedores,
      cantidadOpcional: c.cantidadOpcional,
      aporta: c.aporta,
    })),
  };
}

/**
 * Devuelve el plan. Si hay uno guardado y sigue vigente, lo usa tal cual.
 *
 * Cuando el guardado quedó obsoleto se devuelve de todos modos —marcado como
 * no vigente— en vez de hacer esperar. Es mejor ver el plan de hace un rato
 * con un aviso que quedarse viendo una pantalla en blanco 8 segundos; el
 * botón de recalcular está a un clic.
 */

/**
 * Lee SOLO unas claves del plan guardado (datos->resumen, datos->pendientes…)
 * sin bajar el JSON completo, que pesa varios megas. Para las pantallas que
 * usan dos números del plan, bajarlo entero era el costo más alto del clic.
 * Devuelve null si no hay plan guardado: el llamador cae a obtenerPlan().
 */
export async function leerPlanParcial(
  db: DB,
  accountId: string,
  claves: string[],
): Promise<Record<string, any> | null> {
  const sel = claves.map((k) => `${k}:datos->${k}`).join(", ");
  const { data, error } = await db
    .from("plan_cache")
    .select(sel)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Record<string, any>;
}

export async function obtenerPlan(
  db: DB,
  accountId: string,
  opts?: { forzar?: boolean },
): Promise<PlanConEstado> {
  if (!opts?.forzar) {
    const { data } = await db
      .from("plan_cache")
      .select("datos, vigente, motivo, ms_calculo")
      .eq("account_id", accountId)
      .maybeSingle();

    if (data?.datos) {
      const plan = data.datos as PlanGuardado;
      const motorViejo = plan.versionMotor !== VERSION_MOTOR;
      if (motorViejo && (data.vigente ?? true)) {
        // Se persiste para que el latido lo recalcule solo (mira la columna).
        await db
          .from("plan_cache")
          .update({ vigente: false, motivo: "El motor de cálculo se actualizó." })
          .eq("account_id", accountId);
      }
      return {
        plan,
        vigente: motorViejo ? false : data.vigente ?? true,
        motivo: motorViejo ? "El motor de cálculo se actualizó." : data.motivo ?? null,
        msCalculo: data.ms_calculo ?? null,
        recienCalculado: false,
      };
    }
  }

  return recalcular(db, accountId);
}

export async function recalcular(db: DB, accountId: string): Promise<PlanConEstado> {
  const t0 = Date.now();
  const completo = await generarPlanCompleto(db, accountId);
  const plan = aplanar(completo);
  plan.versionMotor = VERSION_MOTOR;
  const ms = Date.now() - t0;

  const { error } = await db.from("plan_cache").upsert(
    {
      account_id: accountId,
      generado_en: plan.generadoEn,
      vigente: true,
      motivo: null,
      ms_calculo: ms,
      datos: plan,
    },
    { onConflict: "account_id" },
  );
  // Si no se pudo guardar, el plan sirve igual: solo se pierde el ahorro.
  if (error) console.error("No se pudo guardar el plan en caché:", error.message);

  return { plan, vigente: true, motivo: null, msCalculo: ms, recienCalculado: true };
}

/**
 * Marca el plan guardado como obsoleto.
 *
 * No lo borra a propósito: seguir mostrando el último cálculo con un aviso
 * es más útil que dejar la pantalla vacía mientras se rehace.
 */
export async function invalidar(
  db: DB,
  accountId: string,
  motivo: string,
): Promise<void> {
  await db
    .from("plan_cache")
    .update({ vigente: false, motivo })
    .eq("account_id", accountId);
  // El plan de FBA come de la misma bodega (cajas, corridas, amarres,
  // envíos): todo lo que invalida al plan de Full lo invalida a él también.
  // La escritura va directo aquí para no importar el módulo de FBA (ciclo).
  await db
    .from("plan_fba_cache")
    .update({ vigente: false, motivo })
    .eq("meli_account_id", accountId);
}
