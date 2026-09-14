/**
 * Lo que ENTRA al almacén de TikTok sale de Industher; lo que SALE, no.
 *
 * El 3PL dio de alta una bodega propia para TikTok en su sistema y ahí solo
 * registra lo que le llega: nunca descuenta un pedido. Los pedidos los
 * descuenta este ERP — un pago aparta, un envío confirmado resta. Por eso el
 * número de Industher NO es una foto del estante (después de vender 30 pares
 * sigue diciendo lo mismo), es un ACUMULADO DE ENTRADAS, y así se lee:
 *
 *   base registrada = Σ entradas de Industher − Σ retiros de Industher
 *                     − Σ salidas que el 3PL confirmó + Σ devoluciones
 *   sube el acumulado  →  ENTRADA por la diferencia
 *   baja el acumulado  →  RETIRO por la diferencia (el 3PL sacó o corrigió,
 *                         o una devolución no volvió al estante)
 *
 * Tomarlo como foto absoluta —"pisar" el saldo— habría vuelto a publicar
 * los pares ya vendidos en cada sincronización. Aquí nada pisa: se suma la
 * diferencia y las salidas del kardex quedan intactas.
 */
import { esAlmacenTikTok, type CajaConstruida } from "../importar/cajas";
import { claveComparacion } from "../importar/sku";
import type { Movimiento } from "./kardex";

/** Cómo se reconoce la bodega de TikTok en Industher (vive junto al armado de cajas, que la excluye). */
export { esAlmacenTikTok };

/** Prefijo de la referencia con la que Industher firma sus movimientos. */
export const REFERENCIA_INDUSTHER = "industher:";

/**
 * Pares acumulados por SKU en la bodega de TikTok, a partir de sus cajas.
 * Se cuentan las cajas físicas (disponibles + apartadas): en esta bodega
 * "apartada" no significa "para un envío a Full", y lo que TikTok tiene
 * apartado el ERP ya lo resta por su lado con los pedidos pagados.
 */
export function paresPorSkuDesdeCajas(cajas: CajaConstruida[], alias?: Map<string, string>): Map<string, number> {
  const pares = new Map<string, number>();
  for (const caja of cajas) {
    const fisicas = (caja.cajasDisponibles ?? 0) + (caja.cajasApartadas ?? 0);
    if (fisicas <= 0) continue;
    for (const it of caja.detalle ?? []) {
      if (!it.sku || it.piezas <= 0) continue;
      // Lo que MELI no tiene sale construido sin sufijo ("MY2304-PURPLE-23");
      // si TikTok lo vende con otro nombre ("MY2304-PURPLE-23-MX"), es el
      // mismo par y se lleva a ESE nombre: un solo renglón en el kardex.
      const sinMeli = it.origen === "sin_amarre" || it.origen === "sin_catalogo";
      const sku = (sinMeli && alias?.get(claveComparacion(it.sku))) || it.sku;
      pares.set(sku, (pares.get(sku) ?? 0) + it.piezas * fisicas);
    }
  }
  return pares;
}

/** clave canónica → SKU tal cual lo escribe TikTok, para los modelos que MELI no tiene. */
export function aliasDesdeTikTok(sellerSkus: (string | null | undefined)[]): Map<string, string> {
  const alias = new Map<string, string>();
  for (const s of sellerSkus) {
    const sku = String(s ?? "").trim().toUpperCase();
    if (!sku) continue;
    const clave = claveComparacion(sku);
    if (!alias.has(clave)) alias.set(clave, sku);
  }
  return alias;
}

export interface MovimientoDesdeIndusther {
  sku: string;
  tipo: "entrada" | "merma";
  cantidad: number;
  referencia: string;
  motivo: string;
  fecha: string;
}

/**
 * Cuánto de lo que Industher reporta todavía no está en el kardex.
 *
 * La base es lo que Industher YA metió antes (sus propias entradas menos sus
 * propios retiros, reconocidos por la referencia). Las salidas de pedidos y
 * las correcciones a mano no entran en la base: no son de Industher y no
 * deben cambiar cuánto se le reconoce.
 */
export function movimientosDesdeAcumulado(
  paresEnBodega: Map<string, number>,
  movimientos: Movimiento[],
  fechaFoto: string,
): MovimientoDesdeIndusther[] {
  const base = new Map<string, number>();
  for (const m of movimientos) {
    if (!m.referencia?.startsWith(REFERENCIA_INDUSTHER)) continue;
    const signo = m.tipo === "entrada" ? 1 : m.tipo === "merma" ? -1 : 0;
    if (!signo) continue;
    base.set(m.sku, (base.get(m.sku) ?? 0) + signo * m.cantidad);
  }

  const referencia = `${REFERENCIA_INDUSTHER}${fechaFoto}`;
  const skus = new Set<string>([...paresEnBodega.keys(), ...base.keys()]);
  const salida: MovimientoDesdeIndusther[] = [];

  for (const sku of skus) {
    const delta = (paresEnBodega.get(sku) ?? 0) - (base.get(sku) ?? 0);
    if (delta === 0) continue;
    salida.push(
      delta > 0
        ? {
            sku,
            tipo: "entrada",
            cantidad: delta,
            referencia,
            motivo: "Entrada a la bodega TikTok (Industher)",
            fecha: fechaFoto,
          }
        : {
            sku,
            tipo: "merma",
            cantidad: -delta,
            referencia,
            motivo: "Industher reportó menos en la bodega TikTok",
            fecha: fechaFoto,
          },
    );
  }

  return salida.sort((a, b) => a.sku.localeCompare(b.sku, "es"));
}

// ---------------------------------------------------------------------------
// Cuando el 3PL SÍ descuenta lo que le mandamos
// ---------------------------------------------------------------------------

export interface Salidas3pl {
  /** pares por SKU que el 3PL ya confirmó descontados (ack del endpoint) */
  confirmadas: Map<string, number>;
  /** pares por SKU que salieron del kardex y el 3PL todavía no confirma */
  pendientes: Map<string, number>;
}

export interface Conciliacion {
  movimientos: MovimientoDesdeIndusther[];
  /** bajas del acumulado atribuidas a salidas pendientes: hay que marcarlas confirmadas */
  atribuidas: Map<string, number>;
}

/**
 * La misma lectura por diferencia, pero sabiendo que el 3PL descuenta las
 * salidas que le mandamos. Lo que Industher YA descontó por nuestra cuenta
 * se resta de la base reconocida (el número bajó por eso, no porque se
 * perdiera nada); y una baja que todavía no está confirmada se atribuye
 * PRIMERO a las salidas pendientes de ese SKU, y solo el resto es merma.
 * Así una salida nunca se descuenta dos veces: una en el kardex por el
 * pedido y otra por la baja del 3PL.
 *
 * Límite honesto: si en la misma foto entran 10 y el 3PL descuenta 3 sin
 * haberlo confirmado, se ve +7 y las 3 quedan pendientes; el kardex queda
 * 3 abajo del físico (del lado seguro). El ack del endpoint lo evita.
 */
export function conciliarAcumulado(
  paresEnBodega: Map<string, number>,
  movimientos: Movimiento[],
  fechaFoto: string,
  salidas: Salidas3pl,
): Conciliacion {
  const base = new Map<string, number>();
  for (const m of movimientos) {
    if (!m.referencia?.startsWith(REFERENCIA_INDUSTHER)) continue;
    const signo = m.tipo === "entrada" ? 1 : m.tipo === "merma" ? -1 : 0;
    if (!signo) continue;
    base.set(m.sku, (base.get(m.sku) ?? 0) + signo * m.cantidad);
  }
  for (const [sku, n] of salidas.confirmadas) base.set(sku, (base.get(sku) ?? 0) - n);

  // Una DEVOLUCIÓN sube el saldo del kardex, pero el par NO vuelve solo al
  // estante: el paquete ya había salido y el 3PL ya lo descontó. Si no entra
  // en la base, la comparación contra Industher deja de ser pareja y la
  // diferencia se queda para siempre — el kardex ofrece a TikTok pares que
  // la bodega no tiene (14-sep-2026: 18 pares en 10 SKUs, y en TODOS la
  // diferencia era exactamente su número de devoluciones; el GT102-GREY-25
  // ofrecía 3 con la bodega en cero).
  //
  // Contándola aquí, la devolución solo sobrevive si la bodega la CONFIRMA:
  // si el par vuelve de verdad, Industher lo cuenta y la base cuadra; si no
  // vuelve, la diferencia sale como retiro en la siguiente corrida. Nada se
  // supone, lo dice el estante.
  const devueltos = new Map<string, number>();
  for (const m of movimientos) {
    if (m.tipo !== "devolucion") continue;
    devueltos.set(m.sku, (devueltos.get(m.sku) ?? 0) + m.cantidad);
  }
  for (const [sku, n] of devueltos) base.set(sku, (base.get(sku) ?? 0) + n);

  const referencia = `${REFERENCIA_INDUSTHER}${fechaFoto}`;
  const skus = new Set<string>([...paresEnBodega.keys(), ...base.keys()]);
  const salida: MovimientoDesdeIndusther[] = [];
  const atribuidas = new Map<string, number>();

  for (const sku of skus) {
    const delta = (paresEnBodega.get(sku) ?? 0) - (base.get(sku) ?? 0);
    if (delta === 0) continue;
    if (delta > 0) {
      salida.push({ sku, tipo: "entrada", cantidad: delta, referencia, motivo: "Entrada a la bodega TikTok (Industher)", fecha: fechaFoto });
      continue;
    }
    const baja = -delta;
    const pendientes = salidas.pendientes.get(sku) ?? 0;
    const aSalidas = Math.min(baja, pendientes);
    if (aSalidas > 0) atribuidas.set(sku, aSalidas);
    const resto = baja - aSalidas;
    if (resto > 0) {
      const porDevolucion = (devueltos.get(sku) ?? 0) >= resto;
      salida.push({
        sku,
        tipo: "merma",
        cantidad: resto,
        referencia,
        motivo: porDevolucion
          ? "Devolución que no volvió al estante de Industher"
          : "Industher reportó menos en la bodega TikTok",
        fecha: fechaFoto,
      });
    }
  }

  return { movimientos: salida.sort((a, b) => a.sku.localeCompare(b.sku, "es")), atribuidas };
}
