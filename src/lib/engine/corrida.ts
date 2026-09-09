/**
 * Regla de la corrida despareja.
 *
 * El caso que la motiva: una talla se agota, pero la caja (corrida) que la
 * trae también carga las demás tallas — y esas van bien surtidas. Completar
 * los 30 días de la talla agotada obligaría a subir cajas cuyo resto nadie
 * pidió, y las tallas hermanas quedarían con stock de más.
 *
 * Lo acordado con el negocio (verificado con los casos reales GT135 DK
 * BROWN, GT135 TABACO y GT155 BEIGE del 26-ago-2026):
 *  - Si las hermanas traen buena venta y NO tienen más de `factorSobrante`
 *    veces su ritmo de venta del horizonte (posición completa: disponible
 *    más en camino, contra venta del horizonte), se manda la MITAD de las
 *    cajas que la talla agotada pediría para completar sus 30 días.
 *  - Si la corrida ya está dispareja (alguna hermana arriba del factor, o
 *    con stock parado sin venta), la talla agotada recibe el equivalente a
 *    7 DÍAS DE SU VENTA por envío, no más — un goteo semanal. No se le
 *    descuenta su stock: su faltante completo (`necesidad`) ya lo trae
 *    descontado y actúa de tope, así que el goteo se apaga solo conforme
 *    la talla se acerca a su objetivo.
 *  - EXCEPCIÓN al goteo: si el faltante JUNTO de las tallas cortas de la
 *    corrida es grande (más de `faltanteGrande` pares, 200 por defecto),
 *    esa venta pesa más que la hermana que cayó del lado equivocado del
 *    factor, y la corrida se surte COMPLETA, sin recorte.
 *
 * La regla solo entra cuando subir la caja es mayormente sobre-surtir: si la
 * mitad o más de la caja tapa faltantes reales (varias tallas piden a la
 * vez), el envío se justifica solo y no se recorta nada.
 */
import type { Caja } from "./types";

const EPS = 1e-9;

/**
 * Fracción mínima de la caja que debe tapar faltantes reales para NO aplicar
 * la regla: con la mitad o más de la caja aprovechada, la corrida "se la
 * pide" y no hay sobre-surtido que recortar.
 */
const FRACCION_CAJA_APROVECHADA = 0.5;

export interface DatosSkuCorrida {
  /** posición completa en el canal: disponible + en camino */
  posicion: number;
  /** piezas por día que vende en el canal */
  demandaDiaria: number;
}

export type ReglaCorrida = "mitad_corrida" | "solo_7_dias";

export interface AjusteCorrida {
  sku: string;
  regla: ReglaCorrida;
  necesidadOriginal: number;
  necesidadAjustada: number;
  /**
   * El peor sobrante entre las tallas hermanas sin faltante: su posición
   * en múltiplos de su venta del horizonte (1 = posición exacta para el
   * horizonte; Infinity = stock parado sin venta o talla sin amarre).
   */
  peorSobrante: number;
}

/**
 * Recorta la necesidad de las tallas agotadas cuya caja sobre-surtiría al
 * resto de la corrida. MUTA el mapa `necesidad` (recorta o borra entradas) y
 * regresa la lista de ajustes aplicados, para que el plan pueda explicarlos.
 */
export function ajustarNecesidadPorCorrida(e: {
  necesidad: Map<string, number>;
  /** posición y demanda por SKU conocido del canal */
  datos: Map<string, DatosSkuCorrida>;
  cajas: Caja[];
  /** días que el plan quiere cubrir (30) */
  horizonteDias: number;
  /** sobrante tolerado a las hermanas: stock ≤ factor × venta del horizonte */
  factorSobrante?: number;
  /** días a cubrir cuando la corrida ya está dispareja */
  diasDispareja?: number;
  /**
   * Faltante junto (en pares) de las tallas cortas de la corrida a partir
   * del cual la venta pesa más que el sobrante: con más que esto, la
   * corrida dispareja se surte COMPLETA en vez de gotear.
   */
  faltanteGrande?: number;
  /**
   * SKUs a los que la regla NO se aplica: los de un producto NUEVO. Ahí
   * rellenar la caja es la decisión (si no se surte, nunca va a pagar), y
   * recortar la talla agotada por el sobrante de sus hermanas lo impediría.
   */
  exentos?: Set<string>;
}): AjusteCorrida[] {
  // 1.5 lo decidió el negocio (26-ago-2026): el umbral se mide con la
  // posición completa y lo en camino la infla unos días, así que 1.3
  // marcaba "dispareja" corridas que el negocio ve al día.
  const factor = e.factorSobrante ?? 1.5;
  const diasDispareja = e.diasDispareja ?? 7;
  const faltanteGrande = e.faltanteGrande ?? 200;

  // Todo se decide contra la necesidad ORIGINAL: recortar una talla no debe
  // cambiar el veredicto de otra talla de la misma corrida.
  const original = new Map(e.necesidad);
  const nec = (s: string) => original.get(s) ?? 0;

  const cajasPorSku = new Map<string, Caja[]>();
  for (const c of e.cajas) {
    if (c.cajasDisponibles <= 0) continue;
    for (const it of c.items) {
      const l = cajasPorSku.get(it.sku);
      if (l) l.push(c);
      else cajasPorSku.set(it.sku, [c]);
    }
  }

  const ajustes: AjusteCorrida[] = [];

  for (const [sku, pedida] of original) {
    if (pedida <= 0) continue;
    if (e.exentos?.has(sku)) continue;
    const propias = cajasPorSku.get(sku);
    // Sin caja disponible que la traiga no hay nada que recortar: esa talla
    // ya la reporta el plan como faltante sin caja.
    if (!propias?.length) continue;

    // La caja MÁS aprovechable que trae esta talla: piezas que tapan
    // faltantes reales (de cualquier talla) sobre piezas totales.
    let mejorAprovechada = 0;
    for (const c of propias) {
      let utiles = 0;
      let piezas = 0;
      for (const it of c.items) {
        piezas += it.piezas;
        utiles += Math.min(it.piezas, nec(it.sku));
      }
      if (piezas > 0) mejorAprovechada = Math.max(mejorAprovechada, utiles / piezas);
    }
    if (mejorAprovechada >= FRACCION_CAJA_APROVECHADA) continue;

    // Salud de las hermanas SIN faltante de esas cajas: ¿cuánto les sobra
    // contra su venta del horizonte? Se mide con la posición COMPLETA
    // (disponible + en camino): lo que viaja también va a estar en el piso.
    let peor = 0;
    for (const c of propias) {
      for (const it of c.items) {
        if (it.sku === sku || nec(it.sku) > 0) continue;
        const d = e.datos.get(it.sku);
        if (!d) {
          // Talla que la caja arrastra pero el canal no conoce (sin amarre):
          // no hay demanda comprobada, mandarle de más es puro riesgo.
          peor = Infinity;
          continue;
        }
        // Vacía: que le llegue no es sobrar, es volver a tener qué vender.
        if (d.posicion <= 0) continue;
        const sobrante =
          d.demandaDiaria > EPS
            ? d.posicion / (d.demandaDiaria * e.horizonteDias)
            : Infinity; // stock parado sin venta: la corrida ya está dispareja
        peor = Math.max(peor, sobrante);
      }
    }

    let regla: ReglaCorrida;
    let ajustada: number;
    if (peor <= factor) {
      regla = "mitad_corrida";
      ajustada = Math.ceil(pedida / 2);
    } else {
      // Faltante JUNTO de las tallas cortas de esta corrida. Si es grande,
      // la venta que el goteo dejaría de surtir pesa más que el sobrante
      // de la hermana que cayó del lado equivocado del factor, y la
      // corrida se surte COMPLETA: sin recorte.
      let faltanteCorrida = 0;
      const vistos = new Set<string>();
      for (const c of propias) {
        for (const it of c.items) {
          if (vistos.has(it.sku)) continue;
          vistos.add(it.sku);
          faltanteCorrida += nec(it.sku);
        }
      }
      if (faltanteCorrida > faltanteGrande) continue;

      regla = "solo_7_dias";
      // Una semana de venta de la talla por envío, sin restarle su stock:
      // el faltante (`pedida`) ya trae la posición descontada y hace de
      // tope, así que el goteo nunca la pasa de su objetivo y se apaga
      // solo conforme se acerca.
      const d = e.datos.get(sku);
      ajustada = Math.min(pedida, Math.max(0, Math.ceil((d?.demandaDiaria ?? 0) * diasDispareja)));
    }
    if (ajustada >= pedida) continue;

    if (ajustada > 0) e.necesidad.set(sku, ajustada);
    else e.necesidad.delete(sku);
    ajustes.push({
      sku,
      regla,
      necesidadOriginal: pedida,
      necesidadAjustada: ajustada,
      peorSobrante: peor,
    });
  }

  return ajustes;
}
