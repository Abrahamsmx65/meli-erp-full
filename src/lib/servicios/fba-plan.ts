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
import type { ISODate, Parametros } from "../engine/types";
import { aISO } from "../engine/fechas";
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

/**
 * Historia de un SKU en Amazon más allá de la ventana del plan (RPC
 * `amazon_historia_sku`): cuántos pares vendió en toda la historia y cuándo
 * se estrenó (primera venta o primera foto con stock en FBA). La llave es el
 * SKU tal como lo escribe Amazon; el plan lo amarra a MELI igual que los
 * renglones.
 */
export interface HistoriaSkuFba {
  unidades: number;
  primeraVenta: ISODate | null;
  primeraFoto: ISODate | null;
}

/** Producto lanzado hace poco en Amazon: cualquier faltante fuerza su caja. */
export interface ProductoNuevoFba {
  producto: string;
  /** días desde el estreno (primera venta o primera foto con stock) */
  edad: number;
  skus: string[];
}

/** Producto que nunca ha vendido en Amazon y se manda a probar. */
export interface ProductoSinEstrenoFba {
  producto: string;
  /** cajas que ya tenía en posición (FBA + en camino), en cajas enteras */
  enPosicion: number;
  /** cajas que este plan le fuerza */
  cajas: number;
  /** códigos de caja del plan que entraron por esta regla */
  codigos: string[];
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
  /**
   * Las mismas reglas de producto que el plan de Full (decisión del dueño,
   * sep-2026): producto NUEVO en crecimiento (su faltante fuerza caja firme)
   * y producto SIN VENTA en Amazon (posición mínima de cajas para probarlo).
   */
  productosNuevos: ProductoNuevoFba[];
  sinEstreno: ProductoSinEstrenoFba[];
  /** lo que le faltó al plan para aplicar todas sus reglas */
  avisos: string[];
}

/** Días entre dos fechas ISO (b − a), sin hora. */
function diasEntre(a: ISODate, b: ISODate): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/**
 * El SKU de Amazon en el idioma de la bodega (el SKU de MELI): los mismos
 * cuatro amarres que las etiquetas (exacto → canónico → aplastado → tokens
 * ordenados, porque Amazon escribe la talla antes del color).
 */
function amarrarAMeli(indiceMeli: IndiceCatalogo | null, sku: string): string | null {
  const enCatalogo =
    indiceMeli?.exacto.get(sku.trim().toUpperCase()) ??
    indiceMeli?.canonico.get(claveComparacion(sku)) ??
    indiceMeli?.aplastado.get(claveAplastada(sku)) ??
    indiceMeli?.ordenado.get(claveOrdenada(sku));
  return enCatalogo?.sku ? (enCatalogo.sku as string) : null;
}

export function planFbaConCajas(opts: {
  renglones: RenglonAmazon[];
  dias: number;
  catalogo: CajaConstruida[];
  indiceMeli: IndiceCatalogo | null;
  parametros: Parametros;
  objetivoDias?: number;
  /**
   * Historia por SKU de Amazon (toda, no solo la ventana). Sin ella las
   * reglas de producto NUEVO y SIN VENTA no se pueden afirmar y se apagan.
   */
  historia?: Map<string, HistoriaSkuFba>;
  /**
   * SKUs de Amazon con una publicación que puede recibir inventario en FBA
   * (Active o Inactive; una Incomplete no). Un producto SIN VENTA solo se
   * manda a probar si tiene dónde venderse: a diferencia de Full, en Amazon
   * no todo el catálogo está publicado. Si no se pasa, basta con que Amazon
   * conozca el SKU (venga en los renglones).
   */
  skusListados?: Set<string>;
  /** día del negocio; por omisión hoy (para la edad del producto nuevo) */
  hoy?: ISODate;
}): PlanFbaCajas {
  const { renglones, dias, catalogo, indiceMeli, parametros: p } = opts;
  const objetivo = opts.objetivoDias ?? OBJETIVO_DIAS_FBA;
  const horizonte = objetivo + RIESGO_DIAS_FBA;
  const hoy = opts.hoy ?? aISO(new Date(Date.now() - 6 * 3_600_000));
  const avisos: string[] = [];

  const necesidad = new Map<string, number>();
  const prioridad = new Map<string, number>();
  const castigoSobrante = new Map<string, number>();
  const demandaDiaria = new Map<string, number>();
  const posicionPorSku = new Map<string, number>();
  const unidadesVentana = new Map<string, number>();
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
    const sku = amarrarAMeli(indiceMeli, r.sku);
    if (!sku) {
      if (r.unidades > 0 || faltante > 0) {
        sinAmarre.push({ sku: r.sku, unidades: r.unidades, faltante });
      }
      continue;
    }

    if (faltante > 0) necesidad.set(sku, (necesidad.get(sku) ?? 0) + faltante);
    demandaDiaria.set(sku, (demandaDiaria.get(sku) ?? 0) + ventaDiaria);
    posicionPorSku.set(sku, (posicionPorSku.get(sku) ?? 0) + posicion);
    unidadesVentana.set(sku, (unidadesVentana.get(sku) ?? 0) + r.unidades);

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

  // --- Reglas de PRODUCTO (modelo + color), las mismas que el plan de Full.
  // La historia de Amazon viene por SKU de Amazon: se amarra a MELI como los
  // renglones. Sin historia no se puede afirmar que un producto NUNCA vendió
  // ni cuándo se estrenó: las dos reglas se apagan y el plan lo dice.
  const ventaHistorica = new Set<string>();
  const primeraFecha = new Map<string, ISODate>();
  if (opts.historia) {
    for (const [skuAmazon, h] of opts.historia) {
      if (!esCalzado(skuAmazon)) continue;
      const sku = amarrarAMeli(indiceMeli, skuAmazon);
      if (!sku) continue;
      if (h.unidades > 0) ventaHistorica.add(sku);
      for (const f of [h.primeraVenta, h.primeraFoto]) {
        if (!f) continue;
        const previa = primeraFecha.get(sku);
        if (!previa || f < previa) primeraFecha.set(sku, f);
      }
    }
  } else {
    avisos.push(
      "Sin la historia de ventas de Amazon no se puede saber qué producto es NUEVO o nunca ha vendido: esas dos reglas no se aplicaron en este plan.",
    );
  }
  const listados = opts.skusListados
    ? new Set(
        [...opts.skusListados]
          .map((sk) => amarrarAMeli(indiceMeli, sk))
          .filter((sk): sk is string => sk !== null),
      )
    : null;
  const conocidos = new Set(posicionPorSku.keys());

  const cajasPorProducto = new Map<string, CajaConstruida[]>();
  const skusPorProducto = new Map<string, Set<string>>();
  for (const c of catalogo) {
    if (c.cajasDisponibles <= 0 || !c.items.length) continue;
    const prod = c.producto ?? c.codigo;
    let lc = cajasPorProducto.get(prod);
    if (!lc) cajasPorProducto.set(prod, (lc = []));
    lc.push(c);
    let ls = skusPorProducto.get(prod);
    if (!ls) skusPorProducto.set(prod, (ls = new Set()));
    for (const it of c.items) ls.add(it.sku);
  }

  const reglasActivas = opts.historia !== undefined;
  const productosNuevos = new Map<string, number>(); // producto -> edad en días
  const productosSinVenta = new Map<string, number>(); // producto -> pares en posición
  if (reglasActivas) {
    for (const [prod, skus] of skusPorProducto) {
      // Sin publicación en Amazon no hay a dónde mandarlo.
      const vendible = [...skus].some((sk) => (listados ? listados.has(sk) : conocidos.has(sk)));
      if (!vendible) continue;

      // SIN VENTA: ninguna talla ha vendido un par en Amazon, ni en la
      // ventana ni en toda la historia.
      const sinVenta =
        p.cajasMinimasSinEstreno > 0 &&
        [...skus].every((sk) => (unidadesVentana.get(sk) ?? 0) === 0 && !ventaHistorica.has(sk));
      if (sinVenta) {
        productosSinVenta.set(
          prod,
          [...skus].reduce((a, sk) => a + (posicionPorSku.get(sk) ?? 0), 0),
        );
        continue;
      }

      // NUEVO: se estrenó en Amazon (primera venta o primera foto con stock)
      // hace menos de `nuevoDias`, ninguna talla antes.
      if (p.nuevoDias <= 0) continue;
      let estreno: ISODate | null = null;
      for (const sk of skus) {
        const f = primeraFecha.get(sk);
        if (f && (!estreno || f < estreno)) estreno = f;
      }
      if (!estreno) continue;
      const edad = diasEntre(estreno, hoy);
      if (edad >= 0 && edad <= p.nuevoDias) productosNuevos.set(prod, edad);
    }
  }
  const skusNuevos = new Set<string>();
  for (const prod of productosNuevos.keys()) {
    for (const sk of skusPorProducto.get(prod) ?? []) skusNuevos.add(sk);
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
        { posicion: posicionPorSku.get(sku) ?? 0, demandaDiaria: d },
      ]),
    ),
    cajas: catalogo,
    // El sobrante de las hermanas se mide contra el objetivo REAL de FBA
    // (30 días + los 7 que tarda en volverse vendible): contra 30 pelones,
    // una talla recién surtida al objetivo ya contaría como "dispareja".
    horizonteDias: horizonte,
    factorSobrante: p.corridaSobranteFactor,
    diasDispareja: p.corridaDiasDispareja,
    faltanteGrande: p.corridaFaltanteGrande,
    // A un producto NUEVO se le rellena la caja: la regla no lo recorta.
    exentos: skusNuevos,
  });

  // Una necesidad recortada por la corrida se surte completa (tolerancia
  // 0): el recorte ya es la concesión. Y a un producto NUEVO cualquier
  // faltante le fuerza su caja, sin la tolerancia de rescate de 7 días.
  const toleranciaPorSku = new Map(ajustesCorrida.map((a) => [a.sku, 0]));
  for (const sk of skusNuevos) if (necesidad.has(sk)) toleranciaPorSku.set(sk, 0);

  // Holgura sobre el objetivo: quedar en 37 + 2 días no es sobre-surtir.
  // En piezas por SKU, descontando lo que ya traiga arriba de su objetivo.
  const holguraPorSku = new Map<string, number>();
  if (p.holguraObjetivoDias > 0) {
    for (const [sku, D] of demandaDiaria) {
      if (D <= 0.005) continue;
      const exceso = Math.max(0, (posicionPorSku.get(sku) ?? 0) - D * horizonte);
      const piezas = Math.floor(p.holguraObjetivoDias * D - exceso);
      if (piezas > 0) holguraPorSku.set(sku, piezas);
    }
  }

  // Producto SIN VENTA: posición mínima de `cajasMinimasSinEstreno` cajas
  // del modelo + color para probarlo. Lo que ya tiene en FBA o viajando en
  // un envío dado de alta descuenta. Primero las cajas de corrida (más
  // tallas), luego las de talla única.
  const pisoPorCaja = new Map<string, number>();
  const sinEstreno: ProductoSinEstrenoFba[] = [];
  for (const [prod, posicionPares] of productosSinVenta) {
    const cajasProd = [...(cajasPorProducto.get(prod) ?? [])].sort(
      (a, b) => b.items.length - a.items.length || b.cajasDisponibles - a.cajasDisponibles,
    );
    if (!cajasProd.length) continue;
    const paresCaja = cajasProd[0].items.reduce((a, it) => a + it.piezas, 0);
    const enPosicion = paresCaja > 0 ? Math.floor(posicionPares / paresCaja) : 0;
    let faltan = p.cajasMinimasSinEstreno - enPosicion;
    if (faltan <= 0) continue;
    const pedidas = faltan;
    const codigos: string[] = [];
    for (const c of cajasProd) {
      if (faltan <= 0) break;
      const toma = Math.min(faltan, c.cajasDisponibles);
      if (toma <= 0) continue;
      pisoPorCaja.set(c.codigo, (pisoPorCaja.get(c.codigo) ?? 0) + toma);
      codigos.push(c.codigo);
      faltan -= toma;
    }
    if (faltan === pedidas) continue;
    sinEstreno.push({ producto: prod, enPosicion, cajas: pedidas - faltan, codigos });
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
    toleranciaRescatePorSku: toleranciaPorSku,
    // En la MITAD, la caja que completa la fracción va OPCIONAL: medias
    // cajas no existen y el usuario decide si esa fracción viaja.
    mediaCajaOpcional: new Set(
      ajustesCorrida.filter((a) => a.regla === "mitad_corrida").map((a) => a.sku),
    ),
    holguraSobrante: holguraPorSku,
    // La caja de un producto NUEVO va firme, nunca opcional.
    sinOpcional: skusNuevos,
    pisoPorCaja,
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

  // Los códigos del piso pueden cambiar al reasignar por bodega (misma caja,
  // otro almacén): se dejan los que de verdad quedaron en el plan, buscando
  // por producto.
  for (const e of sinEstreno) {
    const enPlan = cajas
      .filter((c) => (porCodigo.get(c.codigo)?.producto ?? c.codigo) === e.producto)
      .map((c) => c.codigo);
    if (enPlan.length) e.codigos = enPlan;
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
    productosNuevos: [...productosNuevos.entries()]
      .map(([producto, edad]) => ({
        producto,
        edad,
        skus: [...(skusPorProducto.get(producto) ?? [])].sort(),
      }))
      .sort((a, b) => a.producto.localeCompare(b.producto, "es", { numeric: true })),
    sinEstreno: sinEstreno.sort((a, b) =>
      a.producto.localeCompare(b.producto, "es", { numeric: true }),
    ),
    avisos,
  };
}
