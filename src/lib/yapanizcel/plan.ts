/**
 * Planeador de envíos a Mercado Envíos Full para YAPANIZCEL.
 *
 * Mucho más simple que el del calzado porque aquí no hay cajas cerradas ni
 * corridas: la funda es unidad suelta y se puede mandar la cantidad que sea…
 * salvo por una regla de la operación: **se manda en decenas cerradas**.
 *
 * La cuenta, por SKU:
 *
 *     venta diaria = mezcla de tres bloques: última semana (50%), la
 *                    anterior (30%) y el resto de la ventana (20%), cada
 *                    uno = unidades ÷ días que DE VERDAD hubo stock
 *     objetivo     = venta diaria × días de cobertura (30)
 *     posición     = en Full + en transferencia + envíos ya registrados
 *     falta        = objetivo − posición
 *     mandar       = falta redondeada ARRIBA a decena, topada por bodega
 *
 * Por qué bloques y no un promedio plano: un modelo que pasó de 35 a 65 al
 * día a media ventana (601-iPad10 en agosto) promedia 53 y se repone corto.
 * Inclinar hacia lo reciente lo pone en 62. La tendencia (última semana
 * contra la anterior) se muestra aparte, para que se vea por qué.
 *
 * La ventana termina AYER: el día de hoy va a medias y contarlo entero
 * bajaba la venta diaria de todos los SKUs cada mañana.
 *
 * Lo de "días que de verdad hubo stock" importa: si algo estuvo agotado 20
 * de los últimos 30 días, sus 10 ventas no son 0.33 al día, son 1 al día, y
 * reponer por 0.33 lo deja agotado otra vez. La corrección solo se aplica
 * cuando hay fotos diarias suficientes para saberlo; si no las hay, se dice
 * y se usa el calendario. Un bloque sin un solo día con stock no dice nada
 * y se deja fuera de la mezcla (no cuenta como cero).
 *
 * Este archivo es motor puro: recibe datos y devuelve el plan. No sabe de
 * Supabase ni de HTTP, así que se puede probar a fondo sin levantar nada.
 */

/** Tope a la corrección por agotamiento: sin él, un SKU con stock 1 de 30 días daría una demanda absurda. */
export const TOPE_CORRECCION = 3;

/** Mínimo de fotos diarias para creerle a la corrección por agotamiento. */
export const COBERTURA_MINIMA_SNAPSHOTS = 0.5;

/** Pesos de los bloques: última semana, la anterior, el resto. */
export const PESOS_BLOQUES = [0.5, 0.3, 0.2] as const;
/** Tope a la tendencia que se reporta: −30% … +50%, como en el calzado. */
export const TENDENCIA_MIN = -0.3;
export const TENDENCIA_MAX = 0.5;

export interface VentaDia {
  sku: string;
  fecha: string; // YYYY-MM-DD
  unidades: number;
}

export interface SnapshotDia {
  sku: string;
  fecha: string;
  disponible: number;
}

export interface StockFull {
  sku: string;
  disponible: number;
  enTransferencia: number;
}

/** Unidades de un SKU de MELI que hay en bodega, ya amarradas. */
export interface EnBodega {
  skuMeli: string;
  unidades: number;
}

/** Unidades ya mandadas a Full que todavía no aparecen en MELI. */
export interface EnCamino {
  skuMeli: string;
  unidades: number;
}

export interface ParametrosPlan {
  diasVenta: number;
  diasObjetivo: number;
  multiploEnvio: number;
  minimoEnvio: number;
}

export type MotivoNoEnviar =
  | "ok"
  | "sin_faltante"
  | "sin_inventario"
  | "menos_de_una_decena"
  | "topado_por_bodega";

export interface LineaPlan {
  sku: string;
  /** Unidades vendidas en la ventana. */
  vendidas: number;
  /** Días de la ventana en que hubo stock. Igual a la ventana si no hay fotos. */
  diasConStock: number;
  /** true si la venta diaria se calculó con el calendario por falta de fotos. */
  porCalendario: boolean;
  ventaDiaria: number;
  /** Última semana contra la anterior (0.1 = +10%); null si falta un bloque. */
  tendencia: number | null;
  enFull: number;
  enTransferencia: number;
  enCamino: number;
  /** Todo lo que ya es tuyo y va a estar vendible en Full. */
  posicion: number;
  /** Días de venta que cubre la posición actual. Infinity si no vende. */
  cobertura: number;
  objetivo: number;
  falta: number;
  enBodega: number;
  /** Lo que hay que mandar, ya en decenas cerradas. */
  mandar: number;
  motivo: MotivoNoEnviar;
}

export interface Plan {
  lineas: LineaPlan[];
  /** Total de unidades a mandar. */
  unidades: number;
  /** SKUs con algo que mandar. */
  skus: number;
  /** Lo que se quedó sin mandar por no haber en bodega. */
  faltanteSinCubrir: number;
  desde: string;
  hasta: string;
}

function diaISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sumarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return diaISO(d);
}

/** Los días de la ventana, del más viejo al más nuevo. */
export function ventana(hasta: string, dias: number): { desde: string; hasta: string } {
  return { desde: sumarDias(hasta, -(dias - 1)), hasta };
}

/** Ayer, en el huso del negocio: el último día COMPLETO. */
export function ayerDe(hoy: string): string {
  return sumarDias(hoy, -1);
}

/**
 * Los tres bloques de la ventana: última semana, la anterior y el resto.
 * Con ventanas cortas (menos de 21 días) los bloques se acortan en orden.
 */
export function bloques(desde: string, hasta: string): { desde: string; hasta: string }[] {
  const out: { desde: string; hasta: string }[] = [];
  let fin = hasta;
  for (const largo of [7, 7]) {
    if (fin < desde) break;
    const ini = sumarDias(fin, -(largo - 1));
    out.push({ desde: ini < desde ? desde : ini, hasta: fin });
    fin = sumarDias(out[out.length - 1].desde, -1);
  }
  if (fin >= desde) out.push({ desde, hasta: fin });
  return out;
}

function agrupar<T>(filas: T[], llave: (f: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const f of filas) {
    const k = llave(f);
    const prev = m.get(k);
    if (prev) prev.push(f);
    else m.set(k, [f]);
  }
  return m;
}

function sumar(m: Map<string, number>, k: string, v: number): void {
  m.set(k, (m.get(k) ?? 0) + v);
}

/**
 * Redondea a la decena cerrada de arriba.
 *
 * Faltan 32 → se mandan 40. Es lo que pidió la operación: el almacén no
 * quiere contar unidades sueltas.
 */
export function subirADecena(n: number, multiplo: number): number {
  if (multiplo <= 1) return Math.max(0, Math.ceil(n));
  return Math.ceil(Math.max(0, n) / multiplo) * multiplo;
}

/** Baja a la decena cerrada: lo que sí alcanza a salir con lo que hay en bodega. */
export function bajarADecena(n: number, multiplo: number): number {
  if (multiplo <= 1) return Math.max(0, Math.floor(n));
  return Math.floor(Math.max(0, n) / multiplo) * multiplo;
}

export function calcularPlan(datos: {
  skus: string[];
  ventas: VentaDia[];
  snapshots: SnapshotDia[];
  stock: StockFull[];
  bodega: EnBodega[];
  enCamino: EnCamino[];
  parametros: ParametrosPlan;
  /** Último día que cuenta (completo). Por omisión, AYER. */
  hasta?: string;
}): Plan {
  const p = datos.parametros;
  const { desde, hasta } = ventana(datos.hasta ?? ayerDe(diaISO(new Date())), p.diasVenta);

  const enRango = (f: string) => f >= desde && f <= hasta;

  const ventasPorSku = agrupar(
    datos.ventas.filter((v) => enRango(v.fecha)),
    (v) => v.sku,
  );
  const snapsPorSku = agrupar(
    datos.snapshots.filter((s) => enRango(s.fecha)),
    (s) => s.sku,
  );

  const stockPorSku = new Map(datos.stock.map((s) => [s.sku, s]));

  const bodegaPorSku = new Map<string, number>();
  for (const b of datos.bodega) sumar(bodegaPorSku, b.skuMeli, b.unidades);

  const caminoPorSku = new Map<string, number>();
  for (const c of datos.enCamino) sumar(caminoPorSku, c.skuMeli, c.unidades);

  const lineas: LineaPlan[] = [];

  const losBloques = bloques(desde, hasta);
  const diasDe = (b: { desde: string; hasta: string }) =>
    Math.round((Date.parse(b.hasta) - Date.parse(b.desde)) / 86_400_000) + 1;

  for (const sku of datos.skus) {
    const ventas = ventasPorSku.get(sku) ?? [];
    const vendidas = ventas.reduce((a, v) => a + (v.unidades ?? 0), 0);

    // Días con stock: se miden con las fotos diarias. Un día con existencia
    // en cero no pudo vender, y contarlo como día de venta baja la demanda
    // justo de lo que más falta hace. Un día sin foto pero CON venta sí
    // tuvo stock: la venta lo demuestra.
    const snaps = snapsPorSku.get(sku) ?? [];
    const diasDeFoto = new Set(snaps.map((s) => s.fecha)).size;
    const porCalendario = diasDeFoto < p.diasVenta * COBERTURA_MINIMA_SNAPSHOTS;
    const conStock = new Set([
      ...snaps.filter((s) => (s.disponible ?? 0) > 0).map((s) => s.fecha),
      ...ventas.filter((v) => (v.unidades ?? 0) > 0).map((v) => v.fecha),
    ]);

    // Tasa de cada bloque, con su propio piso: sin él, un bloque con stock
    // de dos días se dispararía y el tope global quedaría sin efecto.
    const tasas: (number | null)[] = losBloques.map((b) => {
      const dias = diasDe(b);
      const unidades = ventas.filter((v) => v.fecha >= b.desde && v.fecha <= b.hasta).reduce((a, v) => a + (v.unidades ?? 0), 0);
      if (porCalendario) return unidades / dias;
      const medidos = [...conStock].filter((f) => f >= b.desde && f <= b.hasta).length;
      if (medidos === 0) return null; // sin stock todo el bloque: no dice nada
      const piso = Math.max(1, Math.ceil(dias / TOPE_CORRECCION));
      return unidades / Math.max(piso, Math.min(dias, medidos));
    });

    let sumaPesos = 0;
    let sumaTasas = 0;
    let diasConStock = 0;
    tasas.forEach((t, i) => {
      if (t == null) return;
      const w = PESOS_BLOQUES[i] ?? 0;
      sumaPesos += w;
      sumaTasas += w * t;
      const b = losBloques[i];
      diasConStock += porCalendario
        ? diasDe(b)
        : Math.max(Math.max(1, Math.ceil(diasDe(b) / TOPE_CORRECCION)), Math.min(diasDe(b), [...conStock].filter((f) => f >= b.desde && f <= b.hasta).length));
    });
    const ventaDiaria = sumaPesos > 0 ? sumaTasas / sumaPesos : 0;

    let tendencia: number | null = null;
    if (tasas[0] != null && tasas[1] != null && tasas[1] > 0) {
      tendencia = Math.max(TENDENCIA_MIN, Math.min(TENDENCIA_MAX, tasas[0] / tasas[1] - 1));
    }

    const st = stockPorSku.get(sku);
    const enFull = st?.disponible ?? 0;
    const enTransferencia = st?.enTransferencia ?? 0;
    const enCamino = caminoPorSku.get(sku) ?? 0;
    const posicion = enFull + enTransferencia + enCamino;

    const objetivo = ventaDiaria * p.diasObjetivo;
    const falta = objetivo - posicion;
    const enBodega = bodegaPorSku.get(sku) ?? 0;

    let mandar = 0;
    let motivo: MotivoNoEnviar = "ok";

    if (falta <= 0) {
      motivo = "sin_faltante";
    } else if (enBodega <= 0) {
      motivo = "sin_inventario";
    } else {
      const querido = subirADecena(falta, p.multiploEnvio);
      const tope = bajarADecena(enBodega, p.multiploEnvio);
      mandar = Math.min(querido, tope);

      if (mandar < p.minimoEnvio) {
        mandar = 0;
        motivo = "menos_de_una_decena";
      } else if (mandar < querido) {
        motivo = "topado_por_bodega";
      }
    }

    lineas.push({
      sku,
      vendidas,
      diasConStock,
      porCalendario,
      ventaDiaria,
      tendencia,
      enFull,
      enTransferencia,
      enCamino,
      posicion,
      cobertura: ventaDiaria > 0 ? posicion / ventaDiaria : Infinity,
      objetivo,
      falta: Math.max(0, falta),
      enBodega,
      mandar,
      motivo,
    });
  }

  // Primero lo que más urge: menos días de cobertura arriba.
  lineas.sort((a, b) => {
    if (b.mandar !== a.mandar) return b.mandar - a.mandar;
    return a.cobertura - b.cobertura;
  });

  return {
    lineas,
    unidades: lineas.reduce((a, l) => a + l.mandar, 0),
    skus: lineas.filter((l) => l.mandar > 0).length,
    faltanteSinCubrir: lineas.reduce((a, l) => a + Math.max(0, l.falta - l.mandar), 0),
    desde,
    hasta,
  };
}
