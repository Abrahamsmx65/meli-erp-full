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
import { ajustarNecesidadPorCorrida, optimizarCajas } from "../engine";
import type { AjusteCorrida } from "../engine";
import type { Parametros } from "../engine/types";
import type { CajaConstruida } from "../importar/cajas";
import { claveAplastada, claveComparacion } from "../importar/sku";
import { claveOrdenada, type IndiceCatalogo } from "../etiquetas/resolver";
import type { RenglonAmazon } from "./amazon";
import { esCalzado, OBJETIVO_DIAS_FBA, RIESGO_DIAS_FBA, URGENTE_DIAS_FBA } from "./fba";
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
  /** faltantes cuyo SKU no viene en NINGUNA caja disponible: amarre roto o bodega agotada */
  sinCajaEnBodega: { sku: string; pares: number }[];
  /**
   * Faltantes cuyo SKU SÍ viene en alguna caja disponible: el motor mandó lo
   * que se justificaba (enPlan) y dejó este pico para el siguiente envío en
   * vez de arrastrar otra caja completa. NO es un problema de amarre.
   */
  faltanteConCaja: { sku: string; pares: number; enPlan: number }[];
  /** SKUs de Amazon con venta que no amarraron con el catálogo de MELI */
  sinAmarre: SinAmarreFba[];
  /**
   * Tallas recortadas por la regla de la corrida despareja: su caja
   * sobre-surtiría a las hermanas, así que piden la mitad (hermanas al día)
   * o solo 7 días (corrida dispareja) en vez de sus 30 días completos.
   */
  ajustesCorrida: AjusteCorrida[];
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
  const disponiblePorSku = new Map<string, number>();
  const enCaminoPorSku = new Map<string, number>();
  const sinAmarre: SinAmarreFba[] = [];

  for (const r of renglones) {
    if (!esCalzado(r.sku)) continue;

    const ventaDiaria = r.unidades / dias;
    const posicion = r.disponible + r.enTransferencia;
    // El objetivo protege también los días que el envío tarda en volverse
    // vendible en FBA (RIESGO_DIAS_FBA), como el plan de Full protege su
    // ventana de riesgo; y el redondeo es hacia ARRIBA, como en Full — con
    // round, toda talla que necesitara menos de medio par se iba a cero.
    const faltante = Math.ceil(
      Math.max(0, ventaDiaria * (objetivo + RIESGO_DIAS_FBA) - posicion),
    );
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
    disponiblePorSku.set(sku, (disponiblePorSku.get(sku) ?? 0) + r.disponible);
    enCaminoPorSku.set(sku, (enCaminoPorSku.get(sku) ?? 0) + r.enTransferencia);

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

  // La misma regla de la corrida despareja que el plan de Full: la talla
  // agotada cuya caja sobre-surtiría a sus hermanas no pide sus 30 días
  // completos — la mitad si las hermanas van al día, 7 días si la corrida
  // ya está dispareja.
  const ajustesCorrida = ajustarNecesidadPorCorrida({
    necesidad,
    datos: new Map(
      [...demandaDiaria.entries()].map(([sku, d]) => [
        sku,
        {
          disponible: disponiblePorSku.get(sku) ?? 0,
          enCamino: enCaminoPorSku.get(sku) ?? 0,
          demandaDiaria: d,
        },
      ]),
    ),
    cajas: catalogo,
    // El sobrante de las hermanas se mide contra el objetivo REAL de FBA
    // (30 días + los 14 que tarda en volverse vendible): contra 30 pelones,
    // una talla recién surtida al objetivo ya contaría como "dispareja".
    horizonteDias: objetivo + RIESGO_DIAS_FBA,
    factorSobrante: p.corridaSobranteFactor,
    diasDispareja: p.corridaDiasDispareja,
  });

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
    // Una necesidad recortada por la corrida se surte completa: el recorte
    // ya es la concesión (mismo criterio que el plan de Full).
    toleranciaRescatePorSku: new Map(ajustesCorrida.map((a) => [a.sku, 0])),
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

  // El faltante que el optimizador dejó tiene dos historias MUY distintas:
  // si el SKU no viene en ninguna caja disponible, es amarre roto o bodega
  // agotada (alarma); si sí viene, el motor simplemente decidió que el pico
  // restante no justifica arrastrar otra caja completa (normal). Mezclarlas
  // hacía que un residuo de 1 par saliera como "no está ligado a bodega"
  // con 5 cajas de ese mismo SKU dentro del plan (caso GT114-LT BROWN-26).
  const skuEnCajas = new Set<string>();
  for (const c of catalogo) {
    if (c.cajasDisponibles <= 0) continue;
    for (const it of c.items) skuEnCajas.add(it.sku);
  }
  const sinCajaEnBodega: { sku: string; pares: number }[] = [];
  const faltanteConCaja: { sku: string; pares: number; enPlan: number }[] = [];
  for (const [sku, pares] of resultado.faltantePorSku) {
    if (!necesidad.has(sku)) continue;
    if (skuEnCajas.has(sku)) {
      faltanteConCaja.push({ sku, pares, enPlan: resultado.enviadoPorSku.get(sku) ?? 0 });
    } else {
      sinCajaEnBodega.push({ sku, pares });
    }
  }

  return {
    cajas,
    lineas: [...necesidad.entries()].map(([sku, sugerido]) => ({ sku, sugerido })),
    paresSugeridos: [...necesidad.values()].reduce((a, b) => a + b, 0),
    skusConFaltante: necesidad.size,
    sinCajaEnBodega: sinCajaEnBodega.sort((a, b) => b.pares - a.pares),
    faltanteConCaja: faltanteConCaja.sort((a, b) => b.pares - a.pares),
    sinAmarre: sinAmarre.sort((a, b) => b.faltante - a.faltante),
    ajustesCorrida,
  };
}
