/**
 * Plan de envío a FBA con el MISMO motor de cajas que los envíos a Full.
 *
 * La lógica acordada es idéntica a la de MELI: el faltante se calcula por
 * talla (venta diaria de Amazon × objetivo − lo que hay + lo que viaja), los
 * SKUs de Amazon se amarran al catálogo de MELI con los mismos cuatro
 * niveles (exacto → canónico → aplastado → tokens ordenados, porque Amazon
 * escribe la talla antes del color), y el optimizador elige CAJAS COMPLETAS
 * reales de la bodega — con el mismo rescate de tallas y las mismas cajas
 * opcionales que el plan de Full.
 *
 * Los dos canales ven TODAS las cajas disponibles: lo que un envío
 * registrado aparta desaparece para ambos en la siguiente sincronización
 * con Industher. El orden lo decide el usuario.
 */
import { optimizarCajas } from "../engine";
import type { Parametros } from "../engine/types";
import type { CajaConstruida } from "../importar/cajas";
import { claveAplastada, claveComparacion } from "../importar/sku";
import { claveOrdenada, type IndiceCatalogo } from "../etiquetas/resolver";
import type { RenglonAmazon } from "./amazon";
import { esCalzado, OBJETIVO_DIAS_FBA, URGENTE_DIAS_FBA } from "./fba";
import type { CajaPlaneada } from "./plan";
import { reasignarPorBodega } from "./plan";

export interface SinAmarreFba {
  sku: string;
  unidades: number;
  faltante: number;
}

export interface LineaFba {
  sku: string;
  sugerido: number;
}

export interface PlanFbaCajas {
  cajas: CajaPlaneada[];
  lineas: LineaFba[];
  paresSugeridos: number;
  skusConFaltante: number;
  /** faltantes que ninguna caja disponible en bodega puede tapar */
  sinCajaEnBodega: { sku: string; pares: number }[];
  /** SKUs de Amazon con venta que no amarraron con el catálogo de MELI */
  sinAmarre: SinAmarreFba[];
}

export function planFbaConCajas(opts: {
  renglones: RenglonAmazon[];
  dias: number;
  catalogo: CajaConstruida[];
  indiceMeli: IndiceCatalogo | null;
  parametros: Parametros;
  objetivoDias?: number;
}): PlanFbaCajas {
  const { renglones, dias, catalogo, indiceMeli, parametros: p } = opts;
  const objetivo = opts.objetivoDias ?? OBJETIVO_DIAS_FBA;

  const necesidad = new Map<string, number>();
  const prioridad = new Map<string, number>();
  const castigoSobrante = new Map<string, number>();
  const demandaDiaria = new Map<string, number>();
  const sinAmarre: SinAmarreFba[] = [];

  for (const r of renglones) {
    if (!esCalzado(r.sku)) continue;

    const ventaDiaria = r.unidades / dias;
    const posicion = r.disponible + r.enTransferencia;
    const faltante = Math.round(Math.max(0, ventaDiaria * objetivo - posicion));
    const cobertura = ventaDiaria > 0 ? posicion / ventaDiaria : null;

    // El mismo amarre de cuatro niveles que ya amarra los SKUs de Amazon en
    // etiquetas: el SKU de la caja de bodega es el de MELI, así que la
    // necesidad tiene que hablar ese idioma.
    const enCatalogo =
      indiceMeli?.exacto.get(r.sku.trim().toUpperCase()) ??
      indiceMeli?.canonico.get(claveComparacion(r.sku)) ??
      indiceMeli?.aplastado.get(claveAplastada(r.sku)) ??
      indiceMeli?.ordenado.get(claveOrdenada(r.sku));

    if (!enCatalogo?.sku) {
      if (r.unidades > 0 || faltante > 0) {
        sinAmarre.push({ sku: r.sku, unidades: r.unidades, faltante });
      }
      continue;
    }
    const sku = enCatalogo.sku as string;

    if (faltante > 0) necesidad.set(sku, (necesidad.get(sku) ?? 0) + faltante);
    demandaDiaria.set(sku, (demandaDiaria.get(sku) ?? 0) + ventaDiaria);

    // Los mismos pesos que el plan de Full, con los estados traducidos a
    // FBA: bajo de cobertura duele como crítico; con el doble del objetivo
    // ya es sobrestock; sin ventas, cada pieza extra es puro costo — salvo
    // que la talla esté VACÍA en FBA, donde llegar de más es volver a tener
    // qué vender (mismo criterio que el motor de Full).
    if (cobertura !== null && cobertura < URGENTE_DIAS_FBA) {
      prioridad.set(sku, p.pesoFaltanteCritico);
    } else {
      prioridad.set(sku, 1);
    }
    if (ventaDiaria <= 0) {
      castigoSobrante.set(sku, posicion <= 0 ? 0.8 : 4);
    } else if (cobertura !== null && cobertura > objetivo * 2) {
      castigoSobrante.set(sku, 2.5);
    } else {
      castigoSobrante.set(sku, 1);
    }
  }

  const resultado = optimizarCajas({
    necesidad,
    prioridad,
    castigoSobrante,
    demandaDiaria,
    cajas: catalogo,
    permiteUnidadesSueltas: false,
    inventarioSuelto: new Map(),
    pesoFaltante: p.pesoFaltante,
    pesoSobrante: p.pesoSobrante,
  });

  // Igual que el plan de Full: la marca de opcional viaja DENTRO de la
  // reasignación (por firma de contenido), porque el código cambia.
  const reasignadas = reasignarPorBodega(resultado.cajas, catalogo);

  const porCodigo = new Map(catalogo.map((c) => [c.codigo, c]));
  const cajas: CajaPlaneada[] = reasignadas
    .map((elegida) => {
      const def = porCodigo.get(elegida.codigo);
      if (!def) return null;
      return {
        codigo: elegida.codigo,
        cantidad: elegida.cantidad,
        paresPorCaja: def.paresPorCaja,
        paresTotales: elegida.cantidad * def.paresPorCaja,
        almacen: def.almacen,
        skuCaja: def.skuCaja,
        pedido: def.pedido,
        modelo: def.modelo,
        color: def.color,
        talla: def.talla,
        esCorrida: def.esCorrida,
        contenedores: def.contenedores,
        cajasDisponibles: def.cajasDisponibles,
        cantidadOpcional: Math.min(elegida.cantidad, elegida.cantidadOpcional ?? 0),
        aporta: def.detalle.map((d) => ({
          sku: d.sku,
          talla: d.talla,
          paresPorCaja: d.piezas,
          paresTotales: d.piezas * elegida.cantidad,
        })),
      } satisfies CajaPlaneada;
    })
    .filter((x): x is CajaPlaneada => x !== null)
    .sort((a, b) => b.paresTotales - a.paresTotales);

  return {
    cajas,
    lineas: [...necesidad.entries()].map(([sku, sugerido]) => ({ sku, sugerido })),
    paresSugeridos: [...necesidad.values()].reduce((a, b) => a + b, 0),
    skusConFaltante: necesidad.size,
    sinCajaEnBodega: [...resultado.faltantePorSku.entries()]
      .filter(([sku]) => necesidad.has(sku))
      .map(([sku, pares]) => ({ sku, pares }))
      .sort((a, b) => b.pares - a.pares),
    sinAmarre: sinAmarre.sort((a, b) => b.faltante - a.faltante),
  };
}
