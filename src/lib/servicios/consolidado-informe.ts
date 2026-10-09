/**
 * El corte general LEÍDO, no solo sumado (pedido del dueño, 9-oct-2026:
 * «el corte general es un desastre… hay que ordenar la info de una manera
 * más legible y coherente» y «que genere el PDF precioso con gráficas y
 * explicaciones»).
 *
 * Motor puro: recibe el consolidado ya masticado y arma lo que la pantalla
 * y el PDF cuentan con palabras —la cascada de la venta a la utilidad que
 * CIERRA al centavo, a dónde se fue cada peso por canal, los avisos
 * separados entre lo que pide acción, lo que se resuelve solo y lo que solo
 * explica, y las frases de «lo que pasó en el mes»—. No cambia ningún
 * número: todo sale de lo guardado.
 */
import { NOMBRE_CANAL, type Canal, type CanalConsolidado, type Consolidado, type FilaModeloConsolidado } from "./consolidado";
import type { ComparacionMensual } from "./consolidado-comparar";

const c = (x: number | null | undefined): number => Math.round((Number(x) || 0) * 100);
const p = (cent: number): number => Math.round(cent) / 100;

/** Nombre corto del canal para gráficas y frases. */
export const CANAL_CORTO: Record<Canal, string> = {
  meli_calzado: "Calzado MELI",
  meli_fundas: "Fundas MELI",
  amazon: "Amazon",
  tiktok: "TikTok",
};

// ---------------------------------------------------------------------------
// Cascada de la venta a la utilidad
// ---------------------------------------------------------------------------

export interface PasoCascada {
  concepto: string;
  /** con signo: lo que suma es positivo, lo que resta negativo; los subtotales, su valor */
  monto: number;
  tipo: "inicio" | "resta" | "subtotal" | "final";
  nota: string;
}

/**
 * La venta bruta menos los cargos de plataforma no siempre da el neto
 * exacto: hay reembolsos que la plataforma ya descontó del depósito y
 * ajustes de liquidación. Esa diferencia va en su propio renglón para que la
 * cascada cierre al centavo y no se esconda.
 */
export function cascadaDelMes(cns: Pick<Consolidado, "canales" | "total">): PasoCascada[] {
  const k = cns.canales.filter((x) => x.calculable !== false);
  const sum = (f: (x: CanalConsolidado) => number) => k.reduce((a, x) => a + c(f(x)), 0);
  const venta = sum((x) => x.ventaBruta);
  const comision = sum((x) => x.desglosePlataforma.comision);
  const envio = sum((x) => x.desglosePlataforma.envio);
  const retenciones = sum((x) => x.desglosePlataforma.isr + x.desglosePlataforma.iva);
  const otros = sum((x) => x.desglosePlataforma.otros + x.desglosePlataforma.ajusteLiquidacion);
  const neto = sum((x) => x.neto);
  const conciliacion = neto - (venta - comision - envio - retenciones - otros);
  const costo = sum((x) => x.costoProducto);
  const publicidad = sum((x) => x.adsPorModelo);
  const generales = sum((x) => x.gastosGenerales);
  const antes = c(cns.total.utilidadAntesGastosEmpresariales);
  const empresariales = c(cns.total.gastosEmpresariales);
  const pasos: PasoCascada[] = [
    { concepto: "Venta bruta", monto: p(venta), tipo: "inicio", nota: "lo que pagaron los clientes en los pedidos del mes" },
    { concepto: "Comisiones", monto: p(-comision), tipo: "resta", nota: "cargo por venta de cada plataforma" },
    { concepto: "Envíos y logística", monto: p(-envio), tipo: "resta", nota: "envío de Full, FBA y TikTok" },
    { concepto: "Retenciones ISR e IVA", monto: p(-retenciones), tipo: "resta", nota: "impuesto adelantado: se acredita en la declaración" },
    { concepto: "Otros cargos de plataforma", monto: p(-otros), tipo: "resta", nota: "cargos sueltos y ajustes de liquidación" },
  ];
  if (Math.abs(conciliacion) >= 100) {
    pasos.push({
      concepto: conciliacion < 0 ? "Reembolsos ya descontados del depósito" : "Ajustes a favor en el depósito",
      monto: p(conciliacion),
      tipo: "resta",
      nota: conciliacion < 0 ? "devoluciones que la plataforma ya restó al pagar" : "diferencia entre los cargos leídos y lo depositado",
    });
  } else if (conciliacion !== 0) {
    pasos[pasos.length - 1].monto = p(c(pasos[pasos.length - 1].monto) + conciliacion);
  }
  pasos.push(
    { concepto: "Neto que pagaron las plataformas", monto: p(neto), tipo: "subtotal", nota: "depósitos reales (y lo por liquidar de TikTok)" },
    { concepto: "Costo del producto", monto: p(-costo), tipo: "resta", nota: "pares y fundas vendidos × costo de Productos y costos" },
    { concepto: "Publicidad", monto: p(-publicidad), tipo: "resta", nota: "Product Ads y Amazon Ads amarrados a cada modelo" },
    { concepto: "Gastos de plataforma", monto: p(-generales), tipo: "resta", nota: "Full, FBA, devoluciones netas, publicidad sin amarre y otros" },
  );
  // Lo que no cuadre por redondeo de los canales se absorbe en el último gasto.
  const calculado = neto - costo - publicidad - generales;
  if (calculado !== antes) pasos[pasos.length - 1].monto = p(c(pasos[pasos.length - 1].monto) + (antes - calculado));
  if (empresariales) {
    pasos.push(
      { concepto: "Utilidad de los canales", monto: p(antes), tipo: "subtotal", nota: "antes de los gastos de la empresa" },
      { concepto: "Gastos empresariales", monto: p(-empresariales), tipo: "resta", nota: "nómina, renta y demás, capturados a mano" },
    );
  }
  pasos.push({ concepto: "Utilidad neta", monto: cns.total.utilidadNeta, tipo: "final", nota: "lo que de verdad quedó" });
  return pasos;
}

// ---------------------------------------------------------------------------
// A dónde se fue cada peso de venta, por canal
// ---------------------------------------------------------------------------

export interface RepartoPeso {
  canal: Canal | "total";
  nombre: string;
  venta: number;
  /** fracciones de la venta (suman 1; la utilidad puede ser negativa) */
  plataforma: number;
  costo: number;
  publicidad: number;
  gastos: number;
  utilidad: number;
}

export function repartoDelPeso(cns: Pick<Consolidado, "canales" | "total">): RepartoPeso[] {
  const filas: RepartoPeso[] = [];
  const una = (canal: Canal | "total", nombre: string, venta: number, neto: number, costo: number, ads: number, gastos: number, utilidad: number) => {
    if (venta <= 0) return;
    filas.push({
      canal,
      nombre,
      venta,
      plataforma: (venta - neto) / venta,
      costo: costo / venta,
      publicidad: ads / venta,
      gastos: gastos / venta,
      utilidad: utilidad / venta,
    });
  };
  const calculables = cns.canales.filter((k) => k.calculable !== false);
  for (const k of calculables) una(k.canal, CANAL_CORTO[k.canal], k.ventaBruta, k.neto, k.costoProducto, k.adsPorModelo, k.gastosGenerales, k.utilidadNeta);
  const venta = calculables.reduce((a, k) => a + k.ventaBruta, 0);
  una(
    "total",
    "Todo el negocio",
    venta,
    calculables.reduce((a, k) => a + k.neto, 0),
    calculables.reduce((a, k) => a + k.costoProducto, 0),
    calculables.reduce((a, k) => a + k.adsPorModelo, 0),
    calculables.reduce((a, k) => a + k.gastosGenerales, 0),
    cns.total.utilidadAntesGastosEmpresariales,
  );
  return filas;
}

// ---------------------------------------------------------------------------
// Avisos: acción, pendiente que se resuelve solo, o nota que solo explica
// ---------------------------------------------------------------------------

export type TipoAviso = "accion" | "pendiente" | "nota";

export interface AvisoClasificado {
  tipo: TipoAviso;
  /** canal o «General» */
  origen: string;
  texto: string;
}

/** Lo que solo explica una regla: siempre sale y no es un problema. */
const NOTAS: RegExp[] = [
  /retenciones de ISR e IVA son impuesto adelantado/i,
  /costo de los pares devueltos se suma de vuelta SOLO/i,
  /devoluciones se restan completas/i,
  /ventas en REVENTA/i,
  /anuló cargos/i,
  /incluye .* de IVA facturado/i,
  /cargos detallados superan/i,
  /no se pudieron atribuir a sus propios productos/i,
];
/** Lo que se resuelve solo con el paso de los días. */
const PENDIENTES: RegExp[] = [
  /aún no llegan al plazo/i,
  /POR LIQUIDAR/i,
  /aún no tienen leída la revisión/i,
  /se revisan solas/i,
];

export function clasificarAviso(texto: string): TipoAviso {
  if (NOTAS.some((r) => r.test(texto))) return "nota";
  if (PENDIENTES.some((r) => r.test(texto))) return "pendiente";
  return "accion";
}

const PREFIJOS: [string, string][] = [
  ...(Object.entries(NOMBRE_CANAL) as [Canal, string][]).map(([k, nombre]) => [`${nombre}: `, CANAL_CORTO[k]] as [string, string]),
];

export function clasificarAvisos(avisos: string[]): AvisoClasificado[] {
  const vistos = new Set<string>();
  const salida: AvisoClasificado[] = [];
  for (const crudo of avisos) {
    let origen = "General";
    let texto = crudo;
    for (const [prefijo, corto] of PREFIJOS) {
      if (texto.startsWith(prefijo)) {
        origen = corto;
        texto = texto.slice(prefijo.length);
        break;
      }
    }
    // Amazon y TikTok repiten su nombre dentro del aviso («Amazon: Amazon: …»).
    texto = texto.replace(/^(Amazon|TikTok):\s*/i, "");
    if (/^Categoría .*: hay modelos sin costo/.test(texto)) origen = "Categorías";
    const llave = `${origen}|${texto}`;
    if (vistos.has(llave)) continue;
    vistos.add(llave);
    salida.push({ tipo: clasificarAviso(texto), origen, texto: texto.charAt(0).toUpperCase() + texto.slice(1) });
  }
  // El mismo texto en varios canales (las retenciones, el costo de los
  // devueltos) va una sola vez con todos sus canales.
  const porTexto = new Map<string, AvisoClasificado>();
  for (const a of salida) {
    const previo = porTexto.get(a.texto);
    if (previo) previo.origen = `${previo.origen} y ${a.origen}`.replace(/ y (?=.* y )/g, ", ");
    else porTexto.set(a.texto, { ...a });
  }
  salida.length = 0;
  salida.push(...porTexto.values());
  // Las categorías con modelos sin costo se juntan en un solo aviso.
  const cats = salida.filter((a) => a.origen === "Categorías");
  if (cats.length > 1) {
    const nombres = cats.map((a) => a.texto.replace(/^Categoría (.*): hay modelos sin costo.*$/, "$1"));
    const resto = salida.filter((a) => a.origen !== "Categorías");
    resto.push({ tipo: "accion", origen: "Categorías", texto: `Hay modelos sin costo en ${nombres.join(", ")}: su ganancia solo cuenta los modelos con costo.` });
    return resto;
  }
  return salida;
}

export interface EstadoDelCorte {
  /** definitivo | preliminar (solo falta tiempo) | incompleto (algo pide acción) */
  estado: "definitivo" | "preliminar" | "incompleto";
  etiqueta: string;
  explicacion: string;
  acciones: number;
  pendientes: number;
  notas: number;
}

export function estadoDelCorte(cns: Pick<Consolidado, "avisos" | "exacto" | "total" | "canales">): EstadoDelCorte {
  const avisos = avisosParaMostrar(cns);
  const acciones = avisos.acciones.length + avisos.sinCosto.length;
  const pendientes = avisos.pendientes.length;
  const notas = avisos.notas.length;
  if (cns.exacto && acciones === 0) {
    return { estado: "definitivo", etiqueta: "Definitivo", explicacion: "Todas las fuentes están completas y cuadradas.", acciones, pendientes, notas };
  }
  if (acciones === 0) {
    return {
      estado: "preliminar",
      etiqueta: "Preliminar",
      explicacion: "Los números están completos; faltan revisiones que llegan solas con los días (devoluciones a 40 días, liquidaciones de TikTok).",
      acciones,
      pendientes,
      notas,
    };
  }
  return {
    estado: "incompleto",
    etiqueta: `${acciones} ${acciones === 1 ? "cosa" : "cosas"} por revisar`,
    explicacion: "Hay datos que faltan o no cuadran y pueden mover la utilidad: están en «Qué falta».",
    acciones,
    pendientes,
    notas,
  };
}

// ---------------------------------------------------------------------------
// Modelos destacados
// ---------------------------------------------------------------------------

export function modelosDestacados(cns: Pick<Consolidado, "porModelo">, cuantos = 15): {
  mejores: FilaModeloConsolidado[];
  peores: FilaModeloConsolidado[];
  sinCosto: FilaModeloConsolidado[];
} {
  const conGanancia = cns.porModelo.filter((m) => m.ganancia != null);
  const mejores = [...conGanancia].sort((a, b) => (b.ganancia ?? 0) - (a.ganancia ?? 0)).slice(0, cuantos);
  const peores = conGanancia.filter((m) => (m.ganancia ?? 0) < 0).sort((a, b) => (a.ganancia ?? 0) - (b.ganancia ?? 0)).slice(0, cuantos);
  const sinCosto = cns.porModelo.filter((m) => m.costo == null).sort((a, b) => b.unidades - a.unidades);
  return { mejores, peores, sinCosto };
}

// ---------------------------------------------------------------------------
// Lo que pasó en el mes, con palabras
// ---------------------------------------------------------------------------

function pesosCortos(x: number): string {
  const a = Math.abs(x);
  const s = x < 0 ? "-$" : "$";
  if (a >= 1_000_000) return `${s}${(a / 1_000_000).toLocaleString("es-MX", { maximumFractionDigits: 2 })} millones`;
  if (a >= 10_000) return `${s}${Math.round(a / 1000).toLocaleString("es-MX")} mil`;
  return `${s}${Math.round(a).toLocaleString("es-MX")}`;
}
function pct(x: number): string {
  return `${(x * 100).toLocaleString("es-MX", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`;
}
function cambio(x: number | null): string {
  if (x == null) return "";
  return `${x >= 0 ? "subió" : "bajó"} ${pct(Math.abs(x))}`;
}

export function loQuePaso(cns: Consolidado, comp?: ComparacionMensual | null): string[] {
  const frases: string[] = [];
  const t = cns.total;
  const calc = cns.canales.filter((k) => k.calculable !== false);
  if (t.ventaBruta <= 0) return ["No hay ventas registradas en este periodo."];
  frases.push(
    `Se vendieron ${t.unidades.toLocaleString("es-MX")} unidades por ${pesosCortos(t.ventaBruta)} y quedó una utilidad neta de ${pesosCortos(t.utilidadNeta)}: ${t.margenSobreVenta != null ? pct(t.margenSobreVenta) : "—"} de la venta${t.gananciaPorUnidad != null ? `, ${pesosCortos(t.gananciaPorUnidad)} por unidad` : ""}.`,
  );
  const peso = repartoDelPeso(cns).find((r) => r.canal === "total");
  if (peso) {
    const de100 = (x: number) => `$${Math.round(x * 100)}`;
    frases.push(
      `De cada $100 de venta, las plataformas se quedaron con ${de100(peso.plataforma)} (comisión, envío, retenciones), el producto costó ${de100(peso.costo)}, la publicidad ${de100(peso.publicidad)}, los gastos de plataforma ${de100(peso.gastos)} y quedaron ${de100(peso.utilidad)} de ganancia.`,
    );
  }
  const porUtil = [...calc].sort((a, b) => b.utilidadNeta - a.utilidadNeta);
  if (porUtil.length > 1 && t.utilidadAntesGastosEmpresariales > 0) {
    const [a, b] = porUtil;
    frases.push(
      `${CANAL_CORTO[a.canal]} fue el canal que más dejó (${pesosCortos(a.utilidadNeta)}, ${pct(a.utilidadNeta / t.utilidadAntesGastosEmpresariales)} de la ganancia), seguido de ${CANAL_CORTO[b.canal]} (${pesosCortos(b.utilidadNeta)}).`,
    );
  }
  const porMargen = calc.filter((k) => k.margen != null).sort((a, b) => (b.margen ?? 0) - (a.margen ?? 0));
  if (porMargen.length > 1) {
    const mejor = porMargen[0];
    const peor = porMargen[porMargen.length - 1];
    frases.push(
      `El margen más alto fue el de ${CANAL_CORTO[mejor.canal]} (${pct(mejor.margen!)}) y el más bajo el de ${CANAL_CORTO[peor.canal]} (${pct(peor.margen!)})${peor.canal === "amazon" ? ": FBA y publicidad pesan más ahí" : ""}.`,
    );
  }
  if (comp && !comp.enCurso) {
    const total = comp.renglones.find((r) => r.canal === "total");
    if (total) {
      frases.push(
        `Contra el mes anterior, las unidades ${cambio(total.unidades.cambio)} y la utilidad neta ${cambio(comp.utilidadNeta.cambio)} (${pesosCortos(comp.utilidadNeta.diferencia)}).`,
      );
    }
  }
  const { mejores, peores } = modelosDestacados(cns, 3);
  if (mejores.length) {
    frases.push(`Los modelos que más dejaron: ${mejores.map((m) => `${m.modelo} (${pesosCortos(m.ganancia ?? 0)})`).join(", ")}.`);
  }
  if (peores.length) {
    const perdida = cns.porModelo.filter((m) => (m.ganancia ?? 0) < 0);
    frases.push(
      `${perdida.length} ${perdida.length === 1 ? "modelo perdió" : "modelos perdieron"} dinero en total ${pesosCortos(perdida.reduce((a, m) => a + (m.ganancia ?? 0), 0))}; el que más: ${peores[0].modelo} (${pesosCortos(peores[0].ganancia ?? 0)}).`,
    );
  }
  return frases;
}

/**
 * El neto de los modelos SIN costo capturado: entra a la utilidad del canal
 * sin restarle nada (la utilidad es neto − costo, y su costo no existe), así
 * que la infla. No se estima: se declara por canal para que se capture.
 */
export function netoSinCosto(cns: Pick<Consolidado, "canales">): { canal: Canal; nombre: string; unidades: number; neto: number; modelos: string[] }[] {
  const salida: { canal: Canal; nombre: string; unidades: number; neto: number; modelos: string[] }[] = [];
  for (const k of cns.canales) {
    if (k.calculable === false) continue;
    const sin = k.porModelo.filter((m) => m.costo == null);
    if (!sin.length) continue;
    salida.push({
      canal: k.canal,
      nombre: CANAL_CORTO[k.canal],
      unidades: sin.reduce((a, m) => a + m.unidades, 0),
      neto: p(sin.reduce((a, m) => a + c(m.neto), 0)),
      modelos: sin.sort((a, b) => b.unidades - a.unidades).map((m) => m.modelo),
    });
  }
  return salida;
}

/** Lo que pide acción por no tener costo: lo cubre `netoSinCosto` con su monto. */
const SIN_COSTO = /sin costo/i;

export interface AvisosParaMostrar {
  sinCosto: ReturnType<typeof netoSinCosto>;
  acciones: AvisoClasificado[];
  pendientes: AvisoClasificado[];
  notas: AvisoClasificado[];
}

/**
 * Los avisos como se enseñan (pantalla y PDF): el neto sin costo por canal
 * con su monto en lugar de los tres o cuatro avisos sueltos que dicen lo
 * mismo, y lo demás separado por tipo.
 */
export function avisosParaMostrar(cns: Pick<Consolidado, "avisos" | "canales">): AvisosParaMostrar {
  const sinCosto = netoSinCosto(cns);
  const todos = clasificarAvisos(cns.avisos);
  const acciones = todos.filter((a) => a.tipo === "accion" && !(sinCosto.length && SIN_COSTO.test(a.texto)));
  return {
    sinCosto,
    acciones,
    pendientes: todos.filter((a) => a.tipo === "pendiente"),
    notas: todos.filter((a) => a.tipo === "nota"),
  };
}
