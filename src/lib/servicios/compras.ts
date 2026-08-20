/**
 * Qué hay que pedirle a China.
 *
 * Es el mismo razonamiento que el de los envíos a Full, pero con otro reloj y
 * otra unidad. A Full se manda cada tres días y se decide por SKU; a China se
 * pide una vez cada varios meses y se decide por MODELO + COLOR, porque la
 * fábrica no fabrica tallas sueltas: fabrica cajas con una corrida adentro.
 *
 * El inventario que cuenta aquí es TODO el que existe:
 *
 *   en Full  +  viajando a Full  +  en cajas en bodega  +  en el barco
 *
 * Contar solo el de bodega haría pedir de más (lo de Full ya está comprado);
 * olvidar el del barco haría pedir dos veces lo mismo, que es el error caro
 * cuando el ciclo de reposición dura meses.
 *
 * La cuenta, por modelo+color:
 *
 *   demanda diaria      = suma de la demanda corregida de sus SKUs
 *   cobertura           = inventario total / demanda diaria
 *   objetivo            = demanda × (días de fábrica + días de barco + días
 *                                    de aduana + meses de piso)
 *   faltante            = objetivo − inventario total
 *   cajas a pedir       = redondeo hacia arriba de faltante / pares por caja
 *
 * Se redondea hacia arriba a propósito: pedir una caja de más cuesta el
 * inventario de una caja, pedir una de menos cuesta quedarse sin talla a
 * medio ciclo y esperar tres meses.
 */
import { traerTodo, type DB } from "../datos/repos";
import { indexarCatalogo, claveOrdenada } from "../etiquetas/resolver";
import { claveAplastada, claveComparacion } from "../importar/sku";
import type { LineaGuardada } from "./cache";

export interface ParametrosCompra {
  /** días que tarda la fábrica en producir */
  diasProduccion: number;
  /** días de barco + aduana + traslado a bodega */
  diasTransito: number;
  /** cuántos días de venta quieres tener en piso al llegar */
  diasCobertura: number;
  /** no pedir modelos que vendan menos de esto al día */
  ventaMinimaDiaria: number;
}

export const COMPRA_POR_DEFECTO: ParametrosCompra = {
  diasProduccion: 45,
  diasTransito: 45,
  diasCobertura: 90,
  ventaMinimaDiaria: 0.1,
};

export type UrgenciaCompra = "quiebre" | "urgente" | "pronto" | "ok" | "sobrado";

/**
 * Reglas de unitalla: la fábrica acepta cajas de una sola talla únicamente
 * en pedidos grandes. Una talla se separa como unitalla solo si ella sola
 * justifica al menos UNITALLA_MIN_CAJAS cajas Y el color completo pide al
 * menos COLOR_MIN_CAJAS cajas; si no, todo va en cajas de corrida.
 */
export const UNITALLA_MIN_CAJAS = 10;
export const COLOR_MIN_CAJAS = 100;

export interface RenglonCompra {
  modelo: string;
  color: string;
  /** cuántos SKUs (tallas) componen este modelo+color */
  tallas: number;
  demandaDiaria: number;
  /** venta mensual de MELI (demanda corregida × 30) */
  ventaMes: number;
  /** venta mensual de Amazon (últimos 30 días) */
  ventaMesAmazon: number;
  enFull: number;
  enTransferencia: number;
  enBodega: number;
  enCamino: number;
  /** stock en FBA + lo que viaja hacia FBA */
  enFba: number;
  inventarioTotal: number;
  /** días que aguanta el inventario actual */
  coberturaDias: number | null;
  /** día en que se queda en cero si no llega nada */
  fechaQuiebre: string | null;
  objetivo: number;
  faltante: number;
  paresPorCaja: number | null;
  cajasSugeridas: number;
  paresSugeridos: number;
  /** hay corrida conocida para armar la caja */
  tieneCorrida: boolean;
  corridaPedido: string | null;
  urgencia: UrgenciaCompra;
  /** si la corrida no embona con cómo se vende: talla -> desvío */
  desajusteCorrida: { talla: string; enCorrida: number; segunDemanda: number }[];
  motivo: string;
  /**
   * La corrida QUE CONVIENE PEDIR: el reparto de pares por caja calculado
   * según lo que falta de cada talla (demanda del horizonte menos stock de
   * esa talla). Es la corrida ajustada a la demanda real, no la histórica.
   */
  corridaPropuesta: Record<string, number> | null;
  /** cajas de corrida (ya sin las tallas que se separaron como unitalla) */
  cajasCorrida: number;
  /** tallas que ameritan caja de una sola talla, con sus cajas */
  unitallas: { talla: string; cajas: number }[];
  /** faltante por talla, la base de todo el reparto */
  faltantePorTalla: Record<string, number>;
}

export interface SugerenciaCompra {
  renglones: RenglonCompra[];
  parametros: ParametrosCompra;
  totales: {
    modelos: number;
    modelosAPedir: number;
    cajas: number;
    pares: number;
    enQuiebre: number;
    sinCorrida: number;
  };
}

function clave(modelo: string, color: string): string {
  return `${modelo.trim().toUpperCase()}|${color.trim().toUpperCase()}`;
}

/**
 * Reparte los pares de una caja entre tallas en proporción a su faltante,
 * en enteros que suman exacto (mayor residuo se lleva el par sobrante).
 */
export function repartirCorrida(
  faltantePorTalla: Record<string, number>,
  paresPorCaja: number,
): Record<string, number> {
  const total = Object.values(faltantePorTalla).reduce((a, b) => a + b, 0);
  if (total <= 0 || paresPorCaja <= 0) return {};

  const crudos = Object.entries(faltantePorTalla)
    .filter(([, f]) => f > 0)
    .map(([talla, f]) => {
      const exacto = (f / total) * paresPorCaja;
      return { talla, piso: Math.floor(exacto), residuo: exacto - Math.floor(exacto) };
    });

  let sobran = paresPorCaja - crudos.reduce((a, c) => a + c.piso, 0);
  crudos.sort((a, b) => b.residuo - a.residuo);
  const corrida: Record<string, number> = {};
  for (const c of crudos) {
    const extra = sobran > 0 ? 1 : 0;
    if (extra) sobran--;
    const pares = c.piso + extra;
    if (pares > 0) corrida[c.talla] = pares;
  }
  return corrida;
}

/**
 * Divide el faltante de un color entre cajas UNITALLA y cajas de CORRIDA.
 *
 * Unitalla solo en pedidos grandes: la talla debe justificar sola al menos
 * UNITALLA_MIN_CAJAS cajas y el color completo debe pedir al menos
 * COLOR_MIN_CAJAS. Lo que se va en unitalla se resta del faltante y el resto
 * se reparte en cajas de corrida con la proporción del faltante restante.
 */
export function armarPedidoColor(
  faltantePorTalla: Record<string, number>,
  paresPorCaja: number,
): {
  unitallas: { talla: string; cajas: number }[];
  cajasCorrida: number;
  corridaPropuesta: Record<string, number>;
} {
  const totalFaltante = Object.values(faltantePorTalla).reduce((a, b) => a + b, 0);
  if (totalFaltante <= 0 || paresPorCaja <= 0) {
    return { unitallas: [], cajasCorrida: 0, corridaPropuesta: {} };
  }

  const cajasTotales = Math.ceil(totalFaltante / paresPorCaja);
  const restante: Record<string, number> = { ...faltantePorTalla };
  const unitallas: { talla: string; cajas: number }[] = [];

  if (cajasTotales >= COLOR_MIN_CAJAS) {
    for (const [talla, f] of Object.entries(restante)) {
      const cajas = Math.floor(f / paresPorCaja);
      if (cajas >= UNITALLA_MIN_CAJAS) {
        unitallas.push({ talla, cajas });
        restante[talla] = f - cajas * paresPorCaja;
      }
    }
    unitallas.sort((a, b) => Number(a.talla) - Number(b.talla));
  }

  const faltanteRestante = Object.values(restante).reduce((a, b) => a + b, 0);
  const cajasCorrida = Math.ceil(faltanteRestante / paresPorCaja);
  const corridaPropuesta = repartirCorrida(restante, paresPorCaja);

  return { unitallas, cajasCorrida, corridaPropuesta };
}

function urgenciaDe(cobertura: number | null, ciclo: number): UrgenciaCompra {
  if (cobertura === null) return "ok";
  if (cobertura <= 0) return "quiebre";
  if (cobertura < ciclo * 0.5) return "urgente";
  if (cobertura < ciclo) return "pronto";
  if (cobertura > ciclo * 2.5) return "sobrado";
  return "ok";
}

/**
 * Compara la corrida contra cómo se vende de verdad.
 *
 * La fábrica manda, por decir, 3 pares del 25 y 15 del 27 en cada caja. Si tus
 * ventas dicen que el 25 es el que se mueve, cada caja que llegue trae 12
 * pares que se van a quedar y le faltan al que sí vende. Esto no cambia lo que
 * se pide — la caja viene como viene — pero sí es lo que hay que reclamarle a
 * la fábrica antes de confirmar el pedido.
 */
function compararCorrida(
  corrida: Record<string, number>,
  demandaPorTalla: Map<string, number>,
): { talla: string; enCorrida: number; segunDemanda: number }[] {
  const totalCaja = Object.values(corrida).reduce((a, b) => a + b, 0);
  const totalDemanda = [...demandaPorTalla.values()].reduce((a, b) => a + b, 0);
  if (totalCaja <= 0 || totalDemanda <= 0) return [];

  const tallas = new Set([...Object.keys(corrida), ...demandaPorTalla.keys()]);
  const desvios: { talla: string; enCorrida: number; segunDemanda: number }[] = [];

  for (const t of tallas) {
    const enCorrida = corrida[t] ?? 0;
    const ideal = ((demandaPorTalla.get(t) ?? 0) / totalDemanda) * totalCaja;
    // Solo importa si se desvía en más de un par y en más de un 40%.
    const dif = Math.abs(enCorrida - ideal);
    if (dif >= 1 && dif / Math.max(ideal, 1) >= 0.4) {
      desvios.push({ talla: t, enCorrida, segunDemanda: Number(ideal.toFixed(1)) });
    }
  }

  return desvios.sort((a, b) => Number(a.talla) - Number(b.talla)).slice(0, 8);
}


/** "IN10160" → 10160, para comparar pedidos por número y no por texto. */
export function numeroDePedido(pedido: string): number {
  const n = Number(pedido.replace(/\D+/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export async function sugerirCompra(
  db: DB,
  accountId: string,
  lineas: LineaGuardada[],
  inventarioPorSku: Map<
    string,
    { enFull: number; enTransferencia: number; enBodega: number; enCamino: number }
  >,
  opciones?: Partial<ParametrosCompra>,
  precargado?: { corridas: any[]; skus: any[] },
  /**
   * Amazon por SKU: su venta diaria y su stock (FBA + en camino). El pedido
   * a China tiene que cubrir LOS DOS canales: pedir solo con la demanda de
   * MELI deja corto todo lo que también vende en Amazon.
   */
  amazonPorSku?: Map<string, { ventaDiaria: number; stock: number }>,
): Promise<SugerenciaCompra> {
  const p = { ...COMPRA_POR_DEFECTO, ...opciones };
  const ciclo = p.diasProduccion + p.diasTransito;
  const horizonte = ciclo + p.diasCobertura;

  // La página de pedidos ya leyó estas dos tablas para el inventario:
  // volver a pedirlas duplicaba los viajes a la base en cada clic.
  const [corridasRaw, skusRaw] = precargado
    ? [precargado.corridas, precargado.skus]
    : await Promise.all([
        traerTodo<any>(db, "corridas", "pedido, modelo, color, tallas, total", (q) =>
          q.eq("account_id", accountId),
        ),
        traerTodo<any>(db, "skus", "sku, modelo, color, talla", (q) =>
          q.eq("account_id", accountId).eq("activo", true),
        ),
      ]);

  // La corrida más reciente de cada modelo+color es la que la fábrica usa hoy.
  const corridaDe = new Map<string, { tallas: Record<string, number>; total: number; pedido: string }>();
  for (const c of corridasRaw) {
    const k = clave(c.modelo ?? "", c.color ?? "");
    const previa = corridaDe.get(k);
    const total = c.total ?? Object.values(c.tallas ?? {}).reduce((a: number, b: any) => a + Number(b), 0);
    if (!total) continue;
    // Empatan por pedido: el número de pedido más alto es el más nuevo.
    // Se compara el NÚMERO, no el texto: "IN9999" > "IN10160" como cadena.
    if (!previa || numeroDePedido(String(c.pedido ?? "")) > numeroDePedido(previa.pedido)) {
      corridaDe.set(k, { tallas: c.tallas ?? {}, total, pedido: String(c.pedido ?? "") });
    }
  }

  // Cómo se descompone cada SKU. Se prefiere el catálogo directo; si no
  // está (los SKUs de AMAZON traen sufijo -MX y a veces la talla antes del
  // color), se amarra contra el catálogo con los índices de siempre —
  // canónico, aplastado y con los pedazos ordenados. Sin este amarre, la
  // venta y el stock de Amazon caían en grupos fantasma (GT128|23-BLK) y el
  // pedido a China se calculaba solo con MELI.
  const infoSku = new Map(skusRaw.map((s) => [s.sku, s]));
  const indiceMeli = indexarCatalogo(skusRaw);

  function partes(sku: string): { modelo: string; color: string; talla: string } {
    const i =
      infoSku.get(sku) ??
      indiceMeli.canonico.get(claveComparacion(sku)) ??
      indiceMeli.aplastado.get(claveAplastada(sku)) ??
      indiceMeli.ordenado.get(claveOrdenada(sku));
    if (i?.modelo) return { modelo: i.modelo, color: i.color ?? "", talla: i.talla ?? "" };
    const t = sku.split("-");
    return {
      modelo: t[0] ?? sku,
      color: t.length >= 3 ? t.slice(1, -1).join("-") : (t[1] ?? ""),
      talla: t.length >= 3 ? (t[t.length - 1] ?? "") : "",
    };
  }

  // --- Agrupar por modelo + color -----------------------------------------
  interface Acumulado {
    modelo: string;
    color: string;
    skus: Set<string>;
    demandaDiaria: number;
    ventaMes: number;
    ventaMesAmazon: number;
    enFull: number;
    enTransferencia: number;
    enBodega: number;
    enCamino: number;
    enFba: number;
    demandaPorTalla: Map<string, number>;
    inventarioPorTalla: Map<string, number>;
  }

  const grupos = new Map<string, Acumulado>();

  function grupo(modelo: string, color: string): Acumulado {
    const k = clave(modelo, color);
    let g = grupos.get(k);
    if (!g) {
      g = {
        modelo: modelo.toUpperCase(),
        color: color.toUpperCase(),
        skus: new Set(),
        demandaDiaria: 0,
        ventaMes: 0,
        ventaMesAmazon: 0,
        enFull: 0,
        enTransferencia: 0,
        enBodega: 0,
        enCamino: 0,
        enFba: 0,
        demandaPorTalla: new Map(),
        inventarioPorTalla: new Map(),
      };
      grupos.set(k, g);
    }
    return g;
  }

  for (const l of lineas) {
    const modelo = l.modelo || partes(l.sku).modelo;
    const color = l.color || partes(l.sku).color;
    const talla = l.talla || partes(l.sku).talla;

    const g = grupo(modelo, color);
    g.skus.add(l.sku);
    g.demandaDiaria += l.demandaDiaria;
    g.ventaMes += l.demandaDiaria * 30;
    if (talla) {
      g.demandaPorTalla.set(talla, (g.demandaPorTalla.get(talla) ?? 0) + l.demandaDiaria);
    }
  }

  // El inventario se suma aparte: hay SKUs con producto en bodega que el plan
  // ni siquiera menciona porque nunca se han vendido. Esos también ocupan
  // espacio y no hay que volver a pedirlos.
  for (const [sku, inv] of inventarioPorSku) {
    const { modelo, color, talla } = partes(sku);
    const g = grupo(modelo, color);
    g.skus.add(sku);
    g.enFull += inv.enFull;
    g.enTransferencia += inv.enTransferencia;
    g.enBodega += inv.enBodega;
    g.enCamino += inv.enCamino;
    if (talla) {
      const total = inv.enFull + inv.enTransferencia + inv.enBodega + inv.enCamino;
      g.inventarioPorTalla.set(talla, (g.inventarioPorTalla.get(talla) ?? 0) + total);
    }
  }

  // Amazon: su demanda se SUMA a la de MELI y su stock cuenta como
  // inventario ya comprado. El pedido a China surte a los dos canales.
  for (const [sku, amz] of amazonPorSku ?? []) {
    const { modelo, color, talla } = partes(sku);
    const g = grupo(modelo, color);
    g.skus.add(sku);
    g.demandaDiaria += amz.ventaDiaria;
    g.ventaMesAmazon += amz.ventaDiaria * 30;
    g.enFba += amz.stock;
    if (talla) {
      g.demandaPorTalla.set(talla, (g.demandaPorTalla.get(talla) ?? 0) + amz.ventaDiaria);
      g.inventarioPorTalla.set(talla, (g.inventarioPorTalla.get(talla) ?? 0) + amz.stock);
    }
  }

  // --- Un renglón por grupo ------------------------------------------------
  const renglones: RenglonCompra[] = [];
  const hoy = new Date();

  for (const g of grupos.values()) {
    const inventarioTotal = g.enFull + g.enTransferencia + g.enBodega + g.enCamino + g.enFba;
    const demanda = g.demandaDiaria;

    if (demanda < p.ventaMinimaDiaria && inventarioTotal === 0) continue;

    const cobertura = demanda > 0 ? inventarioTotal / demanda : null;
    const fechaQuiebre =
      cobertura !== null && cobertura < 400
        ? new Date(hoy.getTime() + cobertura * 86400000).toISOString().slice(0, 10)
        : null;

    const objetivo = demanda * horizonte;
    const faltante = Math.max(0, objetivo - inventarioTotal);

    const c = corridaDe.get(clave(g.modelo, g.color));
    const paresPorCaja = c?.total ?? null;

    // Faltante POR TALLA: la demanda del horizonte de cada talla menos su
    // propio inventario. Es la base de la corrida propuesta — pedir con la
    // corrida vieja repone también las tallas que ya están sobradas.
    const faltantePorTalla: Record<string, number> = {};
    const tallasTodas = new Set([...g.demandaPorTalla.keys(), ...g.inventarioPorTalla.keys()]);
    for (const t of tallasTodas) {
      const f =
        (g.demandaPorTalla.get(t) ?? 0) * horizonte - (g.inventarioPorTalla.get(t) ?? 0);
      if (Math.round(f) > 0) faltantePorTalla[t] = Math.round(f);
    }

    // OJO: la puerta es el faltante POR TALLA, no el agregado. El agregado
    // engaña: 500 pares de sobra en la talla 29 "tapan" el faltante de la
    // 25 en la resta global, y el color se quedaba sin pedir justo lo que
    // se le agotó. El sobrante de una talla no se puede vender como otra.
    const totalFaltanteTallas = Object.values(faltantePorTalla).reduce((a, b) => a + b, 0);
    // El umbral de venta mínima APAGA el pedido, no solo el texto: antes un
    // modelo con el motivo "no conviene volver a pedirlo" igual sumaba cajas.
    const valeLaPena = demanda >= p.ventaMinimaDiaria;
    const pedido =
      valeLaPena && totalFaltanteTallas > 0 && paresPorCaja && paresPorCaja > 0
        ? armarPedidoColor(faltantePorTalla, paresPorCaja)
        : { unitallas: [], cajasCorrida: 0, corridaPropuesta: {} };

    const cajasSugeridas =
      pedido.cajasCorrida + pedido.unitallas.reduce((a, u) => a + u.cajas, 0);

    const urgencia = urgenciaDe(cobertura, ciclo);

    let motivo: string;
    if (demanda < p.ventaMinimaDiaria) {
      motivo = `Casi no se vende (${(demanda * 30).toFixed(1)} pares al mes). No conviene volver a pedirlo.`;
    } else if (totalFaltanteTallas <= 0) {
      motivo = `Con ${Math.round(inventarioTotal)} pares aguanta ${Math.round(cobertura ?? 0)} días; el ciclo completo son ${horizonte}. No hace falta pedir.`;
    } else if (!paresPorCaja) {
      motivo = `Faltan ${Math.round(totalFaltanteTallas)} pares por talla, pero no hay corrida cargada para este modelo+color, así que no puedo decir cuántas cajas son.`;
    } else if (faltante <= 0) {
      const tallasCortas = Object.keys(faltantePorTalla).sort((a, b) => Number(a) - Number(b));
      motivo = `En total parece alcanzar, pero por talla no: faltan ${Math.round(totalFaltanteTallas)} pares en ${tallasCortas.join(", ")} (el sobrante de otras tallas no las tapa).`;
    } else {
      const llegada = Math.round(cobertura ?? 0) - ciclo;
      motivo =
        llegada < 0
          ? `Si pides hoy, llega ${Math.abs(llegada)} días DESPUÉS de quedarte sin producto.`
          : `Aguanta ${Math.round(cobertura ?? 0)} días y el pedido tarda ${ciclo}. Te quedan ${llegada} días de margen.`;
    }

    renglones.push({
      modelo: g.modelo,
      color: g.color,
      tallas: g.skus.size,
      demandaDiaria: Number(demanda.toFixed(3)),
      ventaMes: Math.round(g.ventaMes),
      ventaMesAmazon: Math.round(g.ventaMesAmazon),
      enFull: Math.round(g.enFull),
      enTransferencia: Math.round(g.enTransferencia),
      enBodega: Math.round(g.enBodega),
      enCamino: Math.round(g.enCamino),
      enFba: Math.round(g.enFba),
      inventarioTotal: Math.round(inventarioTotal),
      coberturaDias: cobertura === null ? null : Number(cobertura.toFixed(1)),
      fechaQuiebre,
      objetivo: Math.round(objetivo),
      faltante: Math.round(faltante),
      paresPorCaja,
      cajasSugeridas,
      paresSugeridos: cajasSugeridas * (paresPorCaja ?? 0),
      tieneCorrida: Boolean(paresPorCaja),
      corridaPedido: c?.pedido ?? null,
      urgencia,
      desajusteCorrida: c ? compararCorrida(c.tallas, g.demandaPorTalla) : [],
      motivo,
      corridaPropuesta: Object.keys(pedido.corridaPropuesta).length
        ? pedido.corridaPropuesta
        : null,
      cajasCorrida: pedido.cajasCorrida,
      unitallas: pedido.unitallas,
      faltantePorTalla,
    });
  }

  // Lo que se va a acabar primero, arriba.
  const orden: Record<UrgenciaCompra, number> = {
    quiebre: 0,
    urgente: 1,
    pronto: 2,
    ok: 3,
    sobrado: 4,
  };
  renglones.sort((a, b) => {
    const d = orden[a.urgencia] - orden[b.urgencia];
    if (d !== 0) return d;
    return b.demandaDiaria - a.demandaDiaria;
  });

  const aPedir = renglones.filter((r) => r.cajasSugeridas > 0);

  return {
    renglones,
    parametros: p,
    totales: {
      modelos: renglones.length,
      modelosAPedir: aPedir.length,
      cajas: aPedir.reduce((a, r) => a + r.cajasSugeridas, 0),
      pares: aPedir.reduce((a, r) => a + r.paresSugeridos, 0),
      enQuiebre: renglones.filter((r) => r.urgencia === "quiebre" || r.urgencia === "urgente").length,
      sinCorrida: renglones.filter((r) => Object.keys(r.faltantePorTalla).length > 0 && !r.tieneCorrida).length,
    },
  };
}
