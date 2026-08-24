/**
 * Desglose de las cajas OPCIONALES del plan (las que entraron por el rescate
 * de tallas faltantes) y del sobrante por talla.
 *
 * La regla acordada: el total "oficial" del plan son solo las cajas
 * obligatorias; las opcionales se muestran aparte — en rojo en el Excel —
 * con la explicación exacta de cuántos pares de más traen y en qué tallas,
 * para que el usuario decida caja por caja si las sube.
 *
 * Todo se calcula contra los números del propio plan (sugerido vs. lo que
 * las cajas aportan), sin estimar nada.
 */

export interface CajaParaDesglose {
  codigo: string;
  cantidad: number;
  paresPorCaja: number;
  cantidadOpcional: number;
  aporta: { sku: string; talla: string; paresPorCaja: number }[];
}

export interface LineaParaDesglose {
  sku: string;
  sugerido: number;
}

export interface DesgloseOpcionales {
  cajasObligatorias: number;
  cajasOpcionales: number;
  paresObligatorios: number;
  paresOpcionales: number;
  /** Pares de más de TODO el plan (enviado − sugerido), por talla, de mayor a menor. */
  deMasPorTalla: { talla: string; pares: number }[];
  totalDeMas: number;
  /** De ese "de más", cuánto viaja dentro de cajas opcionales. */
  deMasEnOpcionales: number;
  /** Por código de caja: el sobrante por talla atribuible a sus cajas opcionales. */
  deMasPorCaja: Map<string, { talla: string; pares: number }[]>;
}

export function desglosarOpcionales(
  cajas: CajaParaDesglose[],
  lineas: LineaParaDesglose[],
): DesgloseOpcionales {
  let cajasObligatorias = 0;
  let cajasOpcionales = 0;
  let paresObligatorios = 0;
  let paresOpcionales = 0;

  // Lo enviado por SKU según las cajas del plan (la misma lista que se
  // imprime), y lo sugerido según las líneas del plan.
  const enviadoPorSku = new Map<string, number>();
  const tallaDeSku = new Map<string, string>();
  for (const c of cajas) {
    const opcionales = Math.min(c.cantidad, c.cantidadOpcional);
    cajasOpcionales += opcionales;
    cajasObligatorias += c.cantidad - opcionales;
    paresOpcionales += opcionales * c.paresPorCaja;
    paresObligatorios += (c.cantidad - opcionales) * c.paresPorCaja;
    for (const a of c.aporta) {
      enviadoPorSku.set(a.sku, (enviadoPorSku.get(a.sku) ?? 0) + a.paresPorCaja * c.cantidad);
      if (!tallaDeSku.has(a.sku)) tallaDeSku.set(a.sku, a.talla);
    }
  }

  const sugeridoPorSku = new Map(lineas.map((l) => [l.sku, l.sugerido]));

  // Sobrante global por SKU: lo que viaja por encima de lo sugerido. Un SKU
  // que ninguna línea pidió (lo arrastra una caja mixta) sobra completo.
  const sobraPorSku = new Map<string, number>();
  for (const [sku, enviado] of enviadoPorSku) {
    const sobra = enviado - (sugeridoPorSku.get(sku) ?? 0);
    if (sobra > 0) sobraPorSku.set(sku, sobra);
  }

  const porTalla = new Map<string, number>();
  let totalDeMas = 0;
  for (const [sku, sobra] of sobraPorSku) {
    const talla = tallaDeSku.get(sku) ?? "";
    porTalla.set(talla, (porTalla.get(talla) ?? 0) + sobra);
    totalDeMas += sobra;
  }

  // Atribución del sobrante a las cajas opcionales: cada caja opcional toma
  // del sobrante global de sus SKUs hasta donde su aporte alcance. El orden
  // es el de la lista (las cajas más grandes primero, como se imprimen), y
  // el pool compartido evita contar el mismo par de más dos veces.
  const pool = new Map(sobraPorSku);
  const deMasPorCaja = new Map<string, { talla: string; pares: number }[]>();
  let deMasEnOpcionales = 0;

  for (const c of cajas) {
    const opcionales = Math.min(c.cantidad, c.cantidadOpcional);
    if (opcionales <= 0) continue;
    const detalle: { talla: string; pares: number }[] = [];
    for (const a of c.aporta) {
      const aporteOpcional = a.paresPorCaja * opcionales;
      const toma = Math.min(aporteOpcional, pool.get(a.sku) ?? 0);
      if (toma <= 0) continue;
      pool.set(a.sku, (pool.get(a.sku) ?? 0) - toma);
      detalle.push({ talla: a.talla, pares: toma });
      deMasEnOpcionales += toma;
    }
    if (detalle.length) deMasPorCaja.set(c.codigo, detalle);
  }

  return {
    cajasObligatorias,
    cajasOpcionales,
    paresObligatorios,
    paresOpcionales,
    deMasPorTalla: [...porTalla.entries()]
      .map(([talla, pares]) => ({ talla, pares }))
      .sort((a, b) => b.pares - a.pares),
    totalDeMas,
    deMasEnOpcionales,
    deMasPorCaja,
  };
}

/** "T26 +120 · T27 +48" — el sobrante por talla como texto corto. */
export function textoDeMas(detalle: { talla: string; pares: number }[], tope = 6): string {
  const partes = detalle.slice(0, tope).map((d) => `${d.talla ? `T${d.talla}` : "¿?"} +${d.pares}`);
  if (detalle.length > tope) partes.push("…");
  return partes.join(" · ");
}
