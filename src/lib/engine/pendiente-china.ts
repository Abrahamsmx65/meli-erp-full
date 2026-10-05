/**
 * Lo que de un pedido a China todavía NO llega a la bodega, renglón por
 * renglón del pedido (motor puro, probado en pendiente-china.test.ts).
 *
 * Hasta el 5-oct-2026 un pedido que la bodega ya conocía (porque recibió una
 * PARTE) dejaba de contar entero como «en camino»: el IN10079 (97,680 pares
 * en varios embarques) tenía 31,272 recibidos y los 66,408 que siguen en el
 * mar o en China no existían ni para el catálogo ni para Planificación China
 * (dueño: «el sistema no está tomando en cuenta lo que está pedido en China»).
 *
 * Por pedido y MODELO:
 *   llegado   = lo mayor entre lo que entró en contenedores RECIBIDOS y lo
 *               que la bodega tiene físicamente de ese pedido (la bodega a
 *               veces lo cuenta antes de que el contenedor se marque
 *               recibido, y lo que ya se mandó a Full sale de su físico);
 *   pendiente = pedido − llegado − lo que la bodega ya reporta en camino
 *               de ese pedido (eso ya cuenta por su lado), nunca negativo.
 * El pendiente del modelo se reparte entre sus renglones según lo que a
 * cada uno le falta por contenedores. Un pedido que la bodega NO conoce
 * cuenta completo, como siempre.
 */

export interface LineaPedido {
  id: string | number;
  modelo: string;
  pares: number;
  cajas: number;
  /** cajas de este renglón en contenedores ya RECIBIDOS */
  cajasRecibidas: number;
}

export interface BodegaDelPedido {
  /** pares físicos en la bodega de este pedido y modelo */
  fisico: number;
  /** pares que la bodega ya reporta en camino de este pedido y modelo */
  enCamino: number;
}

const clave = (modelo: string) => String(modelo ?? "").trim().toUpperCase();

/**
 * Pares pendientes por renglón. `bodega` es por modelo (de las existencias
 * de ESTE pedido); null = la bodega no conoce el pedido.
 */
export function pendientePorLinea(lineas: LineaPedido[], bodega: Map<string, BodegaDelPedido> | null): Map<string | number, number> {
  const salida = new Map<string | number, number>();
  if (!bodega) {
    for (const l of lineas) salida.set(l.id, Math.max(0, Number(l.pares) || 0));
    return salida;
  }
  const porModelo = new Map<string, LineaPedido[]>();
  for (const l of lineas) {
    const k = clave(l.modelo);
    porModelo.set(k, [...(porModelo.get(k) ?? []), l]);
  }
  for (const [modelo, suyas] of porModelo) {
    const faltaPorContenedor = suyas.map((l) => {
      const pares = Math.max(0, Number(l.pares) || 0);
      const porCaja = l.cajas > 0 ? pares / l.cajas : 0;
      return Math.max(0, pares - Math.max(0, l.cajasRecibidas) * porCaja);
    });
    const pares = suyas.reduce((a, l) => a + Math.max(0, Number(l.pares) || 0), 0);
    const recibido = suyas.reduce((a, l, i) => a + (Math.max(0, Number(l.pares) || 0) - faltaPorContenedor[i]), 0);
    const b = bodega.get(modelo) ?? { fisico: 0, enCamino: 0 };
    const pendiente = Math.max(0, pares - Math.max(recibido, b.fisico) - Math.max(0, b.enCamino));
    const peso = faltaPorContenedor.reduce((a, x) => a + x, 0);
    suyas.forEach((l, i) => {
      const parte = peso > 0 ? faltaPorContenedor[i] / peso : pares > 0 ? Math.max(0, Number(l.pares) || 0) / pares : 0;
      salida.set(l.id, pendiente * parte);
    });
  }
  return salida;
}
