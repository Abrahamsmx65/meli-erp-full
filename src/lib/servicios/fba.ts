import type { RenglonAmazon } from "./amazon";
import { desglosarSku } from "./sync";
import { claveAplastada, claveComparacion } from "../importar/sku";
import { claveOrdenada, type IndiceCatalogo } from "../etiquetas/resolver";
import { numeroDePedido } from "./compras";
import { resumirEnCamino } from "./fba-en-camino";


/**
 * Clave de grupo modelo|color APLANADA: "GREY/BLK", "GREY-BLK" y "GREY BLK"
 * son el mismo color escrito por tres manos distintas (proforma, MELI,
 * Amazon). Sin aplanar, la corrida no se encontraba y salía "sin corrida:
 * no sé cuántas cajas son".
 */
export function claveGrupoFba(modelo: string, color: string): string {
  const m = (modelo ?? "").toUpperCase().replace(/[^A-Z0-9.]/g, "");
  const c = (color ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${m}|${c}`;
}

/**
 * Desglose que entiende los SKUs de Amazon: a veces traen la talla ANTES
 * del color (GT128-23-BLK-MX). Si el desglose normal no encuentra talla,
 * se busca el token que parece talla en cualquier posición.
 */
function desglosarAmazon(sku: string): { modelo: string | null; color: string | null; talla: string | null } {
  const d = desglosarSku(sku);
  if (d.talla) return d;
  const t = claveComparacion(sku).split("-");
  const idx = t.findIndex((x, i) => i > 0 && /^\d{1,2}(\.\d)?$/.test(x));
  if (idx > 0) {
    return {
      modelo: t[0] ?? null,
      color: t.filter((_, i) => i > 0 && i !== idx).join("-") || null,
      talla: t[idx],
    };
  }
  return d;
}
import { traerTodo, type DB } from "../datos/repos";

/** Días de venta que el stock en FBA debe cubrir. */
export const OBJETIVO_DIAS_FBA = 30;

/**
 * Días que tarda un envío en VOLVERSE stock vendible en FBA (armado, camión
 * y recepción de Amazon). El plan de Full protege su ventana de riesgo
 * (leadTime + periodo de revisión) más un stock de seguridad; el de FBA no
 * protegía nada y por eso sugería sistemáticamente de menos: para cuando el
 * envío llega, el objetivo de 30 días ya se comió dos semanas.
 */
export const RIESGO_DIAS_FBA = 14;

/** Con menos de esto de cobertura, el envío ya es urgente. */
export const URGENTE_DIAS_FBA = 14;

/**
 * Solo el calzado viaja a FBA en cajas: lo demás que viva en la cuenta de
 * Amazon (fundas, micas…) no entra a esta planeación.
 */
const PREFIJOS_CALZADO = ["GT", "MY", "YH", "G650"];

export function esCalzado(sku: string): boolean {
  const s = sku.trim().toUpperCase();
  return PREFIJOS_CALZADO.some((p) => s.startsWith(p));
}

export interface SugerenciaFba {
  modelo: string;
  color: string;
  producto: string;
  titulo: string | null;
  tallas: number;
  ventaDiaria: number;
  disponible: number;
  enTransferencia: number;
  cobertura: number | null;
  faltantePares: number;
  paresPorCaja: number | null;
  /** cajas completas a mandar; 0 cuando no hay corrida conocida */
  cajas: number;
  /** pares que viajan = cajas × pares por caja (o el faltante, sin corrida) */
  pares: number;
  tieneCorrida: boolean;
  /**
   * Regla de la corrida despareja: cuando la mayoría de las tallas NO tiene
   * faltante, completar los 30 días de la agotada sobre-surte al resto.
   * "mitad_corrida" = hermanas al día (sobrante ≤ 1.3× su venta de 30 días):
   * viaja la mitad de las cajas. "solo_7_dias" = corrida ya dispareja: solo
   * se cubren los próximos 7 días de las tallas agotadas.
   */
  ajusteCorrida: "mitad_corrida" | "solo_7_dias" | null;
}

/** Sobrante tolerado a las tallas hermanas: stock ≤ 1.3× su venta de 30 días. */
export const FACTOR_SOBRANTE_CORRIDA = 1.3;

/** Días a cubrir de la talla agotada cuando la corrida ya está dispareja. */
export const DIAS_CORRIDA_DISPAREJA = 7;

/**
 * Qué mandar a FBA, en CAJAS COMPLETAS por modelo + color.
 *
 * La misma regla que los envíos a Full: las cajas no se abren. Al ritmo de
 * venta del periodo se calcula el faltante por talla (venta del objetivo
 * menos lo que hay más lo que viaja), se suma por color y se redondea hacia
 * arriba a cajas completas usando la corrida del modelo. Los SKUs que no son
 * calzado (no empiezan con GT, MY, YH o G650) quedan fuera.
 */
export function sugerirEnvioFba(
  renglones: RenglonAmazon[],
  dias: number,
  corridas: Map<string, number>,
  objetivoDias = OBJETIVO_DIAS_FBA,
  indiceMeli?: IndiceCatalogo,
): SugerenciaFba[] {
  interface TallaGrupo {
    ventaDiaria: number;
    posicion: number;
    faltante: number;
  }
  interface Grupo {
    modelo: string;
    color: string;
    titulo: string | null;
    tallas: number;
    ventaDiaria: number;
    disponible: number;
    enTransferencia: number;
    faltante: number;
    detalleTallas: TallaGrupo[];
  }
  const grupos = new Map<string, Grupo>();

  for (const r of renglones) {
    if (!esCalzado(r.sku)) continue;
    // Primero el catálogo real de MELI (sabe modelo, color y talla de cada
    // SKU, venga como venga escrito el de Amazon); el desglose por guiones
    // queda de respaldo para lo que no esté publicado en MELI.
    const enCatalogo =
      indiceMeli?.exacto.get(r.sku.trim().toUpperCase()) ??
      indiceMeli?.canonico.get(claveComparacion(r.sku)) ??
      indiceMeli?.aplastado.get(claveAplastada(r.sku)) ??
      indiceMeli?.ordenado.get(claveOrdenada(r.sku));
    const d = enCatalogo?.modelo
      ? { modelo: enCatalogo.modelo, color: enCatalogo.color ?? "", talla: enCatalogo.talla ?? "" }
      : desglosarAmazon(r.sku);
    const modelo = (d.modelo ?? r.sku).toUpperCase();
    const color = (d.color ?? "").toUpperCase();
    const clave = claveGrupoFba(modelo, color);

    const g =
      grupos.get(clave) ??
      { modelo, color, titulo: r.titulo, tallas: 0, ventaDiaria: 0, disponible: 0, enTransferencia: 0, faltante: 0, detalleTallas: [] as TallaGrupo[] };

    const ventaDiaria = r.unidades / dias;
    const posicion = r.disponible + r.enTransferencia;
    g.tallas += 1;
    g.ventaDiaria += ventaDiaria;
    g.disponible += r.disponible;
    g.enTransferencia += r.enTransferencia;
    // El faltante se calcula POR TALLA y luego se suma: el sobrante de una
    // talla no tapa el hueco de otra. El objetivo cubre TAMBIÉN los días que
    // el envío tarda en volverse vendible en FBA.
    const faltanteTalla = Math.max(0, ventaDiaria * (objetivoDias + RIESGO_DIAS_FBA) - posicion);
    g.faltante += faltanteTalla;
    g.detalleTallas.push({ ventaDiaria, posicion, faltante: faltanteTalla });
    if (!g.titulo && r.titulo) g.titulo = r.titulo;
    grupos.set(clave, g);
  }

  return [...grupos.values()]
    .filter((g) => g.ventaDiaria > 0 && g.faltante >= 1)
    .map((g) => {
      const posicion = g.disponible + g.enTransferencia;
      const cobertura = g.ventaDiaria > 0 ? posicion / g.ventaDiaria : null;
      const paresPorCaja = corridas.get(claveGrupoFba(g.modelo, g.color)) ?? null;

      // Regla de la corrida despareja: si la MAYORÍA de las tallas no tiene
      // faltante, completar los 30 días de las agotadas sobre-surte al resto
      // (las cajas no se abren). Hermanas al día (sobrante ≤ 1.3× su venta
      // de 30 días) → viaja la mitad de las cajas; corrida ya dispareja →
      // solo se cubren los próximos 7 días de las tallas agotadas.
      const agotadas = g.detalleTallas.filter((t) => t.faltante >= 1);
      const sanas = g.detalleTallas.filter((t) => t.faltante < 1);
      let ajusteCorrida: SugerenciaFba["ajusteCorrida"] = null;
      let faltanteEnvio = g.faltante;
      if (agotadas.length > 0 && sanas.length > agotadas.length) {
        let peor = 0;
        // El sobrante se mide contra el objetivo REAL de la talla (30 días
        // + los 14 que el envío tarda en volverse vendible): contra 30
        // pelones, una talla recién surtida al objetivo ya sería "dispareja".
        const diasObjetivo = objetivoDias + RIESGO_DIAS_FBA;
        for (const t of sanas) {
          if (t.posicion <= 0) continue; // vacía: que le llegue no es sobrar
          peor = Math.max(
            peor,
            t.ventaDiaria > 0 ? t.posicion / (t.ventaDiaria * diasObjetivo) : Infinity,
          );
        }
        if (peor <= FACTOR_SOBRANTE_CORRIDA) {
          ajusteCorrida = "mitad_corrida";
          faltanteEnvio = g.faltante / 2;
        } else {
          ajusteCorrida = "solo_7_dias";
          faltanteEnvio = agotadas.reduce(
            (a, t) => a + Math.max(0, t.ventaDiaria * DIAS_CORRIDA_DISPAREJA - t.posicion),
            0,
          );
        }
      }

      const cajasCompletas = paresPorCaja ? Math.ceil(g.faltante / paresPorCaja) : 0;
      const cajas = paresPorCaja
        ? ajusteCorrida === "mitad_corrida"
          ? Math.ceil(cajasCompletas / 2)
          : Math.ceil(faltanteEnvio / paresPorCaja)
        : 0;
      return {
        modelo: g.modelo,
        color: g.color,
        producto: `${g.modelo} ${g.color}`.trim(),
        titulo: g.titulo,
        tallas: g.tallas,
        ventaDiaria: g.ventaDiaria,
        disponible: g.disponible,
        enTransferencia: g.enTransferencia,
        cobertura,
        faltantePares: Math.round(g.faltante),
        paresPorCaja,
        cajas,
        pares: paresPorCaja ? cajas * paresPorCaja : Math.round(faltanteEnvio),
        tieneCorrida: Boolean(paresPorCaja),
        ajusteCorrida,
      };
    })
    .sort((a, b) => (a.cobertura ?? 0) - (b.cobertura ?? 0));
}

/** Ventana de venta que alimenta el pedido a China (días). */
const VENTANA_VENTA_AMZ = 30;

/**
 * Tope de la corrección por agotamiento, el MISMO que usa el motor de
 * demanda de MELI (factorCorreccionMax = 3): la tasa corregida nunca puede
 * ser más de 3× lo realmente vendido, para no extrapolar de más con pocos
 * días de datos.
 */
export const FACTOR_CORRECCION_AMZ = 3;

/**
 * La venta diaria CORREGIDA por agotamiento, como la de MELI: las unidades
 * vendidas se dividen entre los días que el SKU de verdad tuvo stock, no
 * entre el calendario completo. Un SKU que vendió 20 pares pero pasó 20 de
 * los 30 días agotado vendía 2 al día, no 0.67.
 */
export function ventaDiariaCorregida(
  unidades: number,
  diasAgotado: number,
  ventana = VENTANA_VENTA_AMZ,
  factorMax = FACTOR_CORRECCION_AMZ,
): number {
  if (unidades <= 0 || ventana <= 0) return 0;
  const observada = unidades / ventana;
  const efectivos = Math.max(1, ventana - diasAgotado);
  return Math.min(unidades / efectivos, observada * factorMax);
}

interface AmazonCompraSku {
  /** venta diaria corregida por agotamiento (la que usa el cálculo) */
  ventaDiaria: number;
  /** venta diaria realmente observada (unidades / 30), sin corrección */
  ventaDiariaReal: number;
  stock: number;
}

/**
 * Amazon por SKU para el pedido a China: venta diaria de los últimos 30
 * días — corregida por agotamiento con las fotos diarias del inventario
 * (`amazon_inventario_snapshots`): un día con el SKU en cero y sin ventas
 * no cuenta como día de venta — junto a la observada, y el stock (FBA + lo
 * que viaja hacia FBA). Solo calzado. Si Amazon no está conectado o las
 * tablas están vacías, regresa un mapa vacío y el pedido se calcula solo
 * con MELI, como antes; sin fotos del inventario simplemente no se corrige.
 */
const cacheAmazonCompras = new Map<string, { en: number; datos: Map<string, AmazonCompraSku> }>();
const VIDA_CACHE_AMZ_MS = 60_000;

/** Solo para pruebas: olvida el minuto de caché. */
export function limpiarCacheAmazonCompras(): void {
  cacheAmazonCompras.clear();
}

export async function amazonParaCompras(
  db: DB,
): Promise<Map<string, AmazonCompraSku>> {
  // Cada clic en Planificación bajaba ~30 días de ventas de Amazon fila por
  // fila solo para sumarlas; un minuto de caché por instancia lo evita.
  const guardado = cacheAmazonCompras.get("unica");
  if (guardado && Date.now() - guardado.en < VIDA_CACHE_AMZ_MS) return guardado.datos;

  const desde = new Date(Date.now() - VENTANA_VENTA_AMZ * 86_400_000).toISOString().slice(0, 10);
  try {
    const [ventas, inventario, entrantes, fotos] = await Promise.all([
      // `fecha` va en el select para que la paginación ordene por una llave
      // ÚNICA (seller_sku solo empata entre días y duplicaba filas).
      traerTodo<any>(db, "amazon_ventas_diarias", "seller_sku, unidades, fecha", (q) =>
        q.gte("fecha", desde),
      ),
      traerTodo<any>(db, "amazon_inventario", "seller_sku, disponible, en_transferencia", (q) => q),
      // El detalle de envíos entrantes, para NO contar como stock lo que
      // lleva semanas atorado camino a FBA (mismo criterio que el plan).
      traerTodo<any>(
        db,
        "amazon_envios_entrantes",
        "shipment_id, seller_sku, nombre, estado, enviado, recibido, vigente",
        (q) => q,
      ).catch(() => [] as any[]),
      // Las fotos diarias del inventario, para saber qué días estuvo en
      // cero cada SKU. Si aún no hay fotos, la corrección simplemente no
      // aplica (venta corregida = observada).
      traerTodo<any>(
        db,
        "amazon_inventario_snapshots",
        "seller_sku, fecha, disponible",
        (q) => q.gte("fecha", desde),
      ).catch(() => [] as any[]),
    ]);
    const enCamino = resumirEnCamino(entrantes);

    // Unidades por SKU y en qué fechas vendió (si vendió, ese día SÍ tuvo
    // stock aunque la foto lo marque en cero: se agotó a media jornada).
    const ventaSku = new Map<string, { unidades: number; fechas: Set<string> }>();
    for (const v of ventas) {
      const sku = String(v.seller_sku ?? "");
      if (!esCalzado(sku)) continue;
      const e = ventaSku.get(sku) ?? { unidades: 0, fechas: new Set<string>() };
      e.unidades += v.unidades ?? 0;
      if ((v.unidades ?? 0) > 0) e.fechas.add(String(v.fecha ?? ""));
      ventaSku.set(sku, e);
    }

    // Días agotado = fotos con disponible en cero y sin venta ese día.
    const diasAgotado = new Map<string, number>();
    for (const f of fotos) {
      const sku = String(f.seller_sku ?? "");
      if (!esCalzado(sku)) continue;
      if ((f.disponible ?? 0) > 0) continue;
      if (ventaSku.get(sku)?.fechas.has(String(f.fecha ?? ""))) continue;
      diasAgotado.set(sku, (diasAgotado.get(sku) ?? 0) + 1);
    }

    const mapa = new Map<string, AmazonCompraSku>();
    const entrada = (sku: string) => {
      const e = mapa.get(sku) ?? { ventaDiaria: 0, ventaDiariaReal: 0, stock: 0 };
      mapa.set(sku, e);
      return e;
    };
    for (const [sku, v] of ventaSku) {
      const e = entrada(sku);
      e.ventaDiariaReal = v.unidades / VENTANA_VENTA_AMZ;
      e.ventaDiaria = ventaDiariaCorregida(v.unidades, diasAgotado.get(sku) ?? 0);
    }
    for (const i of inventario) {
      const sku = String(i.seller_sku ?? "");
      if (!esCalzado(sku)) continue;
      const camino = enCamino
        ? (enCamino.porSku.get(sku) ?? 0)
        : (i.en_transferencia ?? 0);
      entrada(sku).stock += (i.disponible ?? 0) + camino;
    }
    // Un mapa vacío aquí deja la Planificación China sin el lado Amazon y
    // nadie se entera: que por lo menos quede gritado en los logs.
    if (mapa.size === 0) {
      console.error(
        `amazonParaCompras: mapa VACÍO (ventas=${ventas.length}, inventario=${inventario.length}, entrantes=${entrantes.length})`,
      );
    }
    cacheAmazonCompras.set("unica", { en: Date.now(), datos: mapa });
    return mapa;
  } catch (err) {
    console.error("amazonParaCompras tronó:", (err as Error).message);
    return new Map();
  }
}

/** Corridas por modelo+color → pares por caja, para redondear a cajas. */
export function mapaCorridas(
  corridasRaw: { modelo?: string; color?: string; tallas?: Record<string, number>; total?: number; pedido?: string }[],
): Map<string, number> {
  const porClave = new Map<string, { total: number; pedido: string }>();
  for (const c of corridasRaw) {
    const clave = claveGrupoFba(c.modelo ?? "", c.color ?? "");
    const total =
      c.total ?? Object.values(c.tallas ?? {}).reduce((a, b) => a + Number(b), 0);
    if (!total) continue;
    const previa = porClave.get(clave);
    // La corrida del pedido más nuevo es la vigente (por NÚMERO, no por
    // texto: "IN9999" > "IN10160" como cadena).
    if (!previa || numeroDePedido(String(c.pedido ?? "")) > numeroDePedido(previa.pedido)) {
      porClave.set(clave, { total, pedido: String(c.pedido ?? "") });
    }
  }
  return new Map([...porClave.entries()].map(([k, v]) => [k, v.total]));
}
