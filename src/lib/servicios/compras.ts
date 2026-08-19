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

export interface RenglonCompra {
  modelo: string;
  color: string;
  /** cuántos SKUs (tallas) componen este modelo+color */
  tallas: number;
  demandaDiaria: number;
  /** ventas de los últimos 30 días, para contrastar contra la demanda corregida */
  ventaMes: number;
  enFull: number;
  enTransferencia: number;
  enBodega: number;
  enCamino: number;
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
    if (!previa || String(c.pedido ?? "") > previa.pedido) {
      corridaDe.set(k, { tallas: c.tallas ?? {}, total, pedido: String(c.pedido ?? "") });
    }
  }

  // Cómo se descompone cada SKU. Se prefiere el catálogo; si un SKU no está
  // ahí, se parte por guiones (GT104-BLK-25).
  const infoSku = new Map(skusRaw.map((s) => [s.sku, s]));

  function partes(sku: string): { modelo: string; color: string; talla: string } {
    const i = infoSku.get(sku);
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
    enFull: number;
    enTransferencia: number;
    enBodega: number;
    enCamino: number;
    demandaPorTalla: Map<string, number>;
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
        enFull: 0,
        enTransferencia: 0,
        enBodega: 0,
        enCamino: 0,
        demandaPorTalla: new Map(),
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
    const { modelo, color } = partes(sku);
    const g = grupo(modelo, color);
    g.skus.add(sku);
    g.enFull += inv.enFull;
    g.enTransferencia += inv.enTransferencia;
    g.enBodega += inv.enBodega;
    g.enCamino += inv.enCamino;
  }

  // --- Un renglón por grupo ------------------------------------------------
  const renglones: RenglonCompra[] = [];
  const hoy = new Date();

  for (const g of grupos.values()) {
    const inventarioTotal = g.enFull + g.enTransferencia + g.enBodega + g.enCamino;
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
    const cajasSugeridas =
      faltante > 0 && paresPorCaja && paresPorCaja > 0 ? Math.ceil(faltante / paresPorCaja) : 0;

    const urgencia = urgenciaDe(cobertura, ciclo);

    let motivo: string;
    if (demanda < p.ventaMinimaDiaria) {
      motivo = `Casi no se vende (${(demanda * 30).toFixed(1)} pares al mes). No conviene volver a pedirlo.`;
    } else if (faltante <= 0) {
      motivo = `Con ${Math.round(inventarioTotal)} pares aguanta ${Math.round(cobertura ?? 0)} días; el ciclo completo son ${horizonte}. No hace falta pedir.`;
    } else if (!paresPorCaja) {
      motivo = `Faltan ${Math.round(faltante)} pares, pero no hay corrida cargada para este modelo+color, así que no puedo decir cuántas cajas son.`;
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
      enFull: Math.round(g.enFull),
      enTransferencia: Math.round(g.enTransferencia),
      enBodega: Math.round(g.enBodega),
      enCamino: Math.round(g.enCamino),
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
      sinCorrida: renglones.filter((r) => r.faltante > 0 && !r.tieneCorrida).length,
    },
  };
}
