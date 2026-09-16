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
 * le alcance la existencia. **Lo que ninguna bodega tiene NO se pide**
 * (decisión del dueño, 16-sep-2026: «si no hay en mi bodega no lo pides y
 * no sale en el Excel»): el pedido se topa por la existencia, un SKU sin
 * nada en bodega no entra como renglón y solo se cuenta en `sinBodega`
 * para que se sepa cuánta venta se quedó sin reponer. Las bodegas guardan
 * cajas cerradas (corridas): esta hoja pide PARES por talla y la bodega
 * elige las cajas con que los cubre. Lo que viene de China no cuenta:
 * todavía no está aquí.
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
  /** lo que se querría reponer, antes de topar por la existencia */
  deseado: number;
  /** pares a pedir: lo deseado topado por lo que hay en las bodegas */
  pedir: number;
  /** existencia por bodega de cajas (solo México, sin China) */
  existencia: SurtidoDeBodega[];
  /** de qué bodega sale cada par del pedido */
  surtir: SurtidoDeBodega[];
  /** lo deseado que ninguna bodega alcanza a cubrir (no se pide) */
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
    /** SKUs que sí se piden (con algo en bodega) */
    skus: number;
    /** pares vendidos en el periodo, de todos los SKUs */
    vendidos: number;
    pedir: number;
    /** lo deseado que no se pide porque ninguna bodega lo tiene */
    faltante: number;
    porBodega: SurtidoDeBodega[];
  };
  /** SKUs vendidos que no entran al pedido porque no hay nada en bodega */
  sinBodega: { skus: number; pares: number; lista: string[] };
}

function esBodegaDeMexico(almacen: string): boolean {
  return (ORDEN_BODEGAS as readonly string[]).includes(almacen);
}

/**
 * Arma el pedido. Entra un renglón por SKU que vendió en el periodo Y que
 * alguna bodega puede surtir, aunque sea en parte; lo que no vendió, lo
 * que ya está cubierto y lo que ninguna bodega tiene no aparece (esto
 * último se cuenta en `sinBodega`).
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
  const porModeloMapa = new Map<string, ResumenModelo>();
  const sinBodega = { skus: 0, pares: 0, lista: [] as string[] };
  let faltanteTotal = 0;
  let vendidosTotal = 0;

  for (const [sku, unidades] of vendidos) {
    vendidosTotal += unidades;
    const k = kardex.get(sku);
    const saldo = k?.saldo ?? 0;
    const apartado = k?.apartado ?? 0;
    const disponible = Math.max(0, saldo - apartado);
    const ventaDiaria = unidades / dias;
    const diasCobertura = ventaDiaria > 0 ? disponible / ventaDiaria : null;

    const deseado =
      modo === "vendido" ? unidades : Math.max(0, Math.ceil(ventaDiaria * (diasObjetivo ?? DIAS_COBERTURA)) - disponible);

    const porBodega = existencia.get(sku) ?? new Map<string, number>();
    const existenciaLista: SurtidoDeBodega[] = ORDEN_BODEGAS.map((almacen) => ({
      almacen,
      pares: porBodega.get(almacen) ?? 0,
    }));

    // Se surte en orden de bodega hasta donde alcance cada una; lo que
    // ninguna tiene no se pide.
    let resto = deseado;
    const surtir: SurtidoDeBodega[] = [];
    for (const almacen of ORDEN_BODEGAS) {
      const hay = porBodega.get(almacen) ?? 0;
      const toma = Math.min(resto, hay);
      surtir.push({ almacen, pares: toma });
      resto -= toma;
    }
    const pedir = deseado - resto;
    faltanteTotal += resto;

    const partes = partirSku(sku);
    const m = porModeloMapa.get(partes.modelo) ?? { modelo: partes.modelo, vendidos: 0, pedir: 0, faltante: 0, skus: 0 };
    m.vendidos += unidades;
    m.pedir += pedir;
    m.faltante += resto;
    porModeloMapa.set(partes.modelo, m);

    if (pedir <= 0) {
      // Vendió, pero no hay de dónde reponerlo: se declara, no se pide.
      if (deseado > 0) {
        sinBodega.skus += 1;
        sinBodega.pares += deseado;
        sinBodega.lista.push(sku);
      }
      continue;
    }
    m.skus += 1;

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
      deseado,
      pedir,
      existencia: existenciaLista,
      surtir,
      faltante: resto,
    });
  }

  renglones.sort((a, b) => compararSku(a.sku, b.sku));
  sinBodega.lista.sort((a, b) => compararSku(a, b));
  // Un modelo del que no se pide nada no va al resumen del pedido.
  for (const [modelo, m] of porModeloMapa) if (m.pedir <= 0) porModeloMapa.delete(modelo);

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
      vendidos: vendidosTotal,
      pedir: renglones.reduce((a, r) => a + r.pedir, 0),
      faltante: faltanteTotal,
      porBodega,
    },
    sinBodega,
  };
}
