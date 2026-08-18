/**
 * Historial diario de UN SKU.
 *
 * El plan no guarda el día a día de los 2,393 SKUs —serían más de 200 mil
 * renglones por cálculo— así que cuando quieres ver un SKU concreto se
 * reconstruye solo el suyo. Cargar los datos de un SKU es barato.
 */
import { aISO, rangoFechas, sumarDias } from "../engine/fechas";
import { calcularDemanda } from "../engine/demand";
import { reconstruirStockDiario } from "../engine/stockHistory";
import { normalizarParametros, periodoRevision, ventanaRiesgo, zScore } from "../engine/params";
import { calcularLinea } from "../engine/replenish";
import type { DiaStock, ISODate, LineaPlan, Parametros } from "../engine/types";
import { leerParametros, traerTodo, type DB } from "../datos/repos";

export interface DiaHistorial {
  fecha: ISODate;
  /** disponibles al arrancar el día */
  inicio: number;
  /** disponibles al cerrar el día */
  fin: number;
  unidades: number;
  /** 0..1 — qué parte del día tuvo stock */
  fraccion: number;
  /** de dónde salió el nivel de ese día */
  origen: DiaStock["origen"];
}

export interface Historial {
  sku: string;
  titulo: string | null;
  dias: DiaHistorial[];
  linea: LineaPlan;
  parametros: Parametros;
  /** cuánto de la historia es medición y cuánto es deducción */
  cobertura: {
    diasConMovimiento: number;
    diasConFoto: number;
    diasDeducidos: number;
    hayMovimientos: boolean;
  };
  /** los números del cálculo, ya masticados para explicarlos */
  cuentas: {
    diasCalendario: number;
    diasConStock: number;
    diasSinStock: number;
    unidadesVendidas: number;
    tasaCruda: number;
    tasaCorregida: number;
    demandaDiaria: number;
    factorCorreccion: number;
    factorTendencia: number;
    ventaPerdida: number;
    sigmaDiaria: number;
    z: number;
    ventanaRiesgo: number;
    periodoRevision: number;
    confianza: string;
  };
}

export async function historialDeSku(
  db: DB,
  accountId: string,
  sku: string,
): Promise<Historial | null> {
  const parametros = normalizarParametros(await leerParametros(db, accountId));
  const hoy = aISO(new Date());
  const desde = sumarDias(hoy, -(parametros.diasHistoria - 1));

  const eq = (q: any) => q.eq("account_id", accountId).eq("sku", sku);

  const [skuRow, stockRow, ventas, snapshots, operaciones, overrides] = await Promise.all([
    db.from("skus").select("sku, titulo").eq("account_id", accountId).eq("sku", sku).maybeSingle(),
    db
      .from("stock_full")
      .select("sku, disponible, en_transferencia, no_disponible, total")
      .eq("account_id", accountId)
      .eq("sku", sku)
      .maybeSingle(),
    traerTodo<any>(db, "ventas_diarias", "sku, fecha, unidades", (q) => eq(q).gte("fecha", desde)),
    traerTodo<any>(db, "stock_snapshots", "sku, fecha, disponible, en_transferencia, origen", (q) =>
      eq(q).gte("fecha", desde),
    ),
    traerTodo<any>(
      db,
      "stock_operaciones",
      "sku, fecha, tipo, delta_disponible, resultado_disponible",
      (q) => eq(q).gte("fecha", `${desde}T00:00:00Z`),
    ),
    traerTodo<any>(db, "sku_overrides", "sku, excluir, demanda_manual, factor_temporada, minimo_envio", eq),
  ]);

  // Si no está en el catálogo pero sí vendió, sigue valiendo la pena verlo.
  if (!skuRow.data && !ventas.length) return null;

  const stock = stockRow.data
    ? {
        sku,
        disponible: stockRow.data.disponible ?? 0,
        enTransferencia: stockRow.data.en_transferencia ?? 0,
        noDisponible: stockRow.data.no_disponible ?? 0,
        total: stockRow.data.total ?? 0,
      }
    : undefined;

  const historial = reconstruirStockDiario({
    skus: [sku],
    desde,
    hasta: hoy,
    stockActual: new Map(stock ? [[sku, stock]] : []),
    snapshots: snapshots.map((s) => ({
      sku: s.sku,
      fecha: s.fecha,
      disponible: s.disponible ?? 0,
      enTransferencia: s.en_transferencia ?? 0,
      origen: s.origen,
    })),
    operaciones: operaciones.map((o) => ({
      sku: o.sku,
      fecha: o.fecha,
      tipo: o.tipo,
      deltaDisponible: o.delta_disponible,
      resultadoDisponible: o.resultado_disponible,
    })),
    ventas: ventas.map((v) => ({ sku: v.sku, fecha: v.fecha, unidades: v.unidades ?? 0 })),
  });

  const dias = historial.get(sku) ?? [];

  const override = overrides[0]
    ? {
        sku,
        excluir: overrides[0].excluir ?? false,
        demandaManual: overrides[0].demanda_manual,
        factorTemporada: Number(overrides[0].factor_temporada ?? 1),
        minimoEnvio: overrides[0].minimo_envio,
      }
    : undefined;

  // calcularDemanda muta `dias` para llenar las fracciones: por eso va antes
  // de leerlas.
  const demanda = calcularDemanda(sku, dias, parametros, override);
  const linea = calcularLinea(
    { sku, titulo: skuRow.data?.titulo ?? null, demanda, stock, inventarioPropio: 0, override, hoy },
    parametros,
  );

  const diasConMovimiento = dias.filter((d) => d.origen === "operaciones").length;
  const diasConFoto = dias.filter((d) => d.origen === "snapshot").length;

  return {
    sku,
    titulo: skuRow.data?.titulo ?? null,
    dias: dias.map((d) => ({
      fecha: d.fecha,
      inicio: d.inicio,
      fin: d.fin,
      unidades: d.unidades,
      fraccion: Number(d.fraccionConStock.toFixed(3)),
      origen: d.origen,
    })),
    linea,
    parametros,
    cobertura: {
      diasConMovimiento,
      diasConFoto,
      diasDeducidos: dias.length - diasConMovimiento - diasConFoto,
      hayMovimientos: operaciones.length > 0,
    },
    cuentas: {
      diasCalendario: demanda.diasCalendario,
      diasConStock: Number(demanda.diasEfectivos.toFixed(1)),
      diasSinStock: demanda.diasSinStock,
      unidadesVendidas: demanda.unidadesTotales,
      tasaCruda: Number(demanda.tasaObservada.toFixed(2)),
      tasaCorregida: Number(demanda.tasaCorregida.toFixed(2)),
      demandaDiaria: Number(demanda.demandaDiaria.toFixed(2)),
      factorCorreccion: Number(demanda.factorCorreccion.toFixed(2)),
      factorTendencia: Number(demanda.factorTendencia.toFixed(2)),
      ventaPerdida: Math.round(
        Math.max(0, demanda.diasCalendario - demanda.diasEfectivos) * demanda.demandaDiaria,
      ),
      sigmaDiaria: Number(demanda.sigmaDiaria.toFixed(2)),
      z: Number(zScore(parametros.nivelServicio).toFixed(3)),
      ventanaRiesgo: Number(ventanaRiesgo(parametros).toFixed(1)),
      periodoRevision: Number(periodoRevision(parametros).toFixed(1)),
      confianza: demanda.confianza,
    },
  };
}

export { rangoFechas };
