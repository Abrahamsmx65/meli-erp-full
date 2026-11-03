/**
 * COLCHÓN DE SUBIDA (dueño con Daniel, 21-oct-2026, revisando GT156 BLK y
 * GT150 M BROWN del envío MELI-121): Daniel manda «un poco de más» cuando
 * un modelo + color va en subida por temporada, sin fecha ni meta exacta,
 * para que no se caiga la venta. La regla:
 *
 *  - Se mide por PRODUCTO (modelo + color): la suma de lo que venden sus
 *    tallas en las últimas `colchonVentanaDias` (14, sin hoy, que va a
 *    medias), cada talla entre sus días CON stock, contra la venta diaria
 *    que el plan usa para esas mismas tallas.
 *  - Si eso es al menos `colchonSubidaFactor` (1.2 veces; era 1.3 y se bajó
 *    el mismo día para que entraran GT205 NAVY y GT229 DK BROWN), el producto va
 *    en subida: el factor (SIN el tope de +50 % de la tendencia) multiplica
 *    la venta diaria de todas sus tallas.
 *
 * El objetivo de 45 días y el tope del color (60 días) los aplica
 * `generarPlan`. Solo cuentan las tallas con al menos la mitad de la
 * ventana con stock, y hacen falta 10 pares en la ventana: una talla
 * agotada casi todo el periodo o un modelo de 3 pares no dicen nada.
 */
import type { DemandaSku, DiaStock, Parametros, SkuOverride } from "./types";

const EPS = 1e-9;
const PARES_MINIMOS = 10;

/** producto → factor (≥ colchonSubidaFactor) para los que van en subida */
export function colchonDeSubida(
  productoDeSku: Map<string, string>,
  historial: Map<string, DiaStock[]>,
  demandas: Map<string, DemandaSku>,
  overrides: Map<string, SkuOverride>,
  p: Parametros,
): Map<string, number> {
  const v = p.colchonVentanaDias;
  const acc = new Map<string, { ritmo: number; base: number; pares: number; manual: boolean }>();
  for (const [sku, prod] of productoDeSku) {
    const dem = demandas.get(sku);
    if (!dem) continue;
    let a = acc.get(prod);
    if (!a) acc.set(prod, (a = { ritmo: 0, base: 0, pares: 0, manual: false }));
    const o = overrides.get(sku);
    if (o?.excluir) continue;
    // Una demanda capturada a mano manda: el producto no se toca.
    if (o?.demandaManual != null) a.manual = true;
    const dias = historial.get(sku) ?? [];
    const ventana = dias.slice(-(v + 1), -1);
    const unidades = ventana.reduce((s, d) => s + d.unidades, 0);
    const efectivos = ventana.reduce((s, d) => s + d.fraccionConStock, 0);
    a.pares += unidades;
    if (efectivos < v / 2) continue;
    a.ritmo += unidades / efectivos;
    a.base += dem.demandaDiaria;
  }
  const out = new Map<string, number>();
  for (const [prod, a] of acc) {
    if (a.manual || a.base <= EPS || a.pares < PARES_MINIMOS) continue;
    const factor = a.ritmo / a.base;
    if (factor >= p.colchonSubidaFactor) out.set(prod, factor);
  }
  return out;
}
