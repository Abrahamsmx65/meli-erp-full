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
import { aplicarGastosEmpresariales, armarConsolidado, bloqueDesdeEstado, type BloqueCanal, type Consolidado } from "./consolidado";
import { bloqueAmazon } from "./consolidado-amazon";
import { corteNecesitaRefresco, obtenerEstadoResultadosMeli, obtenerEstadoResultadosYz } from "./corte-cache";
import { cargarEstadoResultados, rangoDelPeriodo } from "./corte-meli";
import { mapaCostosUnificado } from "./costos-unificados";
import { marcarTipos, revivirTipos } from "./plan-fba-cache";
import { listarGastosEmpresariales } from "./gastos-empresariales";

/** Abre cortes históricos sin inventar el desglose que todavía no se guardaba. */
export function compatibilidadGastosEmpresariales(consolidado: Consolidado): Consolidado {
  consolidado.gastosEmpresariales ??= [];
  if (consolidado.total.utilidadAntesGastosEmpresariales == null) {
    consolidado.total.utilidadAntesGastosEmpresariales = consolidado.total.utilidadNeta;
  }
  consolidado.total.gastosEmpresariales ??= 0;
  consolidado.total.coberturaNeto ??= null;
  consolidado.total.descuentosPlataforma ??= 0;
  const totalTeniaDesglose = ["comision", "envio", "isr", "iva", "otros", "ajusteLiquidacion", "devolucionesIncluidasEnNeto"]
    .every((campo) => numeroFinito((consolidado.total as any)[campo]));
  for (const campo of ["comision", "envio", "isr", "iva", "otros", "ajusteLiquidacion", "devolucionesIncluidasEnNeto"] as const) {
    consolidado.total[campo] ??= 0;
  }
  for (const canal of consolidado.canales) {
    canal.descuentos ??= [];
    canal.descuentosPlataforma ??= 0;
    canal.fuenteNeto ??= "Fuente no registrada en este corte histórico";
    canal.coberturaNeto ??= null;
    const desglose = canal.desglosePlataforma as any;
    const teniaDesglose = Boolean(
      desglose
      && ["comision", "envio", "isr", "iva", "otros", "ajusteLiquidacion"]
        .every((campo) => numeroFinito(desglose[campo])),
    );
    canal.desgloseDisponible = teniaDesglose;
    canal.desglosePlataforma = teniaDesglose
      ? desglose
      : { comision: 0, envio: 0, isr: 0, iva: 0, otros: 0, ajusteLiquidacion: 0 };
    canal.devolucionesIncluidasEnNeto ??= 0;
  }
  consolidado.total.desgloseDisponible = totalTeniaDesglose
    && consolidado.canales.every((canal) => canal.desgloseDisponible);
  return consolidado;
}

/**
 * `cortesMasticados: true` (la pantalla) lee los cortes de calzado y fundas
 * de su caché por periodo en vez de recalcularlos: el consolidado de un mes
 * pasaba de ~42 s a lo que cueste el bloque de Amazon. «Hacer corte» los
 * calcula frescos, porque congela.
 */
export async function cargarConsolidado(
  db: DB,
  cuenta: Cuenta,
  periodo: string,
  opts?: { cortesMasticados?: boolean; alUsarCorteInvalidado?: (canal: string, motivo: string) => void },
): Promise<Consolidado> {
  const { desde, hasta } = rangoDelPeriodo(periodo);
  const avisos: string[] = [];
  const bloques: BloqueCanal[] = [];
  const masticados = opts?.cortesMasticados === true;
  // El corte general CONGELA lo que lee, así que un corte de canal
  // invalidado se recalcula en el momento en vez de servirse viejo (ver
  // `exigirVigente`). Si ni así se pudo, se avisa y el renglón del corte
  // general no se marca vigente: se vuelve a intentar en la siguiente.
  const usarInvalidado = (canal: string) => (motivo: string) => {
    avisos.push(`${canal}: se armó con el corte guardado, que está marcado para recalcular (${motivo}). El corte general se rehará solo.`);
    opts?.alUsarCorteInvalidado?.(canal, motivo);
  };

  const [calzado, fundas, amazon, gastosEmpresariales] = await Promise.all([
    (masticados
      ? obtenerEstadoResultadosMeli(db, cuenta, periodo, { exigirVigente: true, alUsarInvalidado: usarInvalidado("Calzado · Mercado Libre") })
      : cargarEstadoResultados(db, cuenta, periodo)
    ).then(
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
        const e = masticados
          ? await obtenerEstadoResultadosYz(db, yz, periodo, { exigirVigente: true, alUsarInvalidado: usarInvalidado("Fundas · Mercado Libre") })
          : await cargarEstadoResultadosYz(db, yz, periodo);
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
    listarGastosEmpresariales(db, cuenta.id, desde, hasta),
  ]);
  for (const b of [calzado, fundas, amazon]) if (b) bloques.push(b);

  return armarConsolidado({ periodo, desde, hasta, bloques, gastosEmpresariales, avisos });
}

async function recalcularConsolidado(db: DB, cuenta: Cuenta, periodo: string): Promise<Consolidado> {
  const t0 = Date.now();
  const estado: { corteInvalidado: string | null } = { corteInvalidado: null };
  const consolidado = await cargarConsolidado(db, cuenta, periodo, {
    cortesMasticados: true,
    alUsarCorteInvalidado: (canal, motivo) => {
      estado.corteInvalidado = `${canal} se armó con su corte invalidado (${motivo}).`;
    },
  });
  try {
    await db.from("consolidado_cache").upsert(
      {
        account_id: cuenta.id,
        periodo,
        generado_en: new Date().toISOString(),
        ms_calculo: Date.now() - t0,
        datos: marcarTipos(consolidado),
        // Si un canal salió de un corte invalidado, este renglón NO es la
        // verdad: queda marcado para rehacerse en vez de congelarse.
        vigente: estado.corteInvalidado == null,
        motivo: estado.corteInvalidado,
      },
      { onConflict: "account_id,periodo" },
    );
  } catch {
    // Sin guardar, el consolidado sirve igual.
  }
  return consolidado;
}

function numeroFinito(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor);
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
    const { desde, hasta } = rangoDelPeriodo(periodo);
    const [{ data }, gastosEmpresariales] = await Promise.all([
      db
        .from("consolidado_cache")
        .select("datos, generado_en, vigente")
        .eq("account_id", cuenta.id)
        .eq("periodo", periodo)
        .maybeSingle(),
      listarGastosEmpresariales(db, cuenta.id, desde, hasta),
    ]);
    const guardado = data?.datos ? leerConsolidadoCache(data.datos) : null;
    if (guardado) {
      // `vigente` lo tumban los trabajos de fondo que cambian el dinero del
      // mes (recarga de pagos, netos de fundas, Finances de Amazon).
      if (data && corteNecesitaRefresco(periodo, data.generado_en, data.vigente ?? true)) {
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
      return aplicarGastosEmpresariales(
        normalizarConsolidadoCache(guardado),
        gastosEmpresariales,
      );
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
      { account_id: cuenta.id, periodo, generado_en: new Date().toISOString(), ms_calculo: null, datos: marcarTipos(consolidado), vigente: true, motivo: null },
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
  return data?.resumen ? compatibilidadGastosEmpresariales(data.resumen as Consolidado) : null;
}

const numeroSeguro = (valor: unknown, respaldo = 0): number => {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : respaldo;
};

export { cuentaActiva };

export function leerConsolidadoCache(datos: unknown): Consolidado | null {
  try {
    const consolidado = revivirTipos(datos);
    return esConsolidadoActual(consolidado) ? consolidado : null;
  } catch {
    return null;
  }
}

/**
 * Las entradas anteriores al desglose contable no se completan con ceros:
 * hacerlo aparentaría una cobertura financiera que nunca se calculó. Se
 * descartan para que `obtenerConsolidado` las regenere con las fuentes reales.
 */
export function esConsolidadoActual(valor: unknown): valor is Consolidado {
  if (!valor || typeof valor !== "object") return false;
  const consolidado = valor as Partial<Consolidado>;
  if (
    consolidado.versionContable !== 2
    || !Array.isArray(consolidado.canales)
    || !Array.isArray(consolidado.porCategoria)
    || !Array.isArray(consolidado.porModelo)
    || !Array.isArray(consolidado.avisos)
    || !consolidado.total
    || typeof consolidado.total !== "object"
  ) return false;

  const total = consolidado.total as Partial<Consolidado["total"]>;
  const camposDesglose = ["comision", "envio", "isr", "iva", "otros", "ajusteLiquidacion"] as const;
  const filaTieneDesglose = (fila: any) => camposDesglose.every((campo) => numeroFinito(fila?.[campo]));
  if (
    !(total.coberturaNeto === null || numeroFinito(total.coberturaNeto))
    || !numeroFinito(total.descuentosPlataforma)
    || !numeroFinito(total.devoluciones)
    || !camposDesglose.every((campo) => numeroFinito(total[campo]))
    || !numeroFinito(total.devolucionesIncluidasEnNeto)
    || !numeroFinito(total.costoRecuperado)
    || !(total.margenSobreNeto === null || numeroFinito(total.margenSobreNeto))
  ) return false;

  return consolidado.porCategoria.every(filaTieneDesglose)
    && consolidado.porModelo.every(filaTieneDesglose)
    && consolidado.canales.every((canal) => (
    canal
    && typeof canal === "object"
    && typeof canal.fuenteNeto === "string"
    && (canal.coberturaNeto === null || numeroFinito(canal.coberturaNeto))
    && Array.isArray(canal.descuentos)
    && numeroFinito(canal.devoluciones)
    && numeroFinito(canal.costoRecuperado)
    && numeroFinito(canal.descuentosPlataforma)
    && canal.desglosePlataforma
    && camposDesglose.every((campo) => numeroFinito(canal.desglosePlataforma?.[campo]))
    && Array.isArray(canal.porModelo)
    && canal.porModelo.every(filaTieneDesglose)
  ));
}

/** Completa campos añadidos después de que se guardaron cachés históricos. */
export function normalizarConsolidadoCache(datos: unknown): Consolidado {
  const consolidado = compatibilidadGastosEmpresariales(revivirTipos(datos) as Consolidado) as any;
  const canales = Array.isArray(consolidado?.canales)
    ? consolidado.canales.map((canal: any) => {
        const descuentos = Array.isArray(canal.descuentos) ? canal.descuentos : [];
        const costoProducto = numeroSeguro(canal.costoProducto);
        return {
          ...canal,
          fuenteNeto: typeof canal.fuenteNeto === "string" ? canal.fuenteNeto : "Neto guardado en caché anterior",
          coberturaNeto: canal.coberturaNeto != null && Number.isFinite(Number(canal.coberturaNeto))
            ? Number(canal.coberturaNeto)
            : null,
          descuentos,
          descuentosPlataforma: numeroSeguro(
            canal.descuentosPlataforma,
            descuentos.reduce((total: number, descuento: any) => total + numeroSeguro(descuento?.monto), 0),
          ),
          costoProducto,
          utilidadBruta: numeroSeguro(canal.utilidadBruta, numeroSeguro(canal.neto) - costoProducto),
        };
      })
    : [];
  const totalAnterior = consolidado?.total ?? {};
  const costoProducto = numeroSeguro(
    totalAnterior.costoProducto,
    canales.reduce((total: number, canal: any) => total + canal.costoProducto, 0),
  );
  return {
    ...consolidado,
    canales,
    total: {
      ...totalAnterior,
      coberturaNeto: totalAnterior.coberturaNeto != null && Number.isFinite(Number(totalAnterior.coberturaNeto))
        ? Number(totalAnterior.coberturaNeto)
        : null,
      descuentosPlataforma: numeroSeguro(
        totalAnterior.descuentosPlataforma,
        canales.reduce((total: number, canal: any) => total + canal.descuentosPlataforma, 0),
      ),
      costoProducto,
    },
  } as Consolidado;
}
