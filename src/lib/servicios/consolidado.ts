/**
 * Corte GENERAL del mes: calzado en Mercado Libre, fundas en Mercado Libre y
 * Amazon, todo junto, con la ganancia total y por categoría y modelo.
 *
 * La regla del dueño para repartir: la publicidad ya viene por modelo (API
 * de Product Ads / SKU Economics de Amazon) y se descuenta al modelo que la
 * gastó. Los GASTOS GENERALES de cada plataforma —almacenamiento y colecta
 * de Full, cargos de FBA, otros cargos, devoluciones netas del costo
 * recuperado, publicidad sin amarre y gastos a mano— se dividen entre las
 * unidades vendidas en esa plataforma: cada par carga con su parte, y así
 * la ganancia por modelo y por categoría sí es lo que de verdad quedó.
 *
 * Todo en centavos enteros, como el corte de cada canal.
 */
import type { EstadoResultados } from "./corte-meli";
import type { GastoEmpresarial } from "./gastos-empresariales";

export type Canal = "meli_calzado" | "meli_fundas" | "amazon" | "tiktok";

export const NOMBRE_CANAL: Record<Canal, string> = {
  meli_calzado: "Calzado · Mercado Libre",
  meli_fundas: "Fundas · Mercado Libre",
  amazon: "Amazon",
  tiktok: "TikTok Shop",
};

/** Lo que cada canal aporta al consolidado, en pesos. */
export interface BloqueCanal {
  canal: Canal;
  unidades: number;
  ordenes: number;
  ventaBruta: number;
  /** Neto después de cargos de plataforma. No siempre equivale a dinero ya depositado. */
  neto: number;
  /** Fuente contable concreta usada para el neto del canal. */
  fuenteNeto: string;
  /** Parte de la venta bruta cubierta por la fuente contable; null cuando no son rangos comparables. */
  coberturaNeto: number | null;
  /** Deducciones ya incluidas en el neto; se muestran para conciliación y no se vuelven a restar. */
  descuentos: { concepto: string; monto: number }[];
  desglosePlataforma?: { comision: number; envio: number; isr: number; iva: number; otros: number; ajusteLiquidacion?: number };
  /** False únicamente en cortes históricos creados antes de guardar este desglose. */
  desgloseDisponible?: boolean;
  devoluciones: number;
  devolucionesIncluidasEnNeto?: number;
  ajusteLiquidacion?: number;
  costoRecuperado: number;
  costoProducto: number;
  unidadesConCosto: number;
  /** publicidad amarrada a modelos (suma de porModelo.ads) */
  adsPorModelo: number;
  /** publicidad sin amarre + a mano */
  adsGenerales: number;
  /** gastos generales de la plataforma, por concepto */
  gastos: { concepto: string; monto: number }[];
  porModelo: {
    modelo: string; categoria: string | null; unidades: number; importe: number;
    comision?: number; envio?: number; isr?: number; iva?: number; otros?: number; ajusteLiquidacion?: number;
    neto: number; costo: number | null; ads: number;
  }[];
  avisos: string[];
  exacto: boolean;
}

export interface FilaModeloConsolidado {
  modelo: string;
  categoria: string;
  canales: Canal[];
  unidades: number;
  importe: number;
  comision: number;
  envio: number;
  isr: number;
  iva: number;
  otros: number;
  ajusteLiquidacion: number;
  neto: number;
  costo: number | null;
  ads: number;
  /** la parte de gastos generales que carga el modelo (cargo por unidad × unidades) */
  cargoGeneral: number;
  ganancia: number | null;
}

export interface FilaCategoriaConsolidado {
  categoria: string;
  unidades: number;
  importe: number;
  comision: number;
  envio: number;
  isr: number;
  iva: number;
  otros: number;
  ajusteLiquidacion: number;
  neto: number;
  costo: number | null;
  ads: number;
  cargoGeneral: number;
  ganancia: number | null;
  porCanal: Partial<Record<Canal, { unidades: number; ganancia: number | null }>>;
}

export interface CanalConsolidado extends Omit<BloqueCanal, "porModelo" | "gastos" | "desglosePlataforma"> {
  nombre: string;
  gastos: { concepto: string; monto: number }[];
  desglosePlataforma: { comision: number; envio: number; isr: number; iva: number; otros: number; ajusteLiquidacion: number };
  desgloseDisponible: boolean;
  gastosGenerales: number;
  descuentosPlataforma: number;
  /**
   * False cuando la fuente del neto no cubre NADA de la venta (0 %): el
   * canal se enseña como «no calculable» y queda FUERA del total y del
   * margen. Mayo 2026 de calzado salía como una columna de ceros —venta
   * $1.97 M, deducciones $1.97 M, neto $0, margen 0 %— cuando lo cierto
   * era que no había una sola orden cargada (decisión del dueño, 6-oct-2026).
   */
  calculable: boolean;
  /** la parte de la venta bruta que SÍ tiene neto leído (venta × cobertura) */
  ventaCubierta: number;
  /** gastos generales ÷ unidades vendidas en la plataforma */
  cargoPorUnidad: number;
  utilidadBruta: number;
  publicidad: number;
  utilidadNeta: number;
  margen: number | null;
  gananciaPorUnidad: number | null;
  porModelo: FilaModeloConsolidado[];
}

export interface Consolidado {
  /**
   * Invalida cachés calculadas con reglas contables anteriores. También es
   * el candado contra un DESPLIEGUE VIEJO: la base es una sola y cualquier
   * build que alguien abra escribe en ella. El 10-sep-2026 una URL de
   * preview anterior al 9-sep guardó el corte general de julio con el
   * Amazon de antes de la Finances API y los cortes de canal viejos, y la
   * pantalla lo sirvió como bueno. Al subir el número, lo que escribió un
   * build que no conoce estas reglas se descarta y se vuelve a calcular.
   */
  versionContable: 8;
  periodo: string;
  desde: string;
  hasta: string;
  generadoEn: string;
  canales: CanalConsolidado[];
  gastosEmpresariales: GastoEmpresarial[];
  total: {
    unidades: number;
    ordenes: number;
    ventaBruta: number;
    /** venta con neto leído, sumando solo los canales calculables: el denominador del margen */
    ventaCubierta: number;
    /** venta de los canales NO calculables: se declara, no se suma */
    ventaSinCalcular: number;
    unidadesSinCalcular: number;
    canalesSinCalcular: Canal[];
    neto: number;
    coberturaNeto: number | null;
    descuentosPlataforma: number;
    desgloseDisponible: boolean;
    comision: number;
    envio: number;
    isr: number;
    iva: number;
    otros: number;
    ajusteLiquidacion: number;
    devoluciones: number;
    devolucionesIncluidasEnNeto: number;
    costoRecuperado: number;
    costoProducto: number;
    coberturaCosto: number;
    publicidad: number;
    gastosGenerales: number;
    utilidadAntesGastosEmpresariales: number;
    gastosEmpresariales: number;
    utilidadNeta: number;
    margenSobreVenta: number | null;
    margenSobreNeto: number | null;
    gananciaPorUnidad: number | null;
  };
  porCategoria: FilaCategoriaConsolidado[];
  porModelo: FilaModeloConsolidado[];
  avisos: string[];
  exacto: boolean;
}

const c = (x: number | null | undefined): number => Math.round((Number(x) || 0) * 100);
const p = (cent: number): number => Math.round(cent) / 100;

/**
 * Los gastos empresariales son una capa liviana sobre el consolidado pesado:
 * permite combinarlos al leer la caché sin recalcular los tres canales.
 */
/** Un monto repartido entre unidades vendidas; sin unidades no hay reparto (null, nunca cero). */
export function porUnidad(monto: number, unidades: number): number | null {
  return unidades > 0 ? Math.round((monto / unidades) * 100) / 100 : null;
}

/** Las unidades de los canales que SÍ se calculan: el denominador de los repartos del total. */
export function unidadesCalculables(cns: Pick<Consolidado, "canales">): number {
  return cns.canales.filter((k) => k.calculable !== false).reduce((s, k) => s + k.unidades, 0);
}

/** La publicidad del total que sí quedó amarrada a un modelo (la general ya va en gastos generales). */
export function adsPorModeloTotal(cns: Pick<Consolidado, "canales" | "total">): number {
  return Math.round((cns.total.publicidad - cns.canales.reduce((a, k) => a + k.adsGenerales, 0)) * 100) / 100;
}

/**
 * Los repartos por unidad del corte: publicidad por modelo, gastos generales
 * y los dos juntos, por canal y en el total (pedido del dueño, 7-oct-2026:
 * «aquí no se divide el total de publicidad y gastos generales entre
 * unidades»). Se calculan al enseñar, a partir de lo ya guardado: un corte
 * masticado antes de este cambio los trae igual.
 */
export function repartosPorUnidad(cns: Pick<Consolidado, "canales" | "total">): {
  canal: Record<Canal, { publicidad: number | null; general: number | null; ambos: number | null }>;
  total: { publicidad: number | null; general: number | null; ambos: number | null };
} {
  const canal = {} as Record<Canal, { publicidad: number | null; general: number | null; ambos: number | null }>;
  for (const k of cns.canales) {
    canal[k.canal] = {
      publicidad: porUnidad(k.adsPorModelo, k.unidades),
      general: porUnidad(k.gastosGenerales, k.unidades),
      ambos: porUnidad(k.adsPorModelo + k.gastosGenerales, k.unidades),
    };
  }
  const u = unidadesCalculables(cns);
  const ads = adsPorModeloTotal(cns);
  return {
    canal,
    total: {
      publicidad: porUnidad(ads, u),
      general: porUnidad(cns.total.gastosGenerales, u),
      ambos: porUnidad(ads + cns.total.gastosGenerales, u),
    },
  };
}

export function aplicarGastosEmpresariales(consolidado: Consolidado, gastos: GastoEmpresarial[]): Consolidado {
  const totalGastos = gastos.reduce((s, g) => s + c(g.monto), 0);
  const utilidadAntes = c(consolidado.total.utilidadAntesGastosEmpresariales ?? consolidado.total.utilidadNeta);
  const utilidadNeta = utilidadAntes - totalGastos;
  return {
    ...consolidado,
    gastosEmpresariales: gastos,
    total: {
      ...consolidado.total,
      utilidadAntesGastosEmpresariales: p(utilidadAntes),
      gastosEmpresariales: p(totalGastos),
      utilidadNeta: p(utilidadNeta),
      // Sobre la venta CON neto leído: una venta cuyo neto no se conoce no
      // puede diluir el margen (cachés viejas sin el campo caen a la bruta).
      margenSobreVenta: c(consolidado.total.ventaCubierta ?? consolidado.total.ventaBruta) > 0
        ? utilidadNeta / c(consolidado.total.ventaCubierta ?? consolidado.total.ventaBruta)
        : null,
      margenSobreNeto: consolidado.total.neto > 0 ? utilidadNeta / c(consolidado.total.neto) : null,
      gananciaPorUnidad: consolidado.total.unidades > 0 ? p(utilidadNeta / consolidado.total.unidades) : null,
    },
  };
}

/** El bloque de un canal de MELI (calzado o fundas) a partir de su estado de resultados. */
export function bloqueDesdeEstado(canal: Canal, e: EstadoResultados): BloqueCanal {
  const gastos: { concepto: string; monto: number }[] = [];
  if (e.full.total) gastos.push({ concepto: "Gastos de Full (almacenamiento, colecta, incumplimientos)", monto: e.full.total });
  if (e.otros.total) gastos.push({ concepto: "Otros cargos y gastos", monto: e.otros.total });
  const devNeta = p(c(e.devoluciones.monto) - c(e.devoluciones.costoRecuperado));
  if (devNeta) gastos.push({ concepto: "Devoluciones (reembolsos menos costo recuperado)", monto: devNeta });
  const adsGenerales = p(c(e.publicidad.sinAmarre) + c(e.publicidad.manual));
  if (adsGenerales) gastos.push({ concepto: "Publicidad sin amarre a modelo y a mano", monto: adsGenerales });
  const tieneDesglose = e.envio != null || e.isr != null || e.iva != null || e.otrosCargos != null || e.cargosSinDesglosar != null;
  const otrosVenta = p(c(e.otrosCargos) + c(e.cargosSinDesglosar) + (tieneDesglose ? 0 : c(e.enviosYOtros)));
  const desglosePlataforma = {
    comision: e.comision,
    envio: e.envio ?? 0,
    isr: e.isr ?? 0,
    iva: e.iva ?? 0,
    otros: otrosVenta,
    ajusteLiquidacion: e.ajusteLiquidacion ?? 0,
  };
  return {
    canal,
    unidades: e.unidades,
    ordenes: e.ordenes,
    ventaBruta: e.ventaBruta,
    neto: e.netoDepositado,
    fuenteNeto:
      e.coberturaNetoReal >= 0.999
        ? "Mercado Pago por orden"
        : "Mercado Pago por orden (la venta sin depósito leído NO está incluida)",
    coberturaNeto: e.coberturaNetoReal,
    // Sin un solo depósito leído no hay desglose que enseñar: la comisión
    // por renglón existe, pero envío, retenciones y residual salen de los
    // pagos, y no hay ninguno. Se pinta «No disponible», no ceros.
    desgloseDisponible: e.coberturaNetoReal > 0,
    descuentos: [
      ...(e.comision ? [{ concepto: "Comisión de venta de Mercado Libre", monto: e.comision }] : []),
      ...(desglosePlataforma.envio ? [{ concepto: "Envío", monto: desglosePlataforma.envio }] : []),
      ...(desglosePlataforma.isr ? [{ concepto: "Retención ISR", monto: desglosePlataforma.isr }] : []),
      ...(desglosePlataforma.iva ? [{ concepto: "Retención IVA", monto: desglosePlataforma.iva }] : []),
      ...(desglosePlataforma.otros ? [{ concepto: "Otros cargos incluidos en el neto", monto: desglosePlataforma.otros }] : []),
      ...(desglosePlataforma.ajusteLiquidacion ? [{ concepto: "Ajuste posterior de liquidación", monto: desglosePlataforma.ajusteLiquidacion }] : []),
    ],
    desglosePlataforma,
    devoluciones: e.devoluciones.monto,
    devolucionesIncluidasEnNeto: e.devoluciones.incluidoEnNeto ?? 0,
    ajusteLiquidacion: e.ajusteLiquidacion ?? 0,
    costoRecuperado: e.devoluciones.costoRecuperado,
    costoProducto: e.costoProducto,
    unidadesConCosto: e.unidadesConCosto,
    adsPorModelo: p(c(e.publicidad.ads) - c(e.publicidad.sinAmarre)),
    adsGenerales,
    gastos,
    porModelo: e.porModelo.map((m) => ({
      modelo: m.modelo,
      categoria: m.categoria,
      unidades: m.unidades,
      importe: m.importe,
      comision: m.comision,
      envio: m.envio,
      isr: m.isr,
      iva: m.iva,
      otros: m.otrosCargos,
      ajusteLiquidacion: m.ajusteLiquidacion,
      neto: m.neto,
      costo: m.costo,
      ads: m.publicidad,
    })),
    avisos: e.avisos,
    exacto: e.revision.exacto,
  };
}

/** Un modelo con su parte de gastos generales y su ganancia. */
function filaModelo(
  m: BloqueCanal["porModelo"][number],
  canal: Canal,
  cargoPorUnidadCent: number,
): FilaModeloConsolidado {
  const cargo = Math.round(cargoPorUnidadCent * m.unidades);
  return {
    modelo: m.modelo,
    categoria: m.categoria ?? "Sin categoría",
    canales: [canal],
    unidades: m.unidades,
    importe: m.importe,
    comision: m.comision ?? 0,
    envio: m.envio ?? 0,
    isr: m.isr ?? 0,
    iva: m.iva ?? 0,
    otros: m.otros ?? 0,
    ajusteLiquidacion: m.ajusteLiquidacion ?? 0,
    neto: m.neto,
    costo: m.costo,
    ads: m.ads,
    cargoGeneral: p(cargo),
    ganancia: m.costo == null ? null : p(c(m.neto) - c(m.costo) - c(m.ads) - cargo),
  };
}

export function armarConsolidado(entrada: {
  periodo: string;
  desde: string;
  hasta: string;
  generadoEn?: string;
  bloques: BloqueCanal[];
  gastosEmpresariales?: GastoEmpresarial[];
  avisos?: string[];
}): Consolidado {
  const avisos: string[] = [...(entrada.avisos ?? [])];
  const canales: CanalConsolidado[] = [];
  const modelos = new Map<string, FilaModeloConsolidado>();
  const categorias = new Map<string, FilaCategoriaConsolidado & { conCosto: boolean; sinCosto: boolean }>();

  const canalesSinCalcular: Canal[] = [];
  const total = {
    unidades: 0, ordenes: 0, ventaBruta: 0, neto: 0, ventaConCoberturaNeto: 0,
    ventaCubierta: 0, ventaSinCalcular: 0, unidadesSinCalcular: 0,
    descuentosPlataforma: 0, comision: 0, envio: 0, isr: 0, iva: 0, otros: 0, ajusteLiquidacion: 0,
    devoluciones: 0, devolucionesIncluidasEnNeto: 0, costoRecuperado: 0, costoProducto: 0, unidadesConCosto: 0,
    publicidad: 0, gastosGenerales: 0, utilidadNeta: 0,
  };

  for (const b of entrada.bloques) {
    const gastosGenerales = b.gastos.reduce((a, g) => a + c(g.monto), 0);
    const descuentosPlataforma = b.descuentos.reduce((a, d) => a + c(d.monto), 0);
    const desgloseBase = b.desglosePlataforma ?? {
      comision: 0, envio: 0, isr: 0, iva: 0, otros: p(descuentosPlataforma),
    };
    const desglosePlataforma = {
      ...desgloseBase,
      ajusteLiquidacion: desgloseBase.ajusteLiquidacion ?? b.ajusteLiquidacion ?? 0,
    };
    const desgloseDisponible = b.desgloseDisponible !== false;
    // Un canal cuya fuente no cubre NADA de su venta no se pinta ni se
    // suma: su columna sería una fila de ceros con cara de dato real. Se
    // conserva en la lista (con su venta declarada) y fuera del total.
    // Cobertura null = la fuente no es comparable con la venta (Amazon por
    // fecha de asiento): se confía en ella.
    const calculable = b.coberturaNeto == null || b.coberturaNeto > 0;
    const ventaCubiertaCent = b.coberturaNeto == null ? c(b.ventaBruta) : Math.round(c(b.ventaBruta) * b.coberturaNeto);
    if (!calculable) {
      canalesSinCalcular.push(b.canal);
      total.ventaSinCalcular += c(b.ventaBruta);
      total.unidadesSinCalcular += b.unidades;
      canales.push({
        ...b,
        nombre: NOMBRE_CANAL[b.canal],
        calculable: false,
        ventaCubierta: 0,
        neto: 0,
        descuentos: [],
        devoluciones: 0,
        devolucionesIncluidasEnNeto: 0,
        costoRecuperado: 0,
        costoProducto: 0,
        unidadesConCosto: 0,
        adsPorModelo: 0,
        adsGenerales: 0,
        gastos: [],
        gastosGenerales: 0,
        descuentosPlataforma: 0,
        desglosePlataforma: { comision: 0, envio: 0, isr: 0, iva: 0, otros: 0, ajusteLiquidacion: 0 },
        desgloseDisponible: false,
        cargoPorUnidad: 0,
        utilidadBruta: 0,
        publicidad: 0,
        utilidadNeta: 0,
        margen: null,
        gananciaPorUnidad: null,
        porModelo: [],
        exacto: false,
      });
      avisos.push(
        `${NOMBRE_CANAL[b.canal]}: NO CALCULABLE este mes. La fuente del neto no cubre nada de su venta (${p(c(b.ventaBruta)).toLocaleString("es-MX", { style: "currency", currency: "MXN" })}, ${b.unidades.toLocaleString("es-MX")} unidades): el canal queda FUERA del total y del margen hasta que se carguen sus órdenes y depósitos.`,
      );
      for (const a of b.avisos) avisos.push(`${NOMBRE_CANAL[b.canal]}: ${a}`);
      continue;
    }
    const cargoPorUnidadCent = b.unidades > 0 ? gastosGenerales / b.unidades : 0;
    const publicidad = c(b.adsPorModelo) + c(b.adsGenerales);
    // La utilidad del canal: neto − devoluciones + costo recuperado − costo − publicidad − Full/otros.
    // (los gastos generales ya incluyen devoluciones netas y ads generales)
    const utilidadBruta = c(b.neto) - c(b.costoProducto);
    const utilidadNeta = utilidadBruta - c(b.adsPorModelo) - gastosGenerales;

    const porModelo = b.porModelo.map((m) => filaModelo(m, b.canal, cargoPorUnidadCent)).sort((x, y) => y.neto - x.neto);
    canales.push({
      ...b,
      nombre: NOMBRE_CANAL[b.canal],
      gastosGenerales: p(gastosGenerales),
      descuentosPlataforma: p(descuentosPlataforma),
      desglosePlataforma,
      desgloseDisponible,
      cargoPorUnidad: p(cargoPorUnidadCent),
      utilidadBruta: p(utilidadBruta),
      publicidad: p(publicidad),
      utilidadNeta: p(utilidadNeta),
      calculable: true,
      ventaCubierta: p(ventaCubiertaCent),
      // El margen va sobre la venta con neto leído: con el 29 % de los
      // depósitos, dividir entre toda la venta inventaba un margen de 9 %
      // para un canal que sobre lo que sí se sabe daba mucho más.
      margen: ventaCubiertaCent > 0 ? utilidadNeta / ventaCubiertaCent : null,
      gananciaPorUnidad: b.unidades > 0 ? p(utilidadNeta / b.unidades) : null,
      porModelo,
    });
    for (const a of b.avisos) avisos.push(`${NOMBRE_CANAL[b.canal]}: ${a}`);

    total.unidades += b.unidades;
    total.ordenes += b.ordenes;
    total.ventaBruta += c(b.ventaBruta);
    total.neto += c(b.neto);
    total.ventaCubierta += ventaCubiertaCent;
    if (b.coberturaNeto != null) total.ventaConCoberturaNeto += c(b.ventaBruta) * b.coberturaNeto;
    total.descuentosPlataforma += descuentosPlataforma;
    total.comision += c(desglosePlataforma.comision);
    total.envio += c(desglosePlataforma.envio);
    total.isr += c(desglosePlataforma.isr);
    total.iva += c(desglosePlataforma.iva);
    total.otros += c(desglosePlataforma.otros);
    total.ajusteLiquidacion += c(desglosePlataforma.ajusteLiquidacion);
    total.devoluciones += c(b.devoluciones);
    total.devolucionesIncluidasEnNeto += c(b.devolucionesIncluidasEnNeto);
    total.costoRecuperado += c(b.costoRecuperado);
    total.costoProducto += c(b.costoProducto);
    total.unidadesConCosto += b.unidadesConCosto;
    total.publicidad += publicidad;
    total.gastosGenerales += gastosGenerales;
    total.utilidadNeta += utilidadNeta;

    // Por modelo y por categoría, a través de los canales.
    for (const f of porModelo) {
      const m = modelos.get(f.modelo);
      if (!m) {
        modelos.set(f.modelo, { ...f });
      } else {
        m.canales = [...new Set([...m.canales, ...f.canales])];
        m.unidades += f.unidades;
        m.importe = p(c(m.importe) + c(f.importe));
        m.comision = p(c(m.comision) + c(f.comision));
        m.envio = p(c(m.envio) + c(f.envio));
        m.isr = p(c(m.isr) + c(f.isr));
        m.iva = p(c(m.iva) + c(f.iva));
        m.otros = p(c(m.otros) + c(f.otros));
        m.ajusteLiquidacion = p(c(m.ajusteLiquidacion) + c(f.ajusteLiquidacion));
        m.neto = p(c(m.neto) + c(f.neto));
        m.ads = p(c(m.ads) + c(f.ads));
        m.cargoGeneral = p(c(m.cargoGeneral) + c(f.cargoGeneral));
        m.costo = m.costo == null || f.costo == null ? null : p(c(m.costo) + c(f.costo));
        m.ganancia = m.ganancia == null || f.ganancia == null ? null : p(c(m.ganancia) + c(f.ganancia));
        if (!m.categoria || m.categoria === "Sin categoría") m.categoria = f.categoria;
      }
      const k = categorias.get(f.categoria) ?? {
        categoria: f.categoria, unidades: 0, importe: 0, comision: 0, envio: 0,
        isr: 0, iva: 0, otros: 0, ajusteLiquidacion: 0, neto: 0, costo: 0, ads: 0, cargoGeneral: 0,
        ganancia: 0, porCanal: {}, conCosto: false, sinCosto: false,
      };
      k.unidades += f.unidades;
      k.importe = p(c(k.importe) + c(f.importe));
      k.comision = p(c(k.comision) + c(f.comision));
      k.envio = p(c(k.envio) + c(f.envio));
      k.isr = p(c(k.isr) + c(f.isr));
      k.iva = p(c(k.iva) + c(f.iva));
      k.otros = p(c(k.otros) + c(f.otros));
      k.ajusteLiquidacion = p(c(k.ajusteLiquidacion) + c(f.ajusteLiquidacion));
      k.neto = p(c(k.neto) + c(f.neto));
      k.ads = p(c(k.ads) + c(f.ads));
      k.cargoGeneral = p(c(k.cargoGeneral) + c(f.cargoGeneral));
      if (f.costo != null) {
        k.costo = p(c(k.costo) + c(f.costo));
        k.ganancia = p(c(k.ganancia) + c(f.ganancia));
        k.conCosto = true;
      } else {
        k.sinCosto = true;
      }
      const pc = k.porCanal[b.canal] ?? { unidades: 0, ganancia: 0 };
      pc.unidades += f.unidades;
      pc.ganancia = pc.ganancia == null || f.ganancia == null ? null : p(c(pc.ganancia) + c(f.ganancia));
      k.porCanal[b.canal] = pc;
      categorias.set(f.categoria, k);
    }
  }

  const porCategoria: FilaCategoriaConsolidado[] = [...categorias.values()]
    .map(({ conCosto, sinCosto, ...k }) => ({ ...k, costo: conCosto ? k.costo : null, ganancia: conCosto ? k.ganancia : null, ...(sinCosto && conCosto ? {} : {}) }))
    .sort((a, b) => b.neto - a.neto);
  for (const k of categorias.values()) {
    if (k.sinCosto && k.conCosto) avisos.push(`Categoría ${k.categoria}: hay modelos sin costo; su ganancia solo cuenta los modelos con costo.`);
  }

  const exacto = entrada.bloques.length > 0 && entrada.bloques.every((b) => b.exacto) && canalesSinCalcular.length === 0;
  return aplicarGastosEmpresariales({
    versionContable: 8,
    periodo: entrada.periodo,
    desde: entrada.desde,
    hasta: entrada.hasta,
    generadoEn: entrada.generadoEn ?? new Date().toISOString(),
    canales,
    gastosEmpresariales: [],
    total: {
      unidades: total.unidades,
      ordenes: total.ordenes,
      ventaBruta: p(total.ventaBruta),
      ventaCubierta: p(total.ventaCubierta),
      ventaSinCalcular: p(total.ventaSinCalcular),
      unidadesSinCalcular: total.unidadesSinCalcular,
      canalesSinCalcular,
      neto: p(total.neto),
      coberturaNeto: total.ventaBruta > 0 ? total.ventaConCoberturaNeto / total.ventaBruta : null,
      descuentosPlataforma: p(total.descuentosPlataforma),
      desgloseDisponible: entrada.bloques.every((b) => b.desgloseDisponible !== false),
      comision: p(total.comision),
      envio: p(total.envio),
      isr: p(total.isr),
      iva: p(total.iva),
      otros: p(total.otros),
      ajusteLiquidacion: p(total.ajusteLiquidacion),
      devoluciones: p(total.devoluciones),
      devolucionesIncluidasEnNeto: p(total.devolucionesIncluidasEnNeto),
      costoRecuperado: p(total.costoRecuperado),
      costoProducto: p(total.costoProducto),
      coberturaCosto: total.unidades > 0 ? total.unidadesConCosto / total.unidades : 0,
      publicidad: p(total.publicidad),
      gastosGenerales: p(total.gastosGenerales),
      utilidadAntesGastosEmpresariales: p(total.utilidadNeta),
      gastosEmpresariales: 0,
      utilidadNeta: p(total.utilidadNeta),
      margenSobreVenta: total.ventaCubierta > 0 ? total.utilidadNeta / total.ventaCubierta : null,
      margenSobreNeto: total.neto > 0 ? total.utilidadNeta / total.neto : null,
      gananciaPorUnidad: total.unidades > 0 ? p(total.utilidadNeta / total.unidades) : null,
    },
    porCategoria,
    porModelo: [...modelos.values()].sort((a, b) => b.neto - a.neto),
    avisos,
    exacto,
  }, entrada.gastosEmpresariales ?? []);
}
