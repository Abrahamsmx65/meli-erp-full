/**
 * Carga del corte general: el corte de calzado, el de fundas y el bloque de
 * Amazon del mismo mes, y el consolidado. Cada canal que falle o no exista
 * se declara en los avisos en vez de tumbar la pantalla.
 */
import { conCandado, cuentaActiva, RecursoOcupadoError, type Cuenta, type DB } from "../datos/repos";
import { cuentaActiva as cuentaYz } from "../yapanizcel/cuenta";
import { cargarEstadoResultadosYz } from "../yapanizcel/corte";
import { obtenerMonitorAmazon } from "./amazon-monitor";
import { cuentaAmazon } from "./amazon";
import { aplicarGastosEmpresariales, armarConsolidado, bloqueDesdeEstado, type BloqueCanal, type Consolidado } from "./consolidado";
import { bloqueAmazon } from "./consolidado-amazon";
import { corteNecesitaRefresco, obtenerEstadoResultadosMeli, obtenerEstadoResultadosYz } from "./corte-cache";
import { cargarEstadoResultados, periodoActual, periodoAnterior, rangoDelPeriodo } from "./corte-meli";
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
  opts?: {
    cortesMasticados?: boolean;
    alUsarCorteInvalidado?: (canal: string, motivo: string) => void;
    alFallarCanal?: (canal: string, motivo: string) => void;
  },
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
  // Un canal que se cayó (timeout, API abajo) NO es un canal sin datos: el
  // consolidado que sale de ahí está incompleto y no puede congelarse como si
  // fuera la verdad. Se avisa hacia arriba para que el renglón no se marque
  // vigente y, si el guardado sí traía ese canal, ni siquiera lo pise.
  const fallo = (canal: string, err: unknown) => {
    const motivo = (err as Error).message;
    avisos.push(`${canal} no se pudo cargar: ${motivo}`);
    opts?.alFallarCanal?.(canal, motivo);
  };

  const [calzado, fundas, amazon, gastosEmpresariales] = await Promise.all([
    (masticados
      ? obtenerEstadoResultadosMeli(db, cuenta, periodo, { exigirVigente: true, alUsarInvalidado: usarInvalidado("Calzado · Mercado Libre") })
      : cargarEstadoResultados(db, cuenta, periodo)
    ).then(
      (e) => bloqueDesdeEstado("meli_calzado", e),
      (err) => {
        fallo("Calzado · Mercado Libre", err);
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
        fallo("Fundas · Mercado Libre", err);
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
        fallo("Amazon", err);
        return null;
      }
    })(),
    listarGastosEmpresariales(db, cuenta.id, desde, hasta),
  ]);
  for (const b of [calzado, fundas, amazon]) if (b) bloques.push(b);

  return armarConsolidado({ periodo, desde, hasta, bloques, gastosEmpresariales, avisos });
}

/**
 * Los canales que el consolidado guardado SÍ traía y el recién calculado
 * perdió. Un recálculo que perdió un canal no es una versión más nueva: es
 * una versión rota, y no puede pisar la buena (decisión del dueño,
 * 11-sep-2026). Así desapareció Amazon del corte general de julio: el
 * refresco de fondo se topó con un timeout leyendo las liquidaciones, el
 * bloque de Amazon salió nulo y el renglón de dos canales sobrescribió al
 * de tres, ya congelado como vigente.
 */
export function canalesPerdidos(guardado: Consolidado | null, nuevo: Consolidado): string[] {
  if (!guardado) return [];
  const hay = new Set(nuevo.canales.map((c) => c.canal));
  return guardado.canales.filter((c) => !hay.has(c.canal)).map((c) => c.canal);
}

const NOMBRE_CANAL: Record<string, string> = {
  meli_calzado: "Calzado · Mercado Libre",
  meli_fundas: "Fundas · Mercado Libre",
  amazon: "Amazon",
};

async function recalcularConsolidado(db: DB, cuenta: Cuenta, periodo: string): Promise<Consolidado> {
  const t0 = Date.now();
  const estado: { corteInvalidado: string | null; canalCaido: string | null } = {
    corteInvalidado: null,
    canalCaido: null,
  };
  const consolidado = await cargarConsolidado(db, cuenta, periodo, {
    cortesMasticados: true,
    alUsarCorteInvalidado: (canal, motivo) => {
      estado.corteInvalidado = `${canal} se armó con su corte invalidado (${motivo}).`;
    },
    alFallarCanal: (canal, motivo) => {
      estado.canalCaido = `${canal} no se pudo cargar (${motivo}).`;
    },
  });

  // ¿Este recálculo perdió un canal que el guardado sí traía? Entonces el
  // guardado se queda y solo se marca para rehacerse.
  let guardado: Consolidado | null = null;
  try {
    const { data } = await db
      .from("consolidado_cache")
      .select("datos")
      .eq("account_id", cuenta.id)
      .eq("periodo", periodo)
      .maybeSingle();
    guardado = data?.datos ? leerConsolidadoCache(data.datos) : null;
  } catch {
    // Sin guardado que comparar, el nuevo es lo único que hay.
  }
  const perdidos = canalesPerdidos(guardado, consolidado);
  const motivoPerdidos = perdidos.length
    ? `Se conservó el corte guardado: este recálculo perdió ${perdidos.map((c) => NOMBRE_CANAL[c] ?? c).join(", ")}${estado.canalCaido ? ` — ${estado.canalCaido}` : ""}`
    : null;

  const motivo = motivoPerdidos ?? estado.canalCaido ?? estado.corteInvalidado;
  const aGuardar = perdidos.length ? guardado! : consolidado;
  try {
    await db.from("consolidado_cache").upsert(
      {
        account_id: cuenta.id,
        periodo,
        generado_en: new Date().toISOString(),
        ms_calculo: Date.now() - t0,
        datos: marcarTipos(aGuardar),
        // Si un canal salió de un corte invalidado, se cayó, o este recálculo
        // perdió un canal, este renglón NO es la verdad: queda marcado para
        // rehacerse en vez de congelarse.
        vigente: motivo == null,
        motivo,
      },
      { onConflict: "account_id,periodo" },
    );
  } catch {
    // Sin guardar, el consolidado sirve igual.
  }
  if (perdidos.length) {
    return {
      ...aGuardar,
      avisos: [
        `El corte general se rehizo y esta vez ${perdidos.map((c) => NOMBRE_CANAL[c] ?? c).join(", ")} no respondió${estado.canalCaido ? ` (${estado.canalCaido})` : ""}. Se conservó lo que ya estaba guardado, que sí lo traía; se vuelve a intentar solo.`,
        ...aGuardar.avisos,
      ],
    };
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

/**
 * El consolidado GUARDADO de un mes, sin calcular nada (para compararlo con
 * el que se está viendo). `null` si ese mes nunca se ha calculado: la
 * pantalla no estrena un corte completo solo para una comparación.
 */
export async function leerConsolidadoGuardado(db: DB, cuenta: Cuenta, periodo: string): Promise<Consolidado | null> {
  try {
    const { desde, hasta } = rangoDelPeriodo(periodo);
    const [{ data }, gastos] = await Promise.all([
      db.from("consolidado_cache").select("datos").eq("account_id", cuenta.id).eq("periodo", periodo).maybeSingle(),
      listarGastosEmpresariales(db, cuenta.id, desde, hasta),
    ]);
    const guardado = data?.datos ? leerConsolidadoCache(data.datos) : null;
    return guardado ? aplicarGastosEmpresariales(normalizarConsolidadoCache(guardado), gastos) : null;
  } catch {
    return null;
  }
}

/**
 * Un solo recálculo de fondo a la vez por cuenta. El candado es de
 * service_role (`candados_trabajo`), así que solo lo toma el cron; el
 * refresco que lanza la pantalla con la sesión del dueño sigue sin él.
 */
const CANDADO_CONSOLIDADO = "consolidado";

/** Recalcula con candado; `null` si otro recálculo ya lo está haciendo. */
async function recalcularConCandado(db: DB, cuenta: Cuenta, periodo: string): Promise<Consolidado | null> {
  try {
    return await conCandado(db, cuenta.id, CANDADO_CONSOLIDADO, 290, () => recalcularConsolidado(db, cuenta, periodo));
  } catch (err) {
    if (err instanceof RecursoOcupadoError) return null;
    throw err;
  }
}

export interface RefrescoConsolidado {
  periodo: string;
  refrescado: boolean;
  motivo: string;
  ms?: number;
  error?: string;
}

/**
 * El corte general masticado POR ATRÁS (cron `/api/cron/consolidado` cada
 * 10 min; decisión del dueño, 24-sep-2026): antes solo se recalculaba cuando
 * alguien abría /cortes, así que la pantalla enseñaba el renglón de hace
 * horas y los números «cuadraban» unos minutos después. Refresca el mes
 * corriente y el anterior con la misma política que la pantalla
 * (`corteNecesitaRefresco`): el corriente cada 10 min, el cerrado casi
 * congelado.
 */
export async function refrescarConsolidadosDeFondo(
  db: DB,
  cuenta: Cuenta,
  opts: { periodos?: string[]; /** no arranca otro mes después de esta hora (ms) */ limite?: number } = {},
): Promise<RefrescoConsolidado[]> {
  const hoy = periodoActual();
  const lista = opts.periodos ?? [hoy, periodoAnterior(hoy)];
  const resultados: RefrescoConsolidado[] = [];
  for (const periodo of lista) {
    const { data } = await db
      .from("consolidado_cache")
      .select("datos, generado_en, vigente")
      .eq("account_id", cuenta.id)
      .eq("periodo", periodo)
      .maybeSingle();
    const guardado = data?.datos ? leerConsolidadoCache(data.datos) : null;
    const motivo = !guardado
      ? "sin renglón guardado"
      : // Tres minutos de adelanto: con el cron cada 10 min, un renglón de
        // 9 min 50 s no llegaba a «viejo» y se refrescaba cada 20.
        data && corteNecesitaRefresco(periodo, data.generado_en, data.vigente ?? true, Date.now() + 3 * 60_000)
        ? data.vigente === false ? "invalidado" : "viejo"
        : null;
    if (!motivo) {
      resultados.push({ periodo, refrescado: false, motivo: "al día" });
      continue;
    }
    if (opts.limite && Date.now() > opts.limite) {
      resultados.push({ periodo, refrescado: false, motivo: `${motivo}; sin tiempo en esta corrida, va en la siguiente` });
      continue;
    }
    const t0 = Date.now();
    try {
      const r = await recalcularConCandado(db, cuenta, periodo);
      resultados.push({ periodo, refrescado: r != null, motivo: r ? motivo : "otro recálculo en curso", ms: Date.now() - t0 });
    } catch (err) {
      resultados.push({ periodo, refrescado: false, motivo, error: (err as Error).message });
    }
  }
  return resultados;
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
    consolidado.versionContable !== 3
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
