/**
 * El PEDIDO DE ALMACÉN de TikTok: qué reponerle a la bodega de TikTok desde
 * las bodegas de cajas (Industher, Caseshop, EnvioPack).
 *
 * La bodega de TikTok se vacía con lo que se vende y hay que rellenarla.
 * El pedido junta lo VENDIDO en un periodo por modelo, color y talla, mira
 * cuánto queda en el kardex de TikTok, decide cuánto PEDIR y de QUÉ bodega
 * surtirlo. Pedido del dueño el 16-sep-2026: «pedir de EnvioPack y de
 * Industher lo que se va vendiendo para mandarlo a la bodega de TikTok».
 *
 * Dos formas de pedir, elegidas al armar el pedido:
 *   · "vendido": se repone lo que se vendió en el periodo, par por par.
 *     Es la de todos los días: la bodega se queda como estaba.
 *   · "cobertura": se pide lo que falte para que el DISPONIBLE alcance N
 *     días de venta (venta diaria del periodo × N − disponible). Sirve
 *     cuando un modelo arranca y reponer lo vendido se queda corto.
 *
 * De dónde se surte: primero Industher (la bodega de TikTok vive ahí, es un
 * traspaso interno), luego Caseshop, luego EnvioPack; cada una hasta donde
 * le alcance la existencia y lo que no alcance se declara como FALTANTE,
 * nunca se esconde. Las bodegas guardan cajas cerradas (corridas): esta
 * hoja pide PARES por talla y la bodega elige las cajas con que los cubre.
 * Lo que viene de China no cuenta: todavía no está aquí.
 */
import { compararSku, partirSku } from "./despacho";

export type ModoPedido = "vendido" | "cobertura";

/** De qué bodega se surte primero. */
export const ORDEN_BODEGAS = ["Industher", "Caseshop", "EnvioPack"] as const;

/** Días de cobertura por omisión en el modo "cobertura". */
export const DIAS_COBERTURA = 15;

export interface VentaPeriodo {
  sku: string;
  unidades: number;
}

export interface ExistenciaBodega {
  sku: string;
  almacen: string;
  pares: number;
}

export interface KardexTikTok {
  sku: string;
  saldo: number;
  apartado: number;
}

export interface SurtidoDeBodega {
  almacen: string;
  pares: number;
}

export interface RenglonPedidoAlmacen {
  sku: string;
  modelo: string;
  color: string;
  talla: string;
  /** pares vendidos en el periodo */
  vendidos: number;
  /** vendidos ÷ días del periodo */
  ventaDiaria: number;
  /** kardex de TikTok */
  saldo: number;
  apartado: number;
  disponible: number;
  /** disponible ÷ venta diaria; null sin venta */
  diasCobertura: number | null;
  /** pares a pedir */
  pedir: number;
  /** existencia por bodega de cajas (solo México, sin China) */
  existencia: SurtidoDeBodega[];
  /** de qué bodega sale cada par del pedido */
  surtir: SurtidoDeBodega[];
  /** lo que ninguna bodega alcanza a cubrir */
  faltante: number;
}

export interface ResumenModelo {
  modelo: string;
  vendidos: number;
  pedir: number;
  faltante: number;
  skus: number;
}

export interface PedidoAlmacen {
  modo: ModoPedido;
  /** días del periodo de venta */
  dias: number;
  /** días objetivo (solo modo cobertura) */
  diasObjetivo: number | null;
  renglones: RenglonPedidoAlmacen[];
  porModelo: ResumenModelo[];
  totales: {
    skus: number;
    vendidos: number;
    pedir: number;
    faltante: number;
    porBodega: SurtidoDeBodega[];
  };
}

function esBodegaDeMexico(almacen: string): boolean {
  return (ORDEN_BODEGAS as readonly string[]).includes(almacen);
}

/**
 * Arma el pedido. Entra un renglón por SKU que vendió en el periodo o que
 * tiene algo que pedir; lo que no vendió y está cubierto no aparece.
 */
export function armarPedidoAlmacen(entrada: {
  ventas: VentaPeriodo[];
  existencias: ExistenciaBodega[];
  kardex: KardexTikTok[];
  dias: number;
  modo: ModoPedido;
  diasObjetivo?: number;
}): PedidoAlmacen {
  const dias = Math.max(1, Math.round(entrada.dias));
  const modo = entrada.modo;
  const diasObjetivo = modo === "cobertura" ? Math.max(1, Math.round(entrada.diasObjetivo ?? DIAS_COBERTURA)) : null;

  const vendidos = new Map<string, number>();
  for (const v of entrada.ventas) {
    if (!v.sku || !(v.unidades > 0)) continue;
    vendidos.set(v.sku, (vendidos.get(v.sku) ?? 0) + v.unidades);
  }

  const existencia = new Map<string, Map<string, number>>();
  for (const e of entrada.existencias) {
    if (!e.sku || !esBodegaDeMexico(e.almacen) || !(e.pares > 0)) continue;
    const porBodega = existencia.get(e.sku) ?? new Map<string, number>();
    porBodega.set(e.almacen, (porBodega.get(e.almacen) ?? 0) + e.pares);
    existencia.set(e.sku, porBodega);
  }

  const kardex = new Map<string, KardexTikTok>();
  for (const k of entrada.kardex) if (k.sku) kardex.set(k.sku, k);

  const renglones: RenglonPedidoAlmacen[] = [];
  for (const [sku, unidades] of vendidos) {
    const k = kardex.get(sku);
    const saldo = k?.saldo ?? 0;
    const apartado = k?.apartado ?? 0;
    const disponible = Math.max(0, saldo - apartado);
    const ventaDiaria = unidades / dias;
    const diasCobertura = ventaDiaria > 0 ? disponible / ventaDiaria : null;

    const pedir =
      modo === "vendido" ? unidades : Math.max(0, Math.ceil(ventaDiaria * (diasObjetivo ?? DIAS_COBERTURA)) - disponible);

    const porBodega = existencia.get(sku) ?? new Map<string, number>();
    const existenciaLista: SurtidoDeBodega[] = ORDEN_BODEGAS.map((almacen) => ({
      almacen,
      pares: porBodega.get(almacen) ?? 0,
    }));

    // Se surte en orden de bodega hasta donde alcance cada una.
    let resto = pedir;
    const surtir: SurtidoDeBodega[] = [];
    for (const almacen of ORDEN_BODEGAS) {
      const hay = porBodega.get(almacen) ?? 0;
      const toma = Math.min(resto, hay);
      surtir.push({ almacen, pares: toma });
      resto -= toma;
    }

    const partes = partirSku(sku);
    renglones.push({
      sku,
      modelo: partes.modelo,
      color: partes.color,
      talla: partes.talla,
      vendidos: unidades,
      ventaDiaria,
      saldo,
      apartado,
      disponible,
      diasCobertura,
      pedir,
      existencia: existenciaLista,
      surtir,
      faltante: resto,
    });
  }

  renglones.sort((a, b) => compararSku(a.sku, b.sku));

  const porModeloMapa = new Map<string, ResumenModelo>();
  for (const r of renglones) {
    const m = porModeloMapa.get(r.modelo) ?? { modelo: r.modelo, vendidos: 0, pedir: 0, faltante: 0, skus: 0 };
    m.vendidos += r.vendidos;
    m.pedir += r.pedir;
    m.faltante += r.faltante;
    m.skus += 1;
    porModeloMapa.set(r.modelo, m);
  }

  const porBodega: SurtidoDeBodega[] = ORDEN_BODEGAS.map((almacen) => ({
    almacen,
    pares: renglones.reduce((a, r) => a + (r.surtir.find((s) => s.almacen === almacen)?.pares ?? 0), 0),
  }));

  return {
    modo,
    dias,
    diasObjetivo,
    renglones,
    porModelo: [...porModeloMapa.values()].sort((a, b) => a.modelo.localeCompare(b.modelo, "es")),
    totales: {
      skus: renglones.length,
      vendidos: renglones.reduce((a, r) => a + r.vendidos, 0),
      pedir: renglones.reduce((a, r) => a + r.pedir, 0),
      faltante: renglones.reduce((a, r) => a + r.faltante, 0),
      porBodega,
    },
  };
}
