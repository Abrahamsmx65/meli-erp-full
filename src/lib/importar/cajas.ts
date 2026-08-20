/**
 * Cruza EXISTENCIAS × CORRIDAS y produce el catálogo de cajas que consume
 * el optimizador.
 *
 * Dos formas de caja conviven en la operación:
 *   - Caja de corrida: trae varias tallas del mismo modelo/color según la
 *     receta de la corrida. Es una caja mixta: toca varios SKUs de MELI.
 *   - Caja de talla única: los 48 pares son de una sola talla. Es un caso
 *     particular de lo anterior, con un solo SKU.
 *
 * Las cajas no se abren, así que la unidad de decisión siempre es la caja
 * completa. Eso es justo lo que el optimizador espera.
 */
import type { Caja } from "../engine/types";
import { claveCorrida, type Aviso, type Corrida, type FilaExistencia } from "./excel";
import { amarrarSku, type IndiceSkus, type OrigenAmarre } from "./sku";

export interface ItemCaja {
  sku: string;
  piezas: number;
  talla: string;
  origen: OrigenAmarre | "sin_catalogo";
}

export interface CajaConstruida extends Caja {
  almacen: string;
  codigoAlmacen: string;
  skuCaja: string;
  pedido: string;
  modelo: string;
  color: string;
  talla: string;
  esCorrida: boolean;
  paresPorCaja: number;
  enCamino: number;
  contenedores: string[];
  detalle: ItemCaja[];
}

export interface FilaSinCorrida {
  almacen: string;
  skuCaja: string;
  pedido: string;
  modelo: string;
  color: string;
  cajasDisponibles: number;
  paresPorCaja: number;
}

export interface SkuSinAmarre {
  skuConstruido: string;
  modelo: string;
  color: string;
  talla: string;
  /** en cuántas cajas distintas aparece */
  apariciones: number;
  paresAfectados: number;
}

export interface ResultadoCajas {
  cajas: CajaConstruida[];
  sinCorrida: FilaSinCorrida[];
  sinAmarre: SkuSinAmarre[];
  avisos: Aviso[];
  resumen: {
    filasLeidas: number;
    cajasArmadas: number;
    cajasTotales: number;
    paresTotales: number;
    skusDistintos: number;
    filasSinCorrida: number;
    skusSinAmarre: number;
  };
}

export interface OpcionesCajas {
  /** catálogo real de SKUs de MELI. Si falta, se confía en el SKU construido. */
  indice?: IndiceSkus | null;
  /** amarres capturados a mano: skuConstruido -> skuMeli */
  mapeoManual?: Map<string, string>;
  /** solo estos almacenes surten a Full. Vacío = todos. */
  almacenes?: string[];
}

export function construirCajas(
  existencias: FilaExistencia[],
  corridas: Corrida[],
  opts: OpcionesCajas = {},
): ResultadoCajas {
  const porClave = new Map<string, Corrida>();
  for (const c of corridas) porClave.set(claveCorrida(c.pedido, c.modelo, c.color), c);

  const filtroAlmacen = opts.almacenes?.length
    ? new Set(opts.almacenes.map((a) => a.toLowerCase()))
    : null;

  const avisos: Aviso[] = [];
  const sinCorrida: FilaSinCorrida[] = [];
  const sinAmarre = new Map<string, SkuSinAmarre>();

  // Se agrupan los renglones del mismo almacén y caja: el reporte los separa
  // por contenedor, pero para planear da igual de qué pallet salgan.
  const agrupado = new Map<string, FilaExistencia[]>();
  for (const f of existencias) {
    if (filtroAlmacen && !filtroAlmacen.has(f.almacen.toLowerCase())) continue;
    const k = `${f.almacen}||${f.skuCaja}||${f.talla}`;
    const l = agrupado.get(k);
    if (l) l.push(f);
    else agrupado.set(k, [f]);
  }

  const cajas: CajaConstruida[] = [];

  for (const [clave, grupo] of agrupado) {
    const base = grupo[0];
    const disponibles = grupo.reduce((a, f) => a + f.cajasDisponibles, 0);
    const enCamino = grupo.reduce((a, f) => a + f.enCamino, 0);
    const contenedores = [...new Set(grupo.map((f) => f.contenedor).filter(Boolean))];
    const esCorridaFila = base.talla === "CORRIDA";

    // Construcción del contenido de la caja.
    let detalle: ItemCaja[] = [];

    if (esCorridaFila) {
      const receta = porClave.get(claveCorrida(base.pedido, base.modelo, base.color));
      if (!receta) {
        sinCorrida.push({
          almacen: base.almacen,
          skuCaja: base.skuCaja,
          pedido: base.pedido,
          modelo: base.modelo,
          color: base.color,
          cajasDisponibles: disponibles,
          paresPorCaja: base.paresPorCaja,
        });
        continue;
      }

      detalle = Object.entries(receta.tallas).map(([talla, pares]) =>
        resolverItem(base.modelo, base.color, talla, pares, opts, sinAmarre),
      );

      const suma = detalle.reduce((a, d) => a + d.piezas, 0);
      if (base.paresPorCaja > 0 && suma !== base.paresPorCaja) {
        avisos.push({
          fila: 0,
          mensaje: `${base.skuCaja}: la corrida suma ${suma} pares pero el reporte dice ${base.paresPorCaja} por caja. Se usa la corrida.`,
        });
      }
    } else {
      // Caja de talla única: todos los pares son de esa talla.
      const pares = base.paresPorCaja > 0 ? base.paresPorCaja : 0;
      if (pares <= 0) {
        avisos.push({
          fila: 0,
          mensaje: `${base.skuCaja}: talla ${base.talla} sin "Pares por caja". No se puede armar la caja.`,
        });
        continue;
      }
      detalle = [resolverItem(base.modelo, base.color, base.talla, pares, opts, sinAmarre)];
    }

    // Los items sin amarre a MELI no pueden planearse: se excluyen del
    // contenido pero la caja sigue viva por sus demás tallas.
    const items = detalle
      
      .filter((d) => d.sku)
      .map((d) => ({ sku: d.sku, piezas: d.piezas }));

    if (!items.length) continue;

    cajas.push({
      codigo: clave,
      nombre: `${base.skuCaja}${esCorridaFila ? "" : ` · talla ${base.talla}`} · ${base.almacen}`,
      cajasDisponibles: Math.max(0, disponibles),
      items,
      almacen: base.almacen,
      codigoAlmacen: base.codigoAlmacen,
      skuCaja: base.skuCaja,
      pedido: base.pedido,
      modelo: base.modelo,
      color: base.color,
      talla: base.talla,
      esCorrida: esCorridaFila,
      paresPorCaja: detalle.reduce((a, d) => a + d.piezas, 0),
      enCamino,
      contenedores,
      detalle,
    });
  }

  const skus = new Set<string>();
  for (const c of cajas) for (const i of c.items) skus.add(i.sku);

  return {
    cajas,
    sinCorrida,
    sinAmarre: [...sinAmarre.values()].sort((a, b) => b.paresAfectados - a.paresAfectados),
    avisos,
    resumen: {
      filasLeidas: existencias.length,
      cajasArmadas: cajas.length,
      cajasTotales: cajas.reduce((a, c) => a + c.cajasDisponibles, 0),
      paresTotales: cajas.reduce((a, c) => a + c.cajasDisponibles * c.paresPorCaja, 0),
      skusDistintos: skus.size,
      filasSinCorrida: sinCorrida.length,
      skusSinAmarre: sinAmarre.size,
    },
  };
}

function resolverItem(
  modelo: string,
  color: string,
  talla: string,
  pares: number,
  opts: OpcionesCajas,
  sinAmarre: Map<string, SkuSinAmarre>,
): ItemCaja {
  if (!opts.indice) {
    // Sin catálogo de MELI cargado todavía: se confía en el SKU construido.
    const r = amarrarSku(modelo, color, talla, { exactos: new Set(), canonicos: new Map(), aplastados: new Map() }, opts.mapeoManual);
    return { sku: r.skuMeli ?? r.skuConstruido, piezas: pares, talla, origen: "sin_catalogo" };
  }

  const r = amarrarSku(modelo, color, talla, opts.indice, opts.mapeoManual);

  if (!r.skuMeli) {
    const prev = sinAmarre.get(r.skuConstruido);
    if (prev) {
      prev.apariciones++;
      prev.paresAfectados += pares;
    } else {
      sinAmarre.set(r.skuConstruido, {
        skuConstruido: r.skuConstruido,
        modelo,
        color,
        talla,
        apariciones: 1,
        paresAfectados: pares,
      });
    }
    // Se conserva con el SKU construido para que el usuario lo pueda amarrar
    // a mano después; el motor simplemente no le verá demanda.
    return { sku: r.skuConstruido, piezas: pares, talla, origen: "sin_amarre" };
  }

  return { sku: r.skuMeli, piezas: pares, talla, origen: r.origen };
}
