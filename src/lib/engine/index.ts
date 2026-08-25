/**
 * Orquestador: junta stock histórico + demanda + reposición + cajas
 * y devuelve un plan de envío completo.
 */
import { calcularDemanda, ventaPerdida } from "./demand";
import { aISO, proximoEnvio, sumarDias } from "./fechas";
import { normalizarParametros } from "./params";
import { calcularLinea, prioridadFaltante, prioridadSobrante } from "./replenish";
import { reconstruirStockDiario } from "./stockHistory";
import { optimizarCajas } from "./boxes";
import type {
  Caja,
  ISODate,
  InventarioPropio,
  LineaPlan,
  OperacionStock,
  Parametros,
  Plan,
  SkuOverride,
  SnapshotStock,
  StockFull,
  VentaDiaria,
} from "./types";

export * from "./types";
export { PARAMETROS_DEFAULT, normalizarParametros, periodoRevision, ventanaRiesgo, zScore } from "./params";
export { optimizarCajas } from "./boxes";
export { calcularDemanda } from "./demand";
export { reconstruirStockDiario, calcularFraccionesConStock } from "./stockHistory";
export { calcularLinea } from "./replenish";
export * from "./fechas";

export interface EntradaPlan {
  skus: { sku: string; titulo?: string | null }[];
  stockActual: StockFull[];
  ventas: VentaDiaria[];
  snapshots: SnapshotStock[];
  operaciones: OperacionStock[];
  inventarioPropio: InventarioPropio[];
  cajas: Caja[];
  overrides?: SkuOverride[];
  parametros?: Partial<Parametros>;
  /** Fecha de corte del análisis. Por defecto, hoy. */
  hoy?: ISODate;
}

export function generarPlan(e: EntradaPlan): Plan {
  const p = normalizarParametros(e.parametros);
  const hoy = e.hoy ?? aISO(new Date());
  const desde = sumarDias(hoy, -(p.diasHistoria - 1));

  const stockMap = new Map(e.stockActual.map((s) => [s.sku, s]));
  const propioMap = new Map(e.inventarioPropio.map((i) => [i.sku, i.unidades]));
  const overrideMap = new Map((e.overrides ?? []).map((o) => [o.sku, o]));
  const tituloMap = new Map(e.skus.map((s) => [s.sku, s.titulo ?? null]));

  const listaSkus = e.skus.map((s) => s.sku);

  // 1. ¿Qué días tuvo stock cada SKU?
  const historial = reconstruirStockDiario({
    skus: listaSkus,
    desde,
    hasta: hoy,
    stockActual: stockMap,
    snapshots: e.snapshots,
    operaciones: e.operaciones,
    ventas: e.ventas,
  });

  // 2. Demanda real corregida por agotamientos + 3. cuánto mandar.
  const lineas: LineaPlan[] = listaSkus.map((sku) => {
    const dias = historial.get(sku) ?? [];
    const override = overrideMap.get(sku);
    const demanda = calcularDemanda(sku, dias, p, override);
    return calcularLinea(
      {
        sku,
        titulo: tituloMap.get(sku) ?? null,
        demanda,
        stock: stockMap.get(sku),
        inventarioPropio: propioMap.get(sku) ?? 0,
        override,
        hoy,
      },
      p,
    );
  });

  // Orden operativo: lo que se quema primero, primero.
  const ordenEstado: Record<string, number> = {
    critico: 0, urgente: 1, ok: 2, sobrestock: 3, sin_demanda: 4,
  };
  lineas.sort((a, b) => {
    const d = ordenEstado[a.estado] - ordenEstado[b.estado];
    if (d !== 0) return d;
    return a.coberturaDias - b.coberturaDias;
  });

  // 4. Armado de cajas mixtas.
  const necesidad = new Map<string, number>();
  const prioridad = new Map<string, number>();
  const castigoSobrante = new Map<string, number>();
  const demandaDiaria = new Map<string, number>();
  for (const l of lineas) {
    if (l.sugerido > 0) necesidad.set(l.sku, l.sugerido);
    prioridad.set(l.sku, prioridadFaltante(l, p));
    castigoSobrante.set(
      l.sku,
      prioridadSobrante(l, p, { excluido: overrideMap.get(l.sku)?.excluir === true }),
    );
    demandaDiaria.set(l.sku, l.demanda.demandaDiaria);
  }

  const planCajas = optimizarCajas({
    necesidad,
    prioridad,
    castigoSobrante,
    demandaDiaria,
    cajas: e.cajas,
    permiteUnidadesSueltas: p.permiteUnidadesSueltas,
    inventarioSuelto: propioMap,
    pesoFaltante: p.pesoFaltante,
    pesoSobrante: p.pesoSobrante,
    // Una talla solo fuerza caja completa si quedaría con MENOS de ~7 días
    // de cobertura: el faltante se mide contra el objetivo (30 días), así
    // que el umbral es horizonte − 7. Los huecos menores esperan al
    // siguiente envío (hay 2 por semana) en vez de subir cajas que las
    // demás tallas no necesitan.
    toleranciaRescateDias: Math.max(2, p.horizonteDias - 7),
    maxCajas: p.maxCajasPorEnvio,
    maxPiezas: p.maxPiezasPorEnvio,
  });

  // 5. Resumen.
  const resumen = {
    generadoEn: new Date().toISOString(),
    skusAnalizados: lineas.length,
    skusCriticos: lineas.filter((l) => l.estado === "critico").length,
    skusUrgentes: lineas.filter((l) => l.estado === "urgente").length,
    skusSobrestock: lineas.filter((l) => l.estado === "sobrestock").length,
    skusConQuiebreHistorico: lineas.filter((l) => l.demanda.diasSinStock >= 3).length,
    piezasSugeridas: lineas.reduce((a, l) => a + l.sugerido, 0),
    piezasPlaneadas: planCajas.totalPiezas,
    totalCajas: planCajas.totalCajas,
    ventaPerdidaEstimada: lineas.reduce((a, l) => a + ventaPerdida(l.demanda), 0),
    proximoEnvio: proximoEnvio(hoy, p.enviosPorSemana),
  };

  return { parametros: p, resumen, lineas, cajas: planCajas };
}
