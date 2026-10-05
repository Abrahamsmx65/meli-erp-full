/**
 * Corte por MODELO (pedido del dueño, 5-oct-2026: «quiero poder despachar
 * modelos que tienen muchas ventas por separado; el GT148 va a tener como
 * 2,000 ventas, y los demás modelos por separado»).
 *
 * Un corte puede nacer con un filtro de modelos. Entra al corte un pedido
 * cuyos pares son TODOS de UN solo modelo y ese modelo está en el filtro;
 * un paquete revuelto (GT148 + GT114 en la misma caja) se va con el corte
 * general, decisión del dueño. Motor puro: recibe los renglones de cada
 * pedido ya leídos.
 */

import { partirSku } from "./despacho";

export interface RenglonDeModelo {
  sku: string;
  cantidad: number;
}

/** El modelo de un SKU del kardex (GT148-CREAM-24-MX → GT148), en mayúsculas. */
export function modeloDelSku(sku: string): string {
  return partirSku(sku).modelo.trim().toUpperCase();
}

/** Limpia y ordena un filtro de modelos; vacío = sin filtro. */
export function normalizarModelos(modelos: unknown): string[] {
  if (!Array.isArray(modelos)) return [];
  const limpios = modelos
    .map((m) => String(m ?? "").trim().toUpperCase())
    .filter((m) => /^[A-Z0-9][A-Z0-9-]{0,30}$/.test(m));
  return [...new Set(limpios)].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
}

/** Los modelos distintos de un pedido; un renglón sin SKU del ERP ("(sin SKU)") cuenta como modelo vacío. */
export function modelosDelPedido(renglones: RenglonDeModelo[]): string[] {
  const vistos = new Set<string>();
  for (const r of renglones ?? []) {
    const sku = String(r.sku ?? "");
    vistos.add(sku.startsWith("(") ? "" : modeloDelSku(sku));
  }
  return [...vistos];
}

/**
 * Qué pedidos entran a un corte con filtro: los de UN solo modelo que esté
 * en la lista. Sin filtro (lista vacía) entran todos.
 */
export function pedidosDeSoloModelos(renglonesPorPedido: Map<string, RenglonDeModelo[]>, modelos: string[]): Set<string> {
  const filtro = new Set(normalizarModelos(modelos));
  const salida = new Set<string>();
  for (const [orderId, renglones] of renglonesPorPedido) {
    if (!filtro.size) {
      salida.add(orderId);
      continue;
    }
    const m = modelosDelPedido(renglones);
    if (m.length === 1 && m[0] && filtro.has(m[0])) salida.add(orderId);
  }
  return salida;
}

export interface ResumenModeloPendiente {
  modelo: string;
  pedidos: number;
  pares: number;
}

export interface PendientesPorModelo {
  /** pedidos de UN solo modelo, por modelo, de mayor a menor */
  modelos: ResumenModeloPendiente[];
  /** pedidos con más de un modelo: siempre van con el corte general */
  revueltos: { pedidos: number; pares: number };
  /** pedidos sin ningún SKU reconocido */
  sinSku: number;
}

/** Cuántos pedidos pendientes son de un solo modelo, por modelo: lo que enseña el selector. */
export function pendientesPorModelo(renglonesPorPedido: Map<string, RenglonDeModelo[]>): PendientesPorModelo {
  const porModelo = new Map<string, ResumenModeloPendiente>();
  const revueltos = { pedidos: 0, pares: 0 };
  let sinSku = 0;
  for (const renglones of renglonesPorPedido.values()) {
    const m = modelosDelPedido(renglones);
    const pares = (renglones ?? []).reduce((a, r) => a + (Number(r.cantidad) || 0), 0);
    if (m.length === 1 && m[0]) {
      const f = porModelo.get(m[0]) ?? { modelo: m[0], pedidos: 0, pares: 0 };
      f.pedidos += 1;
      f.pares += pares;
      porModelo.set(m[0], f);
    } else if (m.length === 1) {
      sinSku += 1;
    } else {
      revueltos.pedidos += 1;
      revueltos.pares += pares;
    }
  }
  return {
    modelos: [...porModelo.values()].sort((a, b) => b.pedidos - a.pedidos || a.modelo.localeCompare(b.modelo, "es", { numeric: true })),
    revueltos,
    sinSku,
  };
}

/** Cómo se nombra el filtro de un corte: «solo GT148», «solo GT114 y GT148». */
export function etiquetaDeModelos(modelos: string[] | null | undefined): string | null {
  const m = normalizarModelos(modelos);
  if (!m.length) return null;
  if (m.length === 1) return `solo ${m[0]}`;
  return `solo ${m.slice(0, -1).join(", ")} y ${m[m.length - 1]}`;
}

/** Dos filtros son el mismo corte: misma lista (o los dos sin filtro). */
export function mismoFiltro(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  const x = normalizarModelos(a);
  const y = normalizarModelos(b);
  return x.length === y.length && x.every((m, i) => m === y[i]);
}
