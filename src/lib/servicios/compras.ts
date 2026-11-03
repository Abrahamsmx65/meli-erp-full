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
 *   +  en FBA (y viajando a FBA)  +  libre en la bodega de TikTok
 *
 * Contar solo el de bodega haría pedir de más (lo de Full ya está comprado);
 * olvidar el del barco haría pedir dos veces lo mismo, que es el error caro
 * cuando el ciclo de reposición dura meses.
 *
 * La cuenta, por modelo+color:
 *
 *   demanda diaria      = suma de lo que cada SKU VENDE CON STOCK (días
 *                         surtidos ponderados por recencia, sin tope ni
 *                         tendencia; `engine/demanda-surtida.ts`); sin 14
 *                         días surtidos, la demanda del plan de Full
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
import { desglosarSku } from "./sync";
import { cargarAliasColores, colorEfectivo, type MapaAlias } from "./alias-color";
import { familiaDe, type MapaFamilias } from "../pedidos-china/familias";
import { cargarFamilias } from "./familias-modelos";
import type { LineaGuardada } from "./cache";
import type { TikTokCompraSku } from "./tiktok-compras";

export interface ParametrosCompra {
  /** días que tarda la fábrica en producir */
  diasProduccion: number;
  /** días de barco + aduana + traslado a bodega */
  diasTransito: number;
  /** cuántos días de venta quieres tener en piso al llegar */
  diasCobertura: number;
  /** no pedir modelos que vendan menos de esto al día */
  ventaMinimaDiaria: number;
  /**
   * Umbral del régimen: si la cobertura del color es MENOR a esto, el stock
   * se agota antes de que llegue el pedido. Ya solo clasifica el mensaje del
   * renglón — el faltante siempre descuenta el stock completo.
   */
  umbralAgotamientoDias: number;
}

export const COMPRA_POR_DEFECTO: ParametrosCompra = {
  diasProduccion: 45,
  diasTransito: 45,
  diasCobertura: 90,
  ventaMinimaDiaria: 0.1,
  umbralAgotamientoDias: 100,
};

/** La fábrica solo arma cajas de estos totales. */
export const PARES_POR_CAJA_VALIDOS = [12, 24, 36, 48] as const;

/**
 * Lleva el total histórico de la corrida al tamaño de caja REAL de fábrica:
 * el más cercano de 12/24/36/48 (en empate, la caja más grande — pedir un
 * par de más cuesta inventario; una caja imposible no existe).
 */
export function paresPorCajaNormalizado(historico: number): number {
  if (!Number.isFinite(historico) || historico <= 0) return 24;
  let mejor: number = PARES_POR_CAJA_VALIDOS[1];
  let mejorDist = Infinity;
  for (const v of PARES_POR_CAJA_VALIDOS) {
    const d = Math.abs(v - historico);
    if (d < mejorDist || (d === mejorDist && v > mejor)) {
      mejorDist = d;
      mejor = v;
    }
  }
  return mejor;
}

export type RegimenCompra = "se_agota" | "repone";

/**
 * El faltante por talla: demanda del horizonte menos TODO el stock de esa
 * talla, sin amortiguar. Antes el régimen "repone" descontaba el stock solo
 * al 70% "para no deformar la corrida", pero eso fabricaba faltantes
 * fantasma: un color con 189 días de cobertura pedía miles de pares que ya
 * estaban en el piso. El usuario lo decidió explícito: el Pedido 1 debe
 * cuadrar con el Detalle SKU, o sea faltante EXACTO siempre.
 *
 * `faltantePorTalla` (corrida) y `faltanteExactoPorTalla` (cajas completas
 * de una talla) son ahora el mismo número; se regresan los dos para no
 * cambiar la firma. El `regimen` solo clasifica el mensaje: "se_agota" si el
 * stock se acaba antes de que llegue el pedido, "repone" si va a sobrar.
 */
export function faltantesPorRegimen(e: {
  demandaPorTalla: Map<string, number>;
  inventarioPorTalla: Map<string, number>;
  horizonte: number;
  coberturaDias: number | null;
  umbralAgotamientoDias: number;
}): {
  regimen: RegimenCompra;
  faltantePorTalla: Record<string, number>;
  faltanteExactoPorTalla: Record<string, number>;
} {
  const regimen: RegimenCompra =
    e.coberturaDias !== null && e.coberturaDias < e.umbralAgotamientoDias
      ? "se_agota"
      : "repone";

  const faltantePorTalla: Record<string, number> = {};
  const tallas = new Set([...e.demandaPorTalla.keys(), ...e.inventarioPorTalla.keys()]);

  for (const t of tallas) {
    const demanda = (e.demandaPorTalla.get(t) ?? 0) * e.horizonte;
    const stock = e.inventarioPorTalla.get(t) ?? 0;

    // El stock SIEMPRE se descuenta completo: aunque se vaya a agotar antes
    // de que llegue el pedido, cubre la primera parte del horizonte.
    // Ignorarlo — o descontarlo a medias — es pedir dos veces lo mismo, el
    // error caro que este archivo promete evitar.
    const exacto = demanda - stock;
    if (Math.round(exacto) > 0) faltantePorTalla[t] = Math.round(exacto);
  }

  return { regimen, faltantePorTalla, faltanteExactoPorTalla: { ...faltantePorTalla } };
}

export type UrgenciaCompra = "quiebre" | "urgente" | "pronto" | "ok" | "sobrado";

/**
 * Regla de unitalla: una talla se separa en cajas de una sola talla cuando
 * ella sola justifica al menos UNITALLA_MIN_CAJAS cajas; el resto va en
 * cajas de corrida. No hay mínimo por color: exigirlo obligaba a inflar la
 * corrida entera para "acompletar" una talla corta, justo el stock de más
 * que el usuario no quiere.
 */
export const UNITALLA_MIN_CAJAS = 5;

export interface RenglonCompra {
  modelo: string;
  color: string;
  /**
   * Familia a la que pertenece el modelo (`modelos_familias`): varios
   * números que la fábrica hace como un solo zapato y se piden juntos
   * (GT117…GT122). La pantalla y el Excel agrupan por ella; null = va solo.
   */
  familia: string | null;
  /** cuántos SKUs (tallas) componen este modelo+color */
  tallas: number;
  demandaDiaria: number;
  /** tallas que no tienen 14 días surtidos y usan la demanda del plan de Full */
  tallasConRespaldo: number;
  /** venta mensual de MELI (demanda con stock × 30) */
  ventaMes: number;
  /** venta mensual REALMENTE observada en MELI (últimos 30 días, sin corrección) */
  ventaMesReal: number;
  /** venta mensual de Amazon corregida por agotamiento (la que usa el cálculo) */
  ventaMesAmazon: number;
  /** venta mensual REALMENTE observada en Amazon (últimos 30 días, sin corrección) */
  ventaMesRealAmazon: number;
  /**
   * venta mensual de TikTok, la observada tal cual (últimos 30 días ÷ 30):
   * por decisión del dueño NO se corrige por agotamiento ni por tendencia.
   */
  ventaMesTikTok: number;
  enFull: number;
  enTransferencia: number;
  enBodega: number;
  enCamino: number;
  /** stock en FBA + lo que viaja hacia FBA */
  enFba: number;
  /** pares libres en la bodega de TikTok (saldo del kardex − apartado) */
  enTikTok: number;
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
  /**
   * Clasificación informativa del color: "se_agota" = el stock se acaba
   * antes de que llegue el pedido; "repone" = va a quedar stock al llegar.
   * En ambos casos el faltante descuenta el stock completo.
   */
  regimen: RegimenCompra;
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
  /** sin receta de este color: de dónde salió la caja que se supuso (null = receta real) */
  cajaSupuesta: OrigenCajaSupuesta | null;
  /**
   * La OTRA opción de pedido: solo según la venta, SIN descontar ningún
   * inventario. La demanda por talla ya viene corregida por agotamientos
   * (una talla que no vendió por estar en cero cuenta con su demanda
   * estimada, no con cero), así que este pedido repone el ritmo real.
   */
  soloVenta: {
    cajas: number;
    pares: number;
    cajasCorrida: number;
    unitallas: { talla: string; cajas: number }[];
    corridaPropuesta: Record<string, number> | null;
    demandaPorTalla: Record<string, number>;
  };
}

/**
 * Un renglón por SKU con TODOS los números que alimentan el pedido: para que
 * el usuario pueda auditar de dónde sale cada cantidad sugerida.
 */
export interface DetalleSkuCompra {
  sku: string;
  modelo: string;
  color: string;
  talla: string;
  /** venta mensual usada por el cálculo (demanda corregida de MELI × 30) */
  ventaMesMeli: number;
  /** venta mensual realmente observada en MELI (últimos 30 días, sin corrección) */
  ventaMesRealMeli: number;
  /** venta mensual de Amazon corregida por agotamiento (la que usa el cálculo) */
  ventaMesAmazon: number;
  /** venta mensual realmente observada en Amazon (sin corrección) */
  ventaMesRealAmazon: number;
  /** venta mensual de TikTok observada (sin corrección) */
  ventaMesTikTok: number;
  /** stock en Full + lo que viaja hacia Full */
  enFull: number;
  /** stock en FBA + lo que de verdad viene en camino a FBA */
  enFba: number;
  /** pares libres en la bodega de TikTok */
  enTikTok: number;
  enBodega: number;
  /** lo que viene de China (pedidos vivos y contenedores) */
  deChina: number;
  inventarioTotal: number;
  /** venta total × horizonte − inventario total, piso en cero */
  faltante: number;
}

export interface SugerenciaCompra {
  renglones: RenglonCompra[];
  detalleSkus: DetalleSkuCompra[];
  parametros: ParametrosCompra;
  totales: {
    modelos: number;
    modelosAPedir: number;
    cajas: number;
    pares: number;
    enQuiebre: number;
    /** con faltante y sin NINGUNA caja que suponer (ni del modelo ni estándar) */
    sinCorrida: number;
    /** con faltante y receta de otro color o estándar en vez de la propia */
    conCajaSupuesta: number;
  };
}

function clave(modelo: string, color: string): string {
  return `${modelo.trim().toUpperCase()}|${color.trim().toUpperCase()}`;
}

/**
 * Con qué claves se reconoce una corrida (o se busca), para que el modelo +
 * color del SKU de MELI y el de la receta del pedido se encuentren aunque
 * estén escritos distinto. Hasta el 9-oct-2026 la búsqueda era por texto
 * exacto y 98 modelos salían «sin corrida» teniendo receta:
 *   - separador: la corrida dice «BLK/GREY» y el SKU «BLK-GREY» (GT204,
 *     YH816, G650, GT110 GREY-BLUE);
 *   - modelo con guion: la corrida es GT104-2 | GREY y el catálogo parte el
 *     SKU como GT104 | 2-GREY (todo el GT104);
 *   - anotación: «BLK (NEGRO)» contra «BLK»;
 *   - amarre a mano del color (`alias-color.ts`): la receta vive bajo el
 *     color de la fábrica («NAVY (AZUL MARINO)») y el SKU bajo el de MELI
 *     («BLUE»).
 * Todo cae en la clave APLASTADA de modelo + color (sin separadores, con
 * sinónimos), más la variante sin paréntesis y la traducida por el alias.
 */
export function clavesDeCorrida(modelo: string, color: string, alias?: MapaAlias | null): string[] {
  const m = (modelo || "").trim();
  const c = (color || "").trim();
  const sinAnotacion = c.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const claves = [claveAplastada(`${m}-${c}`), claveAplastada(`${m}-${sinAnotacion}`)];
  if (alias?.size) {
    const traducido = colorEfectivo(alias, m, c);
    if (traducido !== c) claves.push(claveAplastada(`${m}-${traducido}`));
    const traducidoSinAnotacion = colorEfectivo(alias, m, sinAnotacion);
    if (traducidoSinAnotacion !== sinAnotacion) claves.push(claveAplastada(`${m}-${traducidoSinAnotacion}`));
  }
  return [...new Set(claves.filter(Boolean))];
}

export interface CorridaIndexada {
  tallas: Record<string, number>;
  total: number;
  pedido: string;
}

/** La corrida más reciente (pedido más alto) de cada modelo + color, por todas sus claves. */
export function indexarCorridas(
  corridas: { pedido?: unknown; modelo?: unknown; color?: unknown; tallas?: unknown; total?: unknown }[],
  alias?: MapaAlias | null,
): Map<string, CorridaIndexada> {
  const indice = new Map<string, CorridaIndexada>();
  for (const c of corridas) {
    const tallas = (c.tallas ?? {}) as Record<string, number>;
    const total = Number(c.total) || Object.values(tallas).reduce((a: number, b: unknown) => a + Number(b), 0);
    if (!total) continue;
    const pedido = String(c.pedido ?? "");
    for (const k of clavesDeCorrida(String(c.modelo ?? ""), String(c.color ?? ""), alias)) {
      const previa = indice.get(k);
      // Empatan por pedido: el número de pedido más alto es el más nuevo.
      // Se compara el NÚMERO, no el texto: "IN9999" > "IN10160" como cadena.
      if (!previa || numeroDePedido(pedido) > numeroDePedido(previa.pedido)) {
        indice.set(k, { tallas, total, pedido });
      }
    }
  }
  return indice;
}

export function buscarCorrida(
  indice: Map<string, CorridaIndexada>,
  modelo: string,
  color: string,
): CorridaIndexada | undefined {
  for (const k of clavesDeCorrida(modelo, color)) {
    const c = indice.get(k);
    if (c) return c;
  }
  return undefined;
}

export type OrigenCajaSupuesta = "modelo" | "unitalla" | "estandar";

/** Una caja de UNA sola talla de un pedido cargado: pares por caja del modelo + color. */
export interface CajaUnitalla {
  pedido: string;
  modelo: string;
  color: string;
  paresPorCaja: number;
}

/**
 * Pares por caja cuando NO hay receta de ese modelo + color (dueño,
 * 18-oct-2026: «¿para qué necesitas la proforma para poder calcular qué hay
 * que pedir?»): la caja del MISMO MODELO en otro color (la receta más
 * reciente) y, si el modelo nunca se ha pedido, la caja ESTÁNDAR de la
 * fábrica (la más frecuente entre todas las recetas de la cuenta). La
 * corrida se propone por venta, como siempre; el renglón declara qué caja
 * se supuso. Sin ninguna receta en la cuenta, null.
 */
export function cajaDeRespaldo(
  corridas: { pedido?: unknown; modelo?: unknown; color?: unknown; tallas?: unknown; total?: unknown }[],
  modelo: string,
  unitallas: CajaUnitalla[] = [],
): { paresPorCaja: number; origen: OrigenCajaSupuesta } | null {
  const m = claveAplastada(modelo || "");
  let delModelo: { total: number; pedido: string } | null = null;
  const frecuencia = new Map<number, number>();
  for (const c of corridas) {
    const tallas = (c.tallas ?? {}) as Record<string, number>;
    const total = Number(c.total) || Object.values(tallas).reduce((a: number, b: unknown) => a + Number(b), 0);
    if (!total) continue;
    const caja = paresPorCajaNormalizado(total);
    frecuencia.set(caja, (frecuencia.get(caja) ?? 0) + 1);
    const pedido = String(c.pedido ?? "");
    if (m && claveAplastada(String(c.modelo ?? "")) === m) {
      if (!delModelo || numeroDePedido(pedido) > numeroDePedido(delModelo.pedido)) delModelo = { total, pedido };
    }
  }
  if (delModelo) return { paresPorCaja: paresPorCajaNormalizado(delModelo.total), origen: "modelo" };
  // Un modelo que solo se ha pedido en cajas de UNA talla («SOLID SIZE 16
  // PRS», GT180 y GT181) no tiene corrida, pero sí caja: la del pedido más
  // reciente (dueño, 20-oct-2026: «ahora que está la orden confirmada, ¿se
  // aumenta en el sistema cuál es la corrida?»).
  let unitalla: CajaUnitalla | null = null;
  for (const u of unitallas) {
    if (!(u.paresPorCaja > 0) || !m || claveAplastada(u.modelo) !== m) continue;
    if (!unitalla || numeroDePedido(u.pedido) > numeroDePedido(unitalla.pedido)) unitalla = u;
  }
  if (unitalla) return { paresPorCaja: unitalla.paresPorCaja, origen: "unitalla" };
  let mejor: { caja: number; veces: number } | null = null;
  for (const [caja, veces] of frecuencia) {
    if (!mejor || veces > mejor.veces || (veces === mejor.veces && caja > mejor.caja)) mejor = { caja, veces };
  }
  return mejor ? { paresPorCaja: mejor.caja, origen: "estandar" } : null;
}

/** Las cajas de una sola talla de los pedidos cargados de la cuenta (pares por caja por modelo + color). */
export async function cajasUnitallaDePedidos(db: DB, accountId: string): Promise<CajaUnitalla[]> {
  // Las pruebas pasan un `db` de mentira sin tablas: sin cajas unitalla.
  if (typeof (db as { from?: unknown }).from !== "function") return [];
  const filas = await traerTodo<{
    modelo: string;
    color: string;
    talla: string | null;
    pares_por_caja: number | null;
    pedidos: { pedido: string } | { pedido: string }[] | null;
  }>(db, "pedido_lineas", "id, modelo, color, talla, pares_por_caja, pedidos!inner(pedido, account_id)", (q) =>
    q.eq("pedidos.account_id", accountId).not("talla", "is", null),
  );
  return filas
    .map((f) => {
      const p = Array.isArray(f.pedidos) ? f.pedidos[0] : f.pedidos;
      return { pedido: String(p?.pedido ?? ""), modelo: String(f.modelo ?? ""), color: String(f.color ?? ""), paresPorCaja: Number(f.pares_por_caja) || 0 };
    })
    .filter((u) => u.modelo && u.paresPorCaja > 0);
}

/**
 * Un SKU que no está en el catálogo de MELI (Amazon con `-MX`, un color ya
 * descontinuado) se parte con `desglosarSku`, que sabe de sufijos de sitio.
 * Antes se partía a mano y «GT100-MINT-23-MX» quedaba como color «MINT-23»
 * y talla «MX»: un grupo fantasma por talla, sin corrida.
 */
/**
 * La demanda de MELI que usa el pedido a China por talla: lo que vende
 * cuando TIENE stock (`engine/demanda-surtida.ts`); sin 14 días surtidos
 * en la ventana (producto nuevo, o agotado casi todo el tiempo), la demanda
 * del plan de Full, como antes. Decisión del dueño (11-oct-2026): «calcular
 * según el stock alto», sin ajustes a mano.
 */
export function demandaChinaDeLinea(l: { demandaDiaria: number; demandaSurtida?: number | null }): number {
  return l.demandaSurtida ?? l.demandaDiaria;
}

export function partesDeSkuSuelto(sku: string): { modelo: string; color: string; talla: string } {
  const d = desglosarSku(sku);
  return { modelo: d.modelo ?? sku, color: d.color ?? "", talla: d.talla ?? "" };
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
 * Una talla se separa como unitalla si sola justifica al menos
 * UNITALLA_MIN_CAJAS cajas. Lo que se va en unitalla se resta del faltante y
 * el resto se reparte en cajas de corrida con la proporción del faltante
 * restante.
 */
export function armarPedidoColor(
  faltantePorTalla: Record<string, number>,
  paresPorCaja: number,
  /**
   * El faltante con el stock descontado al 100%, que es el que decide las
   * cajas COMPLETAS de una talla. Si no se da, se usa el mismo faltante de
   * corrida (comportamiento previo).
   */
  faltanteExactoPorTalla: Record<string, number> = faltantePorTalla,
): {
  unitallas: { talla: string; cajas: number }[];
  cajasCorrida: number;
  corridaPropuesta: Record<string, number>;
} {
  const totalFaltante = Object.values(faltantePorTalla).reduce((a, b) => a + b, 0);
  if (totalFaltante <= 0 || paresPorCaja <= 0) {
    return { unitallas: [], cajasCorrida: 0, corridaPropuesta: {} };
  }

  const restante: Record<string, number> = { ...faltantePorTalla };
  const unitallas: { talla: string; cajas: number }[] = [];

  for (const talla of Object.keys(restante)) {
    // Las cajas de una sola talla se miden con el faltante EXACTO: es
    // caja completa, sin corrida que cuidar, y el número debe ser exacto.
    const exacto = faltanteExactoPorTalla[talla] ?? 0;
    if (Math.floor(exacto / paresPorCaja) >= UNITALLA_MIN_CAJAS) {
      // Una talla que va unitalla va SOLO unitalla (decisión del dueño,
      // 18-oct-2026: «muchas veces me pides del mismo modelo y talla caja
      // unitalla y caja de corrida; mejor dame solo unitalla»): su faltante
      // completo se redondea a cajas hacia arriba y sale de la corrida.
      unitallas.push({ talla, cajas: Math.ceil(exacto / paresPorCaja) });
      restante[talla] = 0;
    }
  }
  unitallas.sort((a, b) => Number(a.talla) - Number(b.talla));

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
/**
 * El número del pedido para saber cuál es más nuevo: el PRIMER grupo de
 * dígitos («IN10160» → 10160). Una corrida de caja de una talla se guarda
 * como «IN10057-24» (pedido-talla, como en el sheet): con todos los dígitos
 * pegados salía 1005724 y le ganaba a cualquier pedido posterior.
 */
export function numeroDePedido(pedido: string): number {
  const n = Number(pedido.match(/\d+/)?.[0] ?? "");
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
   * Amazon por SKU: su venta diaria (corregida por agotamiento, con la
   * observada de referencia) y su stock (FBA + en camino). El pedido a
   * China tiene que cubrir LOS DOS canales: pedir solo con la demanda de
   * MELI deja corto todo lo que también vende en Amazon.
   */
  amazonPorSku?: Map<string, { ventaDiaria: number; stock: number; ventaDiariaReal?: number }>,
  /**
   * TikTok por SKU: venta diaria OBSERVADA (sin corrección, regla del
   * dueño) y pares libres en su bodega. Tercer canal que surte el pedido.
   */
  tiktokPorSku?: Map<string, TikTokCompraSku>,
): Promise<SugerenciaCompra> {
  const p = { ...COMPRA_POR_DEFECTO, ...opciones };
  const ciclo = p.diasProduccion + p.diasTransito;
  const horizonte = ciclo + p.diasCobertura;

  // La página de pedidos ya leyó estas dos tablas para el inventario:
  // volver a pedirlas duplicaba los viajes a la base en cada clic.
  const [[corridasRaw, skusRaw], aliasColores, familias] = await Promise.all([
    precargado
      ? Promise.resolve([precargado.corridas, precargado.skus] as [any[], any[]])
      : Promise.all([
          traerTodo<any>(db, "corridas", "pedido, modelo, color, tallas, total", (q) =>
            q.eq("account_id", accountId),
          ),
          traerTodo<any>(db, "skus", "sku, modelo, color, talla", (q) =>
            q.eq("account_id", accountId).eq("activo", true),
          ),
        ]),
    // Colores del pedido ligados a mano con MELI: la receta se encuentra
    // también bajo el color de MELI.
    cargarAliasColores(db, accountId).catch(() => new Map() as MapaAlias),
    // Modelos que se piden JUNTOS (GT117…GT122 = un zapato en seis colores).
    cargarFamilias(db, accountId).catch(() => new Map() as MapaFamilias),
  ]);
  // Las cajas de UNA talla de los pedidos cargados: receta de respaldo para
  // el modelo que nunca se ha pedido en corrida.
  const unitallas = await cajasUnitallaDePedidos(db, accountId).catch(() => [] as CajaUnitalla[]);

  // La corrida más reciente de cada modelo+color es la que la fábrica usa
  // hoy, reconocible por todas sus escrituras (`clavesDeCorrida`).
  const corridaDe = indexarCorridas(corridasRaw, aliasColores);

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
    return partesDeSkuSuelto(sku);
  }

  // --- Agrupar por modelo + color -----------------------------------------
  interface Acumulado {
    modelo: string;
    color: string;
    skus: Set<string>;
    demandaDiaria: number;
    tallasConRespaldo: number;
    ventaMes: number;
    ventaMesReal: number;
    ventaMesAmazon: number;
    ventaMesRealAmazon: number;
    ventaMesTikTok: number;
    enFull: number;
    enTransferencia: number;
    enBodega: number;
    enCamino: number;
    enFba: number;
    enTikTok: number;
    demandaPorTalla: Map<string, number>;
    inventarioPorTalla: Map<string, number>;
  }

  const grupos = new Map<string, Acumulado>();

  // El detalle POR SKU que audita todo el cálculo: se llena con los mismos
  // tres recorridos que arman los grupos, así no puede divergir de ellos.
  const detalle = new Map<string, DetalleSkuCompra>();
  function filaDetalle(sku: string, modelo: string, color: string, talla: string): DetalleSkuCompra {
    const k = `${clave(modelo, color)}|${talla}`;
    let d = detalle.get(k);
    if (!d) {
      d = {
        sku,
        modelo: modelo.toUpperCase(),
        color: color.toUpperCase(),
        talla,
        ventaMesMeli: 0,
        ventaMesRealMeli: 0,
        ventaMesAmazon: 0,
        ventaMesRealAmazon: 0,
        ventaMesTikTok: 0,
        enFull: 0,
        enFba: 0,
        enTikTok: 0,
        enBodega: 0,
        deChina: 0,
        inventarioTotal: 0,
        faltante: 0,
      };
      detalle.set(k, d);
    }
    return d;
  }

  function grupo(modelo: string, color: string): Acumulado {
    const k = clave(modelo, color);
    let g = grupos.get(k);
    if (!g) {
      g = {
        modelo: modelo.toUpperCase(),
        color: color.toUpperCase(),
        skus: new Set(),
        demandaDiaria: 0,
        tallasConRespaldo: 0,
        ventaMes: 0,
        ventaMesReal: 0,
        ventaMesAmazon: 0,
        ventaMesRealAmazon: 0,
        ventaMesTikTok: 0,
        enFull: 0,
        enTransferencia: 0,
        enBodega: 0,
        enCamino: 0,
        enFba: 0,
        enTikTok: 0,
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
    // Lo que vende con stock; sin dato, la demanda del plan de Full.
    const demandaLinea = demandaChinaDeLinea(l);
    if (l.demandaSurtida == null) g.tallasConRespaldo += 1;
    g.demandaDiaria += demandaLinea;
    g.ventaMes += demandaLinea * 30;
    // Lo REALMENTE vendido en los últimos 30 días, sin corrección ni
    // tendencia: la referencia para que el usuario verifique cuánto está
    // estirando el cálculo. El promedio de 90 días (tasa observada × 30)
    // engañaba con los modelos en despegue: el GT110 vendió 1,348 pares el
    // último mes pero el promedio de la ventana decía 729, y la demanda
    // corregida se veía como un error cuando en realidad empataba con la
    // venta real. El plan cacheado viejo no trae `unidades30`: ahí se cae
    // al promedio de antes.
    const real30 = l.unidades30 ?? (l.tasaObservada ?? l.demandaDiaria) * 30;
    g.ventaMesReal += real30;
    if (talla) {
      g.demandaPorTalla.set(talla, (g.demandaPorTalla.get(talla) ?? 0) + demandaLinea);
    }

    const d = filaDetalle(l.sku, modelo, color, talla || "");
    d.sku = l.sku; // el nombre real de MELI gana sobre uno construido
    d.ventaMesMeli += demandaLinea * 30;
    d.ventaMesRealMeli += real30;
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

    const d = filaDetalle(sku, modelo, color, talla || "");
    d.enFull += inv.enFull + inv.enTransferencia;
    d.enBodega += inv.enBodega;
    d.deChina += inv.enCamino;
  }

  // Amazon: su demanda se SUMA a la de MELI y su stock cuenta como
  // inventario ya comprado. El pedido a China surte a los dos canales.
  for (const [sku, amz] of amazonPorSku ?? []) {
    const { modelo, color, talla } = partes(sku);
    const g = grupo(modelo, color);
    g.skus.add(sku);
    g.demandaDiaria += amz.ventaDiaria;
    g.ventaMesAmazon += amz.ventaDiaria * 30;
    g.ventaMesRealAmazon += (amz.ventaDiariaReal ?? amz.ventaDiaria) * 30;
    g.enFba += amz.stock;
    if (talla) {
      g.demandaPorTalla.set(talla, (g.demandaPorTalla.get(talla) ?? 0) + amz.ventaDiaria);
      g.inventarioPorTalla.set(talla, (g.inventarioPorTalla.get(talla) ?? 0) + amz.stock);
    }

    const d = filaDetalle(sku, modelo, color, talla || "");
    d.ventaMesAmazon += amz.ventaDiaria * 30;
    d.ventaMesRealAmazon += (amz.ventaDiariaReal ?? amz.ventaDiaria) * 30;
    d.enFba += amz.stock;
  }

  // TikTok: su venta OBSERVADA se suma a la demanda (sin corrección ni
  // tendencia, regla del dueño del 5-oct-2026: «no es predecible») y lo
  // libre en su bodega cuenta como inventario ya comprado.
  for (const [sku, tt] of tiktokPorSku ?? []) {
    const { modelo, color, talla } = partes(sku);
    const g = grupo(modelo, color);
    g.skus.add(sku);
    g.demandaDiaria += tt.ventaDiaria;
    g.ventaMesTikTok += tt.ventaDiaria * 30;
    g.enTikTok += tt.stock;
    if (talla) {
      g.demandaPorTalla.set(talla, (g.demandaPorTalla.get(talla) ?? 0) + tt.ventaDiaria);
      g.inventarioPorTalla.set(talla, (g.inventarioPorTalla.get(talla) ?? 0) + tt.stock);
    }

    const d = filaDetalle(sku, modelo, color, talla || "");
    d.ventaMesTikTok += tt.ventaDiaria * 30;
    d.enTikTok += tt.stock;
  }

  // El faltante por SKU, con la misma aritmética del pedido: venta total
  // (MELI corregida + Amazon + TikTok) sobre el horizonte, menos TODO el inventario.
  // Es la misma cuenta del Pedido 1, así que ambos deben cuadrar.
  const detalleSkus = [...detalle.values()]
    .map((d) => {
      d.ventaMesMeli = Math.round(d.ventaMesMeli);
      d.ventaMesRealMeli = Math.round(d.ventaMesRealMeli);
      d.ventaMesAmazon = Math.round(d.ventaMesAmazon);
      d.ventaMesRealAmazon = Math.round(d.ventaMesRealAmazon);
      d.ventaMesTikTok = Math.round(d.ventaMesTikTok);
      d.enFull = Math.round(d.enFull);
      d.enFba = Math.round(d.enFba);
      d.enTikTok = Math.round(d.enTikTok);
      d.enBodega = Math.round(d.enBodega);
      d.deChina = Math.round(d.deChina);
      d.inventarioTotal = d.enFull + d.enFba + d.enTikTok + d.enBodega + d.deChina;
      d.faltante = Math.max(
        0,
        Math.round(((d.ventaMesMeli + d.ventaMesAmazon + d.ventaMesTikTok) / 30) * horizonte - d.inventarioTotal),
      );
      return d;
    })
    .sort(
      (a, b) =>
        a.modelo.localeCompare(b.modelo) ||
        a.color.localeCompare(b.color) ||
        Number(a.talla) - Number(b.talla),
    );

  // --- Un renglón por grupo ------------------------------------------------
  const renglones: RenglonCompra[] = [];
  const hoy = new Date();

  for (const g of grupos.values()) {
    const inventarioTotal = g.enFull + g.enTransferencia + g.enBodega + g.enCamino + g.enFba + g.enTikTok;
    const demanda = g.demandaDiaria;

    if (demanda < p.ventaMinimaDiaria && inventarioTotal === 0) continue;

    const cobertura = demanda > 0 ? inventarioTotal / demanda : null;
    const fechaQuiebre =
      cobertura !== null && cobertura < 400
        ? new Date(hoy.getTime() + cobertura * 86400000).toISOString().slice(0, 10)
        : null;

    const objetivo = demanda * horizonte;
    const faltante = Math.max(0, objetivo - inventarioTotal);

    const c = buscarCorrida(corridaDe, g.modelo, g.color);
    // La fábrica solo arma cajas de 12/24/36/48: el total histórico se lleva
    // al tamaño real más cercano (la corrida interna cambia, el total no).
    // Sin receta de este color, la caja del modelo en otro color o la
    // estándar de la fábrica (`cajaDeRespaldo`): la proforma no hace falta
    // para decir cuántas cajas son.
    const respaldo = c ? null : cajaDeRespaldo(corridasRaw, g.modelo, unitallas);
    const paresPorCaja = c ? paresPorCajaNormalizado(c.total) : (respaldo?.paresPorCaja ?? null);

    // El faltante por talla, exacto: demanda del horizonte menos el stock
    // completo de esa talla.
    // OJO: la puerta del pedido es el faltante POR TALLA, no el agregado. El
    // agregado engaña: 500 pares de sobra en la 29 "tapan" el faltante de la
    // 25, y el color se quedaba sin pedir justo lo que se le agotó.
    const {
      regimen,
      faltantePorTalla,
      faltanteExactoPorTalla,
    } = faltantesPorRegimen({
      demandaPorTalla: g.demandaPorTalla,
      inventarioPorTalla: g.inventarioPorTalla,
      horizonte,
      coberturaDias: cobertura,
      umbralAgotamientoDias: p.umbralAgotamientoDias,
    });

    const totalFaltanteTallas = Object.values(faltantePorTalla).reduce((a, b) => a + b, 0);
    // El umbral de venta mínima APAGA el pedido, no solo el texto: antes un
    // modelo con el motivo "no conviene volver a pedirlo" igual sumaba cajas.
    const valeLaPena = demanda >= p.ventaMinimaDiaria;
    const pedido =
      valeLaPena && totalFaltanteTallas > 0 && paresPorCaja && paresPorCaja > 0
        ? armarPedidoColor(faltantePorTalla, paresPorCaja, faltanteExactoPorTalla)
        : { unitallas: [], cajasCorrida: 0, corridaPropuesta: {} };

    const cajasSugeridas =
      pedido.cajasCorrida + pedido.unitallas.reduce((a, u) => a + u.cajas, 0);

    // Opción 2 del Excel: pedir SOLO según la venta del horizonte, sin
    // descontar inventario. La demanda por talla ya trae la corrección por
    // agotamientos, así que una talla que no vendió por estar en cero SÍ
    // suma lo que habría vendido.
    const demandaHorizonte: Record<string, number> = {};
    for (const [t, d] of g.demandaPorTalla) {
      const v = Math.round(d * horizonte);
      if (v > 0) demandaHorizonte[t] = v;
    }
    const totalSoloVenta = Object.values(demandaHorizonte).reduce((a, b) => a + b, 0);
    const pedidoSoloVenta =
      valeLaPena && totalSoloVenta > 0 && paresPorCaja && paresPorCaja > 0
        ? armarPedidoColor(demandaHorizonte, paresPorCaja, demandaHorizonte)
        : { unitallas: [], cajasCorrida: 0, corridaPropuesta: {} };
    const cajasSoloVenta =
      pedidoSoloVenta.cajasCorrida +
      pedidoSoloVenta.unitallas.reduce((a, u) => a + u.cajas, 0);

    const urgencia = urgenciaDe(cobertura, ciclo);

    let motivo: string;
    if (demanda < p.ventaMinimaDiaria) {
      motivo = `Casi no se vende (${(demanda * 30).toFixed(1)} pares al mes). No conviene volver a pedirlo.`;
    } else if (totalFaltanteTallas <= 0) {
      motivo = `Con ${Math.round(inventarioTotal)} pares aguanta ${Math.round(cobertura ?? 0)} días; el ciclo completo son ${horizonte}. No hace falta pedir.`;
    } else if (!paresPorCaja) {
      motivo = `Faltan ${Math.round(totalFaltanteTallas)} pares por talla, pero no hay ninguna receta cargada en la cuenta, así que no puedo decir cuántas cajas son.`;
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
    if (respaldo && paresPorCaja) {
      motivo += ` No hay receta de este color: se supone la caja de ${paresPorCaja} pares ${
        respaldo.origen === "modelo"
          ? "del mismo modelo en otro color"
          : respaldo.origen === "unitalla"
            ? "de una sola talla con que se ha pedido este modelo"
            : "estándar de tus pedidos"
      } y la corrida va propuesta por venta.`;
    }
    if (g.tallasConRespaldo > 0 && g.skus.size > 0) {
      motivo += ` ${g.tallasConRespaldo} de ${g.skus.size} tallas no llevan 14 días surtidas en la ventana: usan la demanda del plan de Full.`;
    }
    if (cajasSugeridas > 0) {
      motivo +=
        regimen === "se_agota"
          ? ` El stock actual se agota antes de que llegue (cobertura < ${p.umbralAgotamientoDias} días); se pide el faltante exacto de cada talla.`
          : ` Se pide el faltante exacto de cada talla: demanda del horizonte menos todo el stock.`;
    }

    renglones.push({
      modelo: g.modelo,
      color: g.color,
      familia: familiaDe(familias, g.modelo),
      tallas: g.skus.size,
      demandaDiaria: Number(demanda.toFixed(3)),
      tallasConRespaldo: g.tallasConRespaldo,
      ventaMes: Math.round(g.ventaMes),
      ventaMesReal: Math.round(g.ventaMesReal),
      ventaMesAmazon: Math.round(g.ventaMesAmazon),
      ventaMesRealAmazon: Math.round(g.ventaMesRealAmazon),
      ventaMesTikTok: Math.round(g.ventaMesTikTok),
      enFull: Math.round(g.enFull),
      enTransferencia: Math.round(g.enTransferencia),
      enBodega: Math.round(g.enBodega),
      enCamino: Math.round(g.enCamino),
      enFba: Math.round(g.enFba),
      enTikTok: Math.round(g.enTikTok),
      inventarioTotal: Math.round(inventarioTotal),
      coberturaDias: cobertura === null ? null : Number(cobertura.toFixed(1)),
      fechaQuiebre,
      objetivo: Math.round(objetivo),
      faltante: Math.round(faltante),
      paresPorCaja,
      cajasSugeridas,
      paresSugeridos: cajasSugeridas * (paresPorCaja ?? 0),
      tieneCorrida: Boolean(c),
      cajaSupuesta: respaldo?.origen ?? null,
      corridaPedido: c?.pedido ?? null,
      urgencia,
      regimen,
      desajusteCorrida: c ? compararCorrida(c.tallas, g.demandaPorTalla) : [],
      motivo,
      corridaPropuesta: Object.keys(pedido.corridaPropuesta).length
        ? pedido.corridaPropuesta
        : null,
      cajasCorrida: pedido.cajasCorrida,
      unitallas: pedido.unitallas,
      faltantePorTalla,
      soloVenta: {
        cajas: cajasSoloVenta,
        pares: cajasSoloVenta * (paresPorCaja ?? 0),
        cajasCorrida: pedidoSoloVenta.cajasCorrida,
        unitallas: pedidoSoloVenta.unitallas,
        corridaPropuesta: Object.keys(pedidoSoloVenta.corridaPropuesta).length
          ? pedidoSoloVenta.corridaPropuesta
          : null,
        demandaPorTalla: demandaHorizonte,
      },
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
    detalleSkus,
    parametros: p,
    totales: {
      modelos: renglones.length,
      modelosAPedir: aPedir.length,
      cajas: aPedir.reduce((a, r) => a + r.cajasSugeridas, 0),
      pares: aPedir.reduce((a, r) => a + r.paresSugeridos, 0),
      enQuiebre: renglones.filter((r) => r.urgencia === "quiebre" || r.urgencia === "urgente").length,
      sinCorrida: renglones.filter((r) => Object.keys(r.faltantePorTalla).length > 0 && !r.paresPorCaja).length,
      conCajaSupuesta: renglones.filter((r) => Object.keys(r.faltantePorTalla).length > 0 && r.cajaSupuesta).length,
    },
  };
}
