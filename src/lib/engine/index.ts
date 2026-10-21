/**
 * Orquestador: junta stock histórico + demanda + reposición + cajas
 * y devuelve un plan de envío completo.
 */
import { calcularDemanda, ventaPerdida } from "./demand";
import { aISO, proximoEnvio, sumarDias } from "./fechas";
import { normalizarParametros } from "./params";
import { calcularLinea, prioridadFaltante, prioridadSobrante } from "./replenish";
import { reconstruirStockDiario } from "./stockHistory";
import { optimizarCajas } from "./boxes";
import { ajustarCorridaPorHermanas, ajustarNecesidadPorCorrida } from "./corrida";
import { colchonDeSubida } from "./colchon";
import type {
  Caja,
  ISODate,
  InventarioPropio,
  LineaPlan,
  OperacionStock,
  Parametros,
  Plan,
  SkuOverride,
  SnapshotStock,
  StockFull,
  VentaDiaria,
} from "./types";

export * from "./types";
export { PARAMETROS_DEFAULT, normalizarParametros, periodoRevision, ventanaRiesgo, zScore } from "./params";
export { optimizarCajas } from "./boxes";
export { ajustarCorridaPorHermanas, ajustarNecesidadPorCorrida } from "./corrida";
export type { AjusteCorrida, AjusteHermanas, DatosSkuCorrida } from "./corrida";
export { colchonDeSubida } from "./colchon";
export { calcularDemanda } from "./demand";
export { reconstruirStockDiario, calcularFraccionesConStock } from "./stockHistory";
export { calcularLinea } from "./replenish";
export * from "./fechas";

export interface EntradaPlan {
  skus: { sku: string; titulo?: string | null }[];
  stockActual: StockFull[];
  ventas: VentaDiaria[];
  snapshots: SnapshotStock[];
  operaciones: OperacionStock[];
  inventarioPropio: InventarioPropio[];
  cajas: Caja[];
  overrides?: SkuOverride[];
  parametros?: Partial<Parametros>;
  /** Fecha de corte del análisis. Por defecto, hoy. */
  hoy?: ISODate;
  /**
   * SKUs que vendieron ANTES de la ventana analizada. La ventana sola no
   * distingue un lanzamiento de un SKU viejo cuyo historial de fotos empieza
   * tarde: con esto, un producto que ya vendía no se toma por NUEVO.
   */
  skusConVentaPrevia?: Set<string>;
  /**
   * SKUs que vendieron ALGUNA VEZ (toda la historia). Un producto SIN
   * ESTRENO es el que ni aquí ni en la ventana tuvo stock o venta.
   */
  skusConVentaHistorica?: Set<string>;
  /**
   * Pares por SKU que la bodega ya APARTÓ para un envío pendiente. Van
   * dentro de `stockActual.enTransferencia`, pero para la regla del
   * producto SIN VENTA no cuentan como posición: esa caja apartada suele
   * ser el mismo envío que se está armando, y el negocio quiere que el
   * envío lleve las 2 cajas del modelo + color nuevo. Solo descuenta lo
   * que ya está en Full o ya viaja en un envío dado de alta.
   */
  enCaminoBodega?: Map<string, number>;
}

export function generarPlan(e: EntradaPlan): Plan {
  const p = normalizarParametros(e.parametros);
  const hoy = e.hoy ?? aISO(new Date());
  const desde = sumarDias(hoy, -(p.diasHistoria - 1));

  const stockMap = new Map(e.stockActual.map((s) => [s.sku, s]));
  const propioMap = new Map(e.inventarioPropio.map((i) => [i.sku, i.unidades]));
  const overrideMap = new Map((e.overrides ?? []).map((o) => [o.sku, o]));
  const tituloMap = new Map(e.skus.map((s) => [s.sku, s.titulo ?? null]));

  const listaSkus = e.skus.map((s) => s.sku);

  // 1. ¿Qué días tuvo stock cada SKU?
  const historial = reconstruirStockDiario({
    skus: listaSkus,
    desde,
    hasta: hoy,
    stockActual: stockMap,
    snapshots: e.snapshots,
    operaciones: e.operaciones,
    ventas: e.ventas,
  });

  // 2. Demanda real corregida por agotamientos.
  const demandas = new Map(
    listaSkus.map((sku) => [
      sku,
      calcularDemanda(sku, historial.get(sku) ?? [], p, overrideMap.get(sku)),
    ]),
  );

  // 2.1 COLCHÓN DE SUBIDA por producto (modelo + color de sus cajas).
  const productoDeSku = new Map<string, string>();
  for (const c of e.cajas) {
    if (c.cajasDisponibles <= 0) continue;
    const prod = c.producto ?? c.codigo;
    for (const it of c.items) if (!productoDeSku.has(it.sku)) productoDeSku.set(it.sku, prod);
  }
  const colchon =
    p.colchonSubidaFactor > 0 && (p.corridaHermanasMaxDias ?? 0) > 0
      ? colchonDeSubida(productoDeSku, historial, demandas, overrideMap, p)
      : new Map<string, number>();
  const pColchon: typeof p = { ...p, horizonteDias: p.colchonObjetivoDias };

  // 3. Cuánto mandar.
  const lineas: LineaPlan[] = listaSkus.map((sku) => {
    const override = overrideMap.get(sku);
    const demanda = demandas.get(sku)!;
    const prod = productoDeSku.get(sku);
    const factor = prod ? colchon.get(prod) : undefined;
    if (factor) {
      demanda.demandaDiaria *= factor;
      demanda.notas.push(
        `El color va en subida: sus últimos ${p.colchonVentanaDias} días con stock venden ${factor.toFixed(2)}× lo del plan; se usa ese ritmo y el objetivo es de ${p.colchonObjetivoDias} días.`,
      );
    }
    const linea = calcularLinea(
      {
        sku,
        titulo: tituloMap.get(sku) ?? null,
        demanda,
        stock: stockMap.get(sku),
        inventarioPropio: propioMap.get(sku) ?? 0,
        override,
        hoy,
      },
      factor ? pColchon : p,
    );
    if (factor) linea.colchonSubida = factor;
    return linea;
  });

  // Orden operativo: lo que se quema primero, primero.
  const ordenEstado: Record<string, number> = {
    critico: 0, urgente: 1, ok: 2, sobrestock: 3, sin_demanda: 4,
  };
  lineas.sort((a, b) => {
    const d = ordenEstado[a.estado] - ordenEstado[b.estado];
    if (d !== 0) return d;
    return a.coberturaDias - b.coberturaDias;
  });

  // 4.0 Productos (modelo + color) a través de sus cajas: las reglas de
  // producto NUEVO y producto SIN ESTRENO se deciden por producto.
  const lineaPorSku = new Map(lineas.map((l) => [l.sku, l]));
  const skusPorProducto = new Map<string, Set<string>>();
  const cajasPorProducto = new Map<string, Caja[]>();
  for (const c of e.cajas) {
    if (c.cajasDisponibles <= 0 || !c.items.length) continue;
    const prod = c.producto ?? c.codigo;
    let lc = cajasPorProducto.get(prod);
    if (!lc) cajasPorProducto.set(prod, (lc = []));
    lc.push(c);
    let ls = skusPorProducto.get(prod);
    if (!ls) skusPorProducto.set(prod, (ls = new Set()));
    for (const it of c.items) ls.add(it.sku);
  }
  const ventaPrevia = e.skusConVentaPrevia ?? new Set<string>();
  const ventaHistorica = e.skusConVentaHistorica ?? new Set<string>();

  const productosNuevos = new Map<string, number>(); // producto -> días desde el lanzamiento
  // producto SIN VENTA -> pares que ya tiene en posición (Full + en camino)
  const productosSinVenta = new Map<string, number>();
  for (const [prod, skus] of skusPorProducto) {
    const propias = [...skus]
      .map((sk) => lineaPorSku.get(sk))
      .filter((l): l is LineaPlan => l !== undefined);
    // Nada amarrado a MELI: no se puede mandar a Full.
    if (!propias.length) continue;

    // SIN VENTA: ninguna talla ha vendido un par, ni en la ventana ni antes
    // (con o sin stock en Full: una caja parada sin venta no es estreno
    // hecho, y una caja ya apartada para el camión tampoco lo es). Una
    // talla excluida a mano saca al producto de la regla.
    const sinVenta =
      p.cajasMinimasSinEstreno > 0 &&
      propias.every(
        (l) =>
          l.demanda.unidadesTotales === 0 &&
          !ventaHistorica.has(l.sku) &&
          overrideMap.get(l.sku)?.excluir !== true,
      );
    if (sinVenta) {
      // Posición para la regla: sin lo que la bodega apenas apartó.
      productosSinVenta.set(
        prod,
        propias.reduce(
          (a, l) =>
            a + Math.max(l.disponible, l.posicion - (e.enCaminoBodega?.get(l.sku) ?? 0)),
          0,
        ),
      );
      continue;
    }

    // NUEVO: alguna talla se estrenó dentro de la ventana hace menos de
    // `nuevoDias`, ninguna traía datos desde el primer día de la ventana
    // (eso es un producto viejo) y ninguna vendía antes de la ventana.
    if (p.nuevoDias <= 0) continue;
    if (propias.some((l) => ventaPrevia.has(l.sku))) continue;
    let edad = 0;
    let lanzadas = 0;
    let viejo = false;
    for (const l of propias) {
      const d = l.demanda;
      if (d.diasDesdeLanzamiento !== null) {
        lanzadas++;
        edad = Math.max(edad, d.diasDesdeLanzamiento);
      } else if (d.diasEfectivos > 0 || d.unidadesTotales > 0) {
        viejo = true;
      }
    }
    if (lanzadas > 0 && !viejo && edad <= p.nuevoDias) productosNuevos.set(prod, edad);
  }
  const skusNuevos = new Set<string>();
  for (const prod of productosNuevos.keys()) {
    for (const sk of skusPorProducto.get(prod) ?? []) skusNuevos.add(sk);
  }

  // 4. Armado de cajas mixtas.
  const necesidad = new Map<string, number>();
  const prioridad = new Map<string, number>();
  const castigoSobrante = new Map<string, number>();
  const demandaDiaria = new Map<string, number>();
  for (const l of lineas) {
    if (l.sugerido > 0) necesidad.set(l.sku, l.sugerido);
    prioridad.set(l.sku, prioridadFaltante(l, p));
    castigoSobrante.set(
      l.sku,
      prioridadSobrante(l, p, { excluido: overrideMap.get(l.sku)?.excluir === true }),
    );
    demandaDiaria.set(l.sku, l.demanda.demandaDiaria);
  }

  const datosCorrida = new Map(
    lineas.map((l) => [l.sku, { posicion: l.posicion, demandaDiaria: l.demanda.demandaDiaria }]),
  );
  const skusColchon = new Set(
    [...productoDeSku].filter(([, prod]) => colchon.has(prod)).map(([sku]) => sku),
  );
  const reglaHermanas = p.corridaHermanasMaxDias > 0;

  // 4.1 Regla de la corrida. En Full (desde el 21-oct-2026) por HERMANAS:
  // la talla corta cuya caja dejaría a una hermana arriba de 45 días se
  // surte a 15; una talla chica en la caja gotea 1 caja por envío. Con
  // `corridaHermanasMaxDias` en 0 queda la regla vieja (mitad / 7 días).
  // `coberturaSinForzarDias` en 0 = la caja siempre se fuerza: no se recorta.
  const ajustesHermanas = reglaHermanas && p.coberturaSinForzarDias > 0
    ? ajustarCorridaPorHermanas({
        necesidad,
        datos: datosCorrida,
        cajas: e.cajas,
        hermanasMaxDias: p.corridaHermanasMaxDias,
        objetivoCorto: p.coberturaSinForzarDias,
        fraccionTallaChica: p.corridaFraccionTallaChica,
        // Producto NUEVO: se le rellena la caja. Color EN SUBIDA: lo topa el
        // color completo, no las hermanas.
        exentos: new Set([...skusNuevos, ...skusColchon]),
      })
    : [];
  const ajustesCorrida = reglaHermanas
    ? []
    : ajustarNecesidadPorCorrida({
    necesidad,
    datos: datosCorrida,
    cajas: e.cajas,
    horizonteDias: p.horizonteDias,
    factorSobrante: p.corridaSobranteFactor,
    diasDispareja: p.corridaDiasDispareja,
    faltanteGrande: p.corridaFaltanteGrande,
    // A un producto NUEVO se le rellena la caja: la regla no lo recorta.
    exentos: skusNuevos,
    // Si la caja va a forzar otras tallas, la talla solo la fuerza con
    // menos de `coberturaSinForzarDias` (15) de stock.
    coberturaSinForzar: p.coberturaSinForzarDias,
  });
  // Una necesidad recortada se surte COMPLETA (tolerancia 0): el recorte ya
  // es la concesión, y quedarse además a un par del objetivo dejaba GT155
  // BEIGE en 1 caja cuando la regla pedía las 2 que cubren los 7 días.
  // En la práctica esto redondea el recorte a cajas hacia arriba.
  const toleranciaPorSku = new Map<string, number>(
    ajustesCorrida
      .filter((a) => a.regla !== "cobertura_suficiente")
      .map((a) => [a.sku, 0]),
  );
  // Lo que la regla por hermanas recortó (o el goteo) va completo y firme.
  for (const a of ajustesHermanas) {
    if (a.regla !== "cobertura_suficiente") toleranciaPorSku.set(a.sku, 0);
  }
  // Y el rescate del optimizador obedece lo mismo: una talla a la que le
  // alcanza el stock para `coberturaSinForzarDias` no arrastra una caja
  // que sus hermanas no piden. Solo la caja que el costo justifique. (Con
  // la regla por hermanas esto ya lo decidió ella talla por talla.)
  if (p.coberturaSinForzarDias > 0 && !reglaHermanas) {
    for (const l of lineas) {
      if (!necesidad.has(l.sku) || toleranciaPorSku.has(l.sku) || skusNuevos.has(l.sku)) continue;
      if (l.coberturaDias >= p.coberturaSinForzarDias) {
        toleranciaPorSku.set(l.sku, Number.POSITIVE_INFINITY);
      }
    }
  }
  // En la MITAD, la caja que completa la fracción (media caja no existe)
  // sube marcada OPCIONAL para que el usuario decida.
  const mediaCaja = new Set(
    ajustesCorrida.filter((a) => a.regla === "mitad_corrida").map((a) => a.sku),
  );
  for (const a of ajustesCorrida) {
    const l = lineaPorSku.get(a.sku);
    if (!l) continue;
    l.sugeridoCompleto = a.necesidadOriginal;
    l.sugerido = a.necesidadAjustada;
    l.faltanteBodega = Math.max(0, a.necesidadAjustada - l.inventarioPropio);
    l.ajusteCorrida = a.regla;
    l.explicacion +=
      a.regla === "cobertura_suficiente"
        ? ` Su caja sobre-surtiría a las demás tallas de la corrida y a esta talla todavía le alcanza el stock para ${p.coberturaSinForzarDias} días: no se fuerza la caja, espera al siguiente envío.`
        : a.regla === "mitad_corrida"
        ? ` Su caja sobre-surtiría a las demás tallas de la corrida, pero van al día (posición ≤ ${p.corridaSobranteFactor}× su venta de ${p.horizonteDias} días): se manda la MITAD (${a.necesidadAjustada} de ${a.necesidadOriginal} pzas). Si la mitad no cierra en cajas completas, la caja de la fracción sube marcada OPCIONAL.`
        : ` Su caja sobre-surtiría a las demás tallas y la corrida ya está dispareja (alguna hermana con más de ${p.corridaSobranteFactor}× su venta de ${p.horizonteDias} días, y el faltante junto no pasa de ${p.corridaFaltanteGrande} pares): solo viajan ${p.corridaDiasDispareja} días de su venta por envío (${a.necesidadAjustada} de ${a.necesidadOriginal} pzas).`;
  }

  for (const a of ajustesHermanas) {
    const l = lineaPorSku.get(a.sku);
    if (!l) continue;
    l.sugeridoCompleto = a.necesidadOriginal;
    l.sugerido = a.necesidadAjustada;
    l.faltanteBodega = Math.max(0, a.necesidadAjustada - l.inventarioPropio);
    l.ajusteCorrida = a.regla;
    const peor = Number.isFinite(a.peorHermanaDias) ? `${Math.round(a.peorHermanaDias)} días` : "stock sin venta";
    l.explicacion +=
      a.regla === "cobertura_suficiente"
        ? ` Su caja dejaría a una talla hermana con ${peor} (más de ${p.corridaHermanasMaxDias}) y a esta talla todavía le alcanza para ${p.coberturaSinForzarDias} días: no se fuerza la caja, espera al siguiente envío.`
        : a.regla === "quince_dias"
        ? ` Su caja dejaría a una talla hermana con ${peor} (más de ${p.corridaHermanasMaxDias}): esta talla solo se surte a ${p.coberturaSinForzarDias} días (${a.necesidadAjustada} de ${a.necesidadOriginal} pzas) y se va mandando en cada envío.`
        : ` Trae muy pocos pares en su caja o sus hermanas ya pasan de ${p.corridaHermanasMaxDias} días: viaja UNA caja por envío (goteo).`;
  }

  // 4.1b COLCHÓN DE SUBIDA: el color se surte a 45 días, pero la corrida
  // solo se fuerza mientras el color completo no pase del tope (60 días a
  // su ritmo). La caja que cruza el tope sí va.
  const porProducto = new Map<string, LineaPlan[]>();
  for (const l of lineas) {
    const prod = productoDeSku.get(l.sku);
    if (!prod || !colchon.has(prod)) continue;
    const lst = porProducto.get(prod);
    if (lst) lst.push(l);
    else porProducto.set(prod, [l]);
  }
  for (const [prod, ls] of porProducto) {
    const ritmo = ls.reduce((a, l) => a + l.demanda.demandaDiaria, 0);
    const pos = ls.reduce((a, l) => a + l.posicion, 0);
    const caben = p.colchonTopeColorDias * ritmo - pos;
    const cajasProd = cajasPorProducto.get(prod) ?? [];
    for (const l of ls) {
      const pedida = necesidad.get(l.sku) ?? 0;
      if (pedida <= 0) continue;
      let piezas = 0;
      let total = 0;
      for (const c of cajasProd) {
        const pz = c.items.find((it) => it.sku === l.sku)?.piezas ?? 0;
        if (pz > piezas) {
          piezas = pz;
          total = c.items.reduce((a, it) => a + it.piezas, 0);
        }
      }
      if (piezas <= 0 || total <= 0) continue;
      const porTope = caben > 0 ? Math.ceil(caben / total) : 0;
      // Y nunca más de `colchonMaxCajasEnvio` (5) cajas del color por envío:
      // el colchón ve subidas de 2 a 3 veces que Daniel no persigue de un
      // jalón (GT252, GT122, GT229 DK BROWN); lo demás va en los siguientes.
      const porEnvio = p.colchonMaxCajasEnvio > 0 ? p.colchonMaxCajasEnvio : Infinity;
      const maxCajas = Math.min(porTope, porEnvio);
      const tope = maxCajas * piezas;
      toleranciaPorSku.set(l.sku, 0);
      if (pedida <= tope) continue;
      if (tope > 0) necesidad.set(l.sku, tope);
      else necesidad.delete(l.sku);
      l.sugeridoCompleto = pedida;
      l.sugerido = tope;
      l.faltanteBodega = Math.max(0, tope - l.inventarioPropio);
      l.ajusteCorrida = "tope_color";
      l.explicacion +=
        porEnvio < porTope
          ? ` El color va en subida, pero con colchón viajan a lo más ${porEnvio} cajas del color por envío: ${tope} de ${pedida} pzas; lo demás en los siguientes envíos.`
          : ` El color va en subida pero no pasa de ${p.colchonTopeColorDias} días a su ritmo (${Math.round(ritmo * 10) / 10}/día): caben ${maxCajas} caja(s), así que viajan ${tope} de ${pedida} pzas.`;
    }
  }

  // 4.2 Producto NUEVO (decisión del dueño, sep-2026): lanzado hace menos
  // de `nuevoDias`, en crecimiento. Cualquier faltante fuerza su caja —sin
  // la tolerancia de rescate de 7 días— y la caja va firme, nunca opcional:
  // si no se le surte, nunca va a pagar.
  for (const prod of productosNuevos.keys()) {
    const edad = productosNuevos.get(prod) ?? 0;
    for (const sk of skusPorProducto.get(prod) ?? []) {
      const l = lineaPorSku.get(sk);
      if (!l) continue;
      l.productoNuevo = true;
      if (necesidad.has(sk)) toleranciaPorSku.set(sk, 0);
      l.explicacion += ` Producto NUEVO (se estrenó en Full hace ${edad} días): cualquier faltante fuerza su caja, sin tolerancia de rescate, y la caja va firme.`;
    }
  }

  // 4.3 Holgura sobre el objetivo (decisión del dueño, sep-2026): quedar en
  // horizonte + holgura días (32 en vez de 30) no es sobre-surtir. En
  // piezas por SKU, descontando lo que ya traiga arriba de su objetivo.
  const holguraPorSku = new Map<string, number>();
  if (p.holguraObjetivoDias > 0) {
    for (const l of lineas) {
      const D = l.demanda.demandaDiaria;
      if (D <= 0.005) continue;
      const exceso = Math.max(0, l.posicion - l.nivelObjetivo);
      const piezas = Math.floor(p.holguraObjetivoDias * D - exceso);
      if (piezas > 0) holguraPorSku.set(l.sku, piezas);
    }
  }

  // 4.4 Producto SIN VENTA (decisión del dueño, sep-2026): nunca ha vendido
  // un par en Full y hay cajas en alguna bodega → se le sostiene una
  // POSICIÓN mínima de `cajasMinimasSinEstreno` cajas del modelo + color
  // para probarlo. Lo que ya tiene en Full o viajando en un envío dado de
  // alta descuenta del mínimo; lo que la bodega apenas apartó NO (decisión
  // del dueño: el envío del producto nuevo lleva sus 2 cajas). Primero las
  // cajas de corrida (más tallas), luego las de talla única.
  const pisoPorCaja = new Map<string, number>();
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
    for (const c of cajasProd) {
      if (faltan <= 0) break;
      const toma = Math.min(faltan, c.cajasDisponibles);
      if (toma <= 0) continue;
      pisoPorCaja.set(c.codigo, (pisoPorCaja.get(c.codigo) ?? 0) + toma);
      faltan -= toma;
    }
    if (faltan === pedidas) continue;
    for (const sk of skusPorProducto.get(prod) ?? []) {
      const l = lineaPorSku.get(sk);
      if (!l) continue;
      l.sinEstreno = true;
      l.explicacion += ` Producto SIN VENTA en Full (nunca ha vendido un par): se le sostiene una posición mínima de ${p.cajasMinimasSinEstreno} cajas del modelo + color para probarlo; ya trae ${enPosicion} en Full o en envío dado de alta, así que viajan ${pedidas - faltan} más.`;
    }
  }

  const planCajas = optimizarCajas({
    necesidad,
    prioridad,
    castigoSobrante,
    demandaDiaria,
    cajas: e.cajas,
    permiteUnidadesSueltas: p.permiteUnidadesSueltas,
    inventarioSuelto: propioMap,
    pesoFaltante: p.pesoFaltante,
    pesoSobrante: p.pesoSobrante,
    // Una talla fuerza caja completa cuando su hueco pasa de ~7 días de su
    // venta; los huecos menores esperan al siguiente envío (hay 2 por
    // semana). La tolerancia vieja de horizonte − 7 (~23 días) dejaba a las
    // tallas RÁPIDAS morir a medias: GT135 DK BROWN 27 vendía 3.1/día con
    // 12 días de cobertura y el rescate no subía cajas porque su hueco
    // "solo" era de 22 días. El sobre-surtido que esa tolerancia evitaba
    // ahora lo controla la regla de la corrida despareja, que recorta ANTES
    // del optimizador las tallas cuya caja viaja mayormente de lastre.
    toleranciaRescateDias: Math.min(Math.max(2, p.horizonteDias - 7), 7),
    toleranciaRescatePorSku: toleranciaPorSku,
    mediaCajaOpcional: mediaCaja,
    holguraSobrante: holguraPorSku,
    sinOpcional: skusNuevos,
    pisoPorCaja,
    maxCajas: p.maxCajasPorEnvio,
    maxPiezas: p.maxPiezasPorEnvio,
  });

  // 5. Resumen.
  const resumen = {
    generadoEn: new Date().toISOString(),
    skusAnalizados: lineas.length,
    skusCriticos: lineas.filter((l) => l.estado === "critico").length,
    skusUrgentes: lineas.filter((l) => l.estado === "urgente").length,
    skusSobrestock: lineas.filter((l) => l.estado === "sobrestock").length,
    skusConQuiebreHistorico: lineas.filter((l) => l.demanda.diasSinStock >= 3).length,
    piezasSugeridas: lineas.reduce((a, l) => a + l.sugerido, 0),
    piezasPlaneadas: planCajas.totalPiezas,
    totalCajas: planCajas.totalCajas,
    ventaPerdidaEstimada: lineas.reduce((a, l) => a + ventaPerdida(l.demanda), 0),
    proximoEnvio: proximoEnvio(hoy, p.enviosPorSemana),
  };

  return { parametros: p, resumen, lineas, cajas: planCajas };
}
