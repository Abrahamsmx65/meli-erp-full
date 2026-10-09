/**
 * LOTES del corte: muchos paquetes iguales de UN par del mismo SKU.
 *
 * Pedido del dueño (8-oct-2026): «cuando hay que mandar muchos productos
 * de 1 unidad del mismo SKU, que sea más fácil y manejable». Como el corte
 * ya va modelo → color → talla, esos paquetes salen SEGUIDOS en la
 * numeración; aquí se reconocen como un LOTE (desde `PAQUETES_POR_LOTE_MIN`
 * paquetes iguales) para que la lista de empaque los enseñe como un solo
 * bloque, las guías salgan con una hoja separadora delante y la estación
 * los prepare en MODO LOTE: la caja se escanea una vez al abrir el lote y
 * de ahí en adelante solo el código del pedido de cada guía conforme se
 * pega. Como todas las cajas del lote son iguales, no importa qué guía cae
 * en qué caja. Motor puro.
 */
import { codigosDeProducto } from "./codigos";
import type { PaqueteNumerado } from "./despacho";

/** Desde cuántos paquetes iguales seguidos se forma un lote. */
export const PAQUETES_POR_LOTE_MIN = 10;

export interface Lote {
  sku: string;
  /** primer y último "#n" del lote (seguidos) */
  desde: number;
  hasta: number;
  cantidad: number;
  numeros: number[];
  /** los códigos que dan por bueno el producto (FNSKU y códigos Full de MELI) */
  codigos: string[];
}

/** ¿El paquete es de UN par de UN SKU? Solo esos forman lote. */
export function esPaqueteDeLote(p: Pick<PaqueteNumerado, "pares">): boolean {
  return p.pares.length === 1 && p.pares[0].pares === 1;
}

/**
 * Los lotes del corte: corridas de paquetes SEGUIDOS (en el orden del
 * corte) de un par del mismo SKU, con al menos `minimo` paquetes. Un
 * paquete cancelado corta la corrida: ya no se empaca.
 */
export function detectarLotes(paquetes: PaqueteNumerado[], minimo = PAQUETES_POR_LOTE_MIN): Lote[] {
  const lotes: Lote[] = [];
  let actual: PaqueteNumerado[] = [];
  const cerrar = () => {
    if (actual.length >= minimo) {
      const primero = actual[0];
      lotes.push({
        sku: primero.pares[0].sku,
        desde: primero.numero,
        hasta: actual[actual.length - 1].numero,
        cantidad: actual.length,
        numeros: actual.map((p) => p.numero),
        codigos: codigosDeProducto(primero.pares[0]),
      });
    }
    actual = [];
  };
  for (const p of paquetes) {
    const sigue = esPaqueteDeLote(p) && !p.cancelado && (!actual.length || actual[0].pares[0].sku === p.pares[0].sku);
    if (!sigue) {
      cerrar();
      if (esPaqueteDeLote(p) && !p.cancelado) actual = [p];
      continue;
    }
    actual.push(p);
  }
  cerrar();
  return lotes;
}

/** El lote al que pertenece un "#n", si alguno. */
export function loteDePaquete(lotes: Lote[], numero: number): Lote | null {
  return lotes.find((l) => numero >= l.desde && numero <= l.hasta) ?? null;
}

/** Cuántos paquetes del lote ya están preparados. */
export function avanceDeLote(lote: Lote, yaPreparados: Set<number>): { hechos: number; total: number } {
  return { hechos: lote.numeros.filter((n) => yaPreparados.has(n)).length, total: lote.cantidad };
}

/**
 * El lote que abre un código de producto: el primero (en el orden del
 * corte) cuyo producto lleva ese código y al que todavía le faltan
 * paquetes por preparar. Sin lote, el escaneo sigue su camino normal.
 */
export function loteDeCodigo(lotes: Lote[], codigo: string, yaPreparados: Set<number>): Lote | null {
  const c = String(codigo ?? "").trim().toUpperCase();
  if (!c) return null;
  return lotes.find((l) => l.codigos.includes(c) && avanceDeLote(l, yaPreparados).hechos < l.cantidad) ?? null;
}

/** "LOTE · GT148-BLK-24-MX · 68 paquetes · #120–#187" */
export function textoDeLote(l: Lote): string {
  return `LOTE · ${l.sku} · ${l.cantidad} paquetes · #${l.desde}–#${l.hasta}`;
}
