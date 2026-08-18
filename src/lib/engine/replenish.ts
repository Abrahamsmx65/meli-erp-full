/**
 * Motor de reposición.
 *
 * La lógica en una frase: quiero tener en Full `horizonteDias` de venta
 * proyectada más un colchón que aguante la ventana de riesgo (lo que tarda
 * en llegar un envío más lo que falta para el siguiente). Lo que ya está
 * allá — disponible y en transferencia — cuenta. La diferencia es lo que hay
 * que mandar.
 */
import { periodoRevision, ventanaRiesgo, zScore } from "./params";
import { sumarDias } from "./fechas";
import type {
  DemandaSku,
  EstadoSku,
  ISODate,
  LineaPlan,
  Parametros,
  SkuOverride,
  StockFull,
} from "./types";

const EPS = 1e-9;

interface EntradaLinea {
  sku: string;
  titulo?: string | null;
  demanda: DemandaSku;
  stock: StockFull | undefined;
  inventarioPropio: number;
  override?: SkuOverride;
  hoy: ISODate;
}

export function calcularLinea(e: EntradaLinea, p: Parametros): LineaPlan {
  const D = e.demanda.demandaDiaria;
  const sigma = e.demanda.sigmaDiaria;

  const disponible = e.stock?.disponible ?? 0;
  const enTransferencia = e.stock?.enTransferencia ?? 0;
  // Posición de inventario: lo que ya puedo considerar mío en Full.
  // El stock "no disponible" (dañado/perdido/en revisión) NO cuenta.
  const posicion = disponible + enTransferencia;

  const R = periodoRevision(p);
  const L = p.leadTimeDias;
  const riesgo = ventanaRiesgo(p);
  const Z = zScore(p.nivelServicio);

  // Stock de seguridad: protege la variabilidad durante la ventana de riesgo,
  // con un piso en días para que los SKUs muy parejos no queden sin colchón.
  const ssEstadistico = Z * sigma * Math.sqrt(Math.max(0, riesgo));
  const ssPiso = p.ssMinimoDias * D;
  const stockSeguridad = Math.ceil(Math.max(ssEstadistico, ssPiso));

  const puntoReorden = Math.ceil(D * riesgo + stockSeguridad);
  const nivelObjetivo = Math.ceil(D * p.horizonteDias + stockSeguridad);

  const coberturaDias = D > EPS ? posicion / D : Number.POSITIVE_INFINITY;
  const fechaQuiebre =
    D > EPS && Number.isFinite(coberturaDias)
      ? sumarDias(e.hoy, Math.floor(coberturaDias))
      : null;

  let sugerido = Math.max(0, Math.ceil(nivelObjetivo - posicion));

  // Mínimo de envío por SKU: no vale la pena mover 3 piezas.
  const minimo = e.override?.minimoEnvio ?? null;
  if (minimo != null && sugerido > 0 && sugerido < minimo) {
    sugerido = coberturaDias < riesgo ? minimo : 0;
  }

  const faltanteBodega = Math.max(0, sugerido - e.inventarioPropio);

  // --- Estado -------------------------------------------------------------
  let estado: EstadoSku;
  if (D <= 0.005) {
    estado = "sin_demanda";
  } else if (posicion < D * L) {
    // Se acaba antes de que llegue lo que mande hoy: ya hay pérdida asegurada.
    estado = "critico";
  } else if (posicion < puntoReorden) {
    estado = "urgente";
  } else if (coberturaDias > p.horizonteDias * p.sobrestockFactor) {
    estado = "sobrestock";
  } else {
    estado = "ok";
  }

  if (e.override?.excluir) estado = "sin_demanda";

  return {
    sku: e.sku,
    titulo: e.titulo ?? null,
    demanda: e.demanda,
    disponible,
    enTransferencia,
    posicion,
    stockSeguridad,
    puntoReorden,
    nivelObjetivo,
    coberturaDias,
    fechaQuiebre,
    sugerido: e.override?.excluir ? 0 : sugerido,
    inventarioPropio: e.inventarioPropio,
    faltanteBodega: e.override?.excluir ? 0 : faltanteBodega,
    estado,
    explicacion: explicar({
      estado,
      D,
      posicion,
      coberturaDias,
      nivelObjetivo,
      sugerido,
      faltanteBodega,
      p,
      demanda: e.demanda,
    }),
  };
}

function explicar(a: {
  estado: EstadoSku;
  D: number;
  posicion: number;
  coberturaDias: number;
  nivelObjetivo: number;
  sugerido: number;
  faltanteBodega: number;
  p: Parametros;
  demanda: DemandaSku;
}): string {
  const { estado, D, posicion, coberturaDias, sugerido, faltanteBodega, p, demanda } = a;

  if (estado === "sin_demanda") {
    return "Sin venta medible en la ventana. No se sugiere envío.";
  }

  const cob = Number.isFinite(coberturaDias) ? `${coberturaDias.toFixed(1)} días` : "indefinida";
  const partes: string[] = [];

  partes.push(
    `Vende ~${D.toFixed(2)} pzas/día. Con ${posicion} en Full te alcanza para ${cob}.`,
  );

  if (demanda.factorCorreccion > 1.15) {
    partes.push(
      `Ojo: estuvo agotado parte del periodo, así que la demanda real es ${demanda.factorCorreccion.toFixed(2)}× lo que muestran las ventas crudas.`,
    );
  }

  switch (estado) {
    case "critico":
      partes.push(
        `Se agota antes de que llegue el envío de hoy (lead time ${p.leadTimeDias} días). Ya estás perdiendo venta.`,
      );
      break;
    case "urgente":
      partes.push(`Cae bajo el punto de reorden antes del siguiente envío. Mándalo ahora.`);
      break;
    case "sobrestock":
      partes.push(
        `Traes más de ${(p.horizonteDias * p.sobrestockFactor).toFixed(0)} días de cobertura. No mandes más y revisa precio o publicidad.`,
      );
      break;
    default:
      partes.push(`Cobertura sana para el horizonte de ${p.horizonteDias} días.`);
  }

  if (sugerido > 0) {
    partes.push(`Sugerido: ${sugerido} pzas para llegar a ${p.horizonteDias} días de cobertura.`);
  }
  if (faltanteBodega > 0) {
    partes.push(`⚠️ Te faltan ${faltanteBodega} pzas en bodega para cubrirlo.`);
  }

  return partes.join(" ");
}

/** Prioridad para el optimizador de cajas: qué tanto duele quedarse corto. */
export function prioridadFaltante(linea: LineaPlan, p: Parametros): number {
  switch (linea.estado) {
    case "critico":
      return p.pesoFaltanteCritico;
    case "urgente":
      return Math.max(1, p.pesoFaltanteCritico * 0.6);
    case "sobrestock":
      return 0.2;
    case "sin_demanda":
      return 0.05;
    default:
      return 1;
  }
}

/**
 * Qué tanto duele mandar de MÁS.
 *
 * Sin esto el optimizador arrastra montañas de producto que ya sobra con tal
 * de rescatar un SKU crítico que viaja en la misma caja. Mandar 900 piezas
 * extra de algo que ya tiene 60 días de cobertura es pagar bodega en MELI
 * por inventario que no se va a mover.
 */
/**
 * Una talla que nunca ha tenido stock no es lo mismo que una que no vende.
 *
 * Sin ventas y sin un solo día con existencia, el cero no dice "no lo
 * quieren": dice que nunca ha habido qué vender. Es la talla agotada de
 * siempre, justo la que hay que reponer.
 */
function nuncaTuvoOportunidad(l: LineaPlan): boolean {
  return (
    l.disponible === 0 &&
    l.enTransferencia === 0 &&
    l.demanda.unidadesTotales === 0 &&
    l.demanda.diasEfectivos < 1
  );
}

export function prioridadSobrante(
  linea: LineaPlan,
  p: Parametros,
  opts?: { excluido?: boolean },
): number {
  // Si tú la excluiste a mano, se respeta: no mandarla es la instrucción.
  if (linea.estado === "sin_demanda" && !opts?.excluido && nuncaTuvoOportunidad(linea)) {
    // Poco castigo: que llegue de más a una talla vacía no es capital
    // dormido, es volver a tener qué vender. Pero tampoco es gratis, así
    // que no se premia.
    return 0.8;
  }

  switch (linea.estado) {
    case "sin_demanda":
      return 4;          // no vende: cada pieza extra es puro costo
    case "sobrestock":
      return 2.5;
    case "ok":
      return 1;
    default:
      return 0.4;        // crítico o urgente: que sobre tantito está bien
  }
}
