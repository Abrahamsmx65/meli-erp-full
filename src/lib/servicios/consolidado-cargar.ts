/**
 * Carga del corte general: el corte de calzado, el de fundas y el bloque de
 * Amazon del mismo mes, y el consolidado. Cada canal que falle o no exista
 * se declara en los avisos en vez de tumbar la pantalla.
 */
import { cuentaActiva, type Cuenta, type DB } from "../datos/repos";
import { cuentaActiva as cuentaYz } from "../yapanizcel/cuenta";
import { cargarEstadoResultadosYz } from "../yapanizcel/corte";
import { obtenerMonitorAmazon } from "./amazon-monitor";
import { cuentaAmazon } from "./amazon";
import { armarConsolidado, bloqueDesdeEstado, type BloqueCanal, type Consolidado } from "./consolidado";
import { bloqueAmazon } from "./consolidado-amazon";
import { corteNecesitaRefresco, obtenerEstadoResultadosMeli, obtenerEstadoResultadosYz } from "./corte-cache";
import { cargarEstadoResultados, rangoDelPeriodo } from "./corte-meli";
import { mapaCostosUnificado } from "./costos-unificados";
import { marcarTipos, revivirTipos } from "./plan-fba-cache";

/**
 * `cortesMasticados: true` (la pantalla) lee los cortes de calzado y fundas
 * de su caché por periodo en vez de recalcularlos: el consolidado de un mes
 * pasaba de ~42 s a lo que cueste el bloque de Amazon. «Hacer corte» los
 * calcula frescos, porque congela.
 */
export async function cargarConsolidado(db: DB, cuenta: Cuenta, periodo: string, opts?: { cortesMasticados?: boolean }): Promise<Consolidado> {
  const { desde, hasta } = rangoDelPeriodo(periodo);
  const avisos: string[] = [];
  const bloques: BloqueCanal[] = [];
  const masticados = opts?.cortesMasticados === true;

  const [calzado, fundas, amazon] = await Promise.all([
    (masticados ? obtenerEstadoResultadosMeli(db, cuenta, periodo) : cargarEstadoResultados(db, cuenta, periodo)).then(
      (e) => bloqueDesdeEstado("meli_calzado", e),
      (err) => {
        avisos.push(`Calzado · Mercado Libre no se pudo cargar: ${(err as Error).message}`);
        return null;
      },
    ),
    (async () => {
      const yz = await cuentaYz(db);
      if (!yz) return null;
      try {
        const e = masticados ? await obtenerEstadoResultadosYz(db, yz, periodo) : await cargarEstadoResultadosYz(db, yz, periodo);
        return bloqueDesdeEstado("meli_fundas", e);
      } catch (err) {
        avisos.push(`Fundas · Mercado Libre no se pudo cargar: ${(err as Error).message}`);
        return null;
      }
    })(),
    (async () => {
      const amz = await cuentaAmazon(db);
      if (!amz) return null;
      try {
        const [monitor, config] = await Promise.all([obtenerMonitorAmazon(db, amz.id, cuenta.id, { desde, hasta }), mapaCostosUnificado(db, { meliAccountId: cuenta.id })]);
        return bloqueAmazon(monitor, config, { desde, hasta });
      } catch (err) {
        avisos.push(`Amazon no se pudo cargar: ${(err as Error).message}`);
        return null;
      }
    })(),
  ]);
  for (const b of [calzado, fundas, amazon]) if (b) bloques.push(b);

  return armarConsolidado({ periodo, desde, hasta, bloques, avisos });
}

async function recalcularConsolidado(db: DB, cuenta: Cuenta, periodo: string): Promise<Consolidado> {
  const t0 = Date.now();
  const consolidado = await cargarConsolidado(db, cuenta, periodo, { cortesMasticados: true });
  try {
    await db.from("consolidado_cache").upsert(
      {
        account_id: cuenta.id,
        periodo,
        generado_en: new Date().toISOString(),
        ms_calculo: Date.now() - t0,
        datos: marcarTipos(consolidado),
      },
      { onConflict: "account_id,periodo" },
    );
  } catch {
    // Sin guardar, el consolidado sirve igual.
  }
  return consolidado;
}

/**
 * El corte general desde `consolidado_cache`: correr los TRES canales
 * completos (calzado + fundas + Amazon) en cada visita costaba hasta 300 s
 * de función por clic. La pantalla SIEMPRE sirve el renglón guardado del
 * periodo y el refresco corre por atrás con la misma política que los
 * cortes por canal: mes corriente cada 10 minutos, mes cerrado casi
 * congelado (agosto medía 42 s de cálculo y se tiraba cada 10 minutos).
 * "Hacer corte" sigue congelando el mes en `cortes_generales` como siempre.
 */
export async function obtenerConsolidado(db: DB, cuenta: Cuenta, periodo: string): Promise<Consolidado> {
  try {
    const { data } = await db
      .from("consolidado_cache")
      .select("datos, generado_en")
      .eq("account_id", cuenta.id)
      .eq("periodo", periodo)
      .maybeSingle();
    if (data?.datos) {
      if (corteNecesitaRefresco(periodo, data.generado_en, true)) {
        try {
          const { after } = await import("next/server");
          after(async () => {
            try {
              await recalcularConsolidado(db, cuenta, periodo);
            } catch (err) {
              console.error(`consolidado ${periodo}: refresco de fondo:`, (err as Error).message);
            }
          });
        } catch {
          // Fuera de un request: el guardado sirve igual.
        }
      }
      return revivirTipos(data.datos) as Consolidado;
    }
  } catch {
    // Tabla aún sin migrar: se calcula como siempre.
  }

  return recalcularConsolidado(db, cuenta, periodo);
}

export interface CorteGeneralGuardado {
  id: number;
  periodo: string;
  creadoEn: string;
  ventaBruta: number;
  utilidadNeta: number;
  exacto: boolean;
}

export async function hacerCorteGeneral(db: DB, cuenta: Cuenta, periodo: string, creadoPor: string | null): Promise<{ id: number; consolidado: Consolidado }> {
  const consolidado = await cargarConsolidado(db, cuenta, periodo);
  // El recién calculado también refresca el caché de la página, para que el
  // corte se vea al instante y no hasta que caduque la ventana de 10 min.
  try {
    await db.from("consolidado_cache").upsert(
      { account_id: cuenta.id, periodo, generado_en: new Date().toISOString(), ms_calculo: null, datos: marcarTipos(consolidado) },
      { onConflict: "account_id,periodo" },
    );
  } catch {
    // Sin caché, el corte guardado sigue siendo la verdad.
  }
  const { data, error } = await db
    .from("cortes_generales")
    .upsert(
      { account_id: cuenta.id, periodo, desde: consolidado.desde, hasta: consolidado.hasta, resumen: consolidado, creado_en: new Date().toISOString(), creado_por: creadoPor },
      { onConflict: "account_id,periodo" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error(`No se pudo guardar el corte general: ${error?.message ?? "sin id"}`);
  return { id: Number(data.id), consolidado };
}

export async function listarCortesGenerales(db: DB, accountId: string): Promise<CorteGeneralGuardado[]> {
  // Solo los tres números que la lista enseña, sacados DENTRO de la base:
  // bajar el jsonb completo de 36 cortes eran varios megas por render.
  const { data } = await db
    .from("cortes_generales")
    .select("id, periodo, creado_en, venta:resumen->total->ventaBruta, utilidad:resumen->total->utilidadNeta, exacto:resumen->exacto")
    .eq("account_id", accountId)
    .order("periodo", { ascending: false })
    .limit(36);
  return (data ?? []).map((c: any) => ({
    id: Number(c.id),
    periodo: c.periodo,
    creadoEn: c.creado_en,
    ventaBruta: Number(c.venta) || 0,
    utilidadNeta: Number(c.utilidad) || 0,
    exacto: Boolean(c.exacto),
  }));
}

export async function cargarCorteGeneral(db: DB, accountId: string, id: number): Promise<Consolidado | null> {
  const { data } = await db.from("cortes_generales").select("resumen").eq("account_id", accountId).eq("id", id).maybeSingle();
  return (data?.resumen as Consolidado) ?? null;
}

export { cuentaActiva };
