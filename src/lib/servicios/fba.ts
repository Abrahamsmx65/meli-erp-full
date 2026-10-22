import { cuentaAmazon, type RenglonAmazon } from "./amazon";
import { desglosarSku } from "./sync";
import { claveAplastada, claveComparacion } from "../importar/sku";
import { claveOrdenada, type IndiceCatalogo } from "../etiquetas/resolver";
import { numeroDePedido } from "./compras";
import { resumirEnCamino } from "./fba-en-camino";
import type { ReglaFba } from "./fba-plan";


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
export function desglosarAmazon(sku: string): {
  modelo: string | null;
  color: string | null;
  talla: string | null;
} {
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
import { traerRpcTodo, traerTodo, type DB } from "../datos/repos";
import { esErrorObjetoLegacy } from "./errores-datos";

/** Días de venta que el stock en FBA debe cubrir. */
export const OBJETIVO_DIAS_FBA = 30;

/**
 * Días que tarda un envío en VOLVERSE stock vendible en FBA (armado, camión
 * y recepción de Amazon). El plan de Full protege su ventana de riesgo
 * (leadTime + periodo de revisión) más un stock de seguridad; el de FBA no
 * protegía nada y por eso sugería sistemáticamente de menos. El dato es del
 * negocio: el envío a Amazon tarda ~7 días en estar vendible (el 14 inicial
 * era una estimación de más).
 */
export const RIESGO_DIAS_FBA = 7;

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
   * faltante, completar el objetivo de la agotada sobre-surte al resto.
   * "mitad_corrida" = hermanas al día (posición ≤ 1.5× su venta del
   * objetivo): viaja la mitad de las cajas. "solo_7_dias" = corrida ya
   * dispareja: viaja una semana de venta de las tallas agotadas, no más.
   */
  ajusteCorrida: ReglaFba | null;
  /** SKUs (de MELI si amarran) del modelo + color: así se cruza con el plan de cajas */
  skus?: string[];
  /**
   * Sin venta en Amazon y el plan le manda cajas: producto NUEVO o que
   * nunca ha vendido y se manda a probar (posición mínima de 2 cajas).
   */
  aProbar?: boolean;
}

/**
 * Lo que el plan de cajas le pasa a la vista «Por producto»: las cajas que de
 * verdad viajan y las reglas que tocaron a cada talla. Con él, la vista dice
 * lo mismo que el plan (antes llevaba su propia cuenta con la regla vieja).
 */
export interface PlanParaSugerencias {
  cajas: {
    cantidad: number;
    paresTotales: number;
    modelo?: string;
    color?: string;
    aporta: { sku: string }[];
  }[];
  ajustesCorrida: { sku: string; regla: ReglaFba }[];
}

/** Cómo se lee cada regla en la pantalla y en el Excel. */
export function etiquetaAjusteFba(regla: ReglaFba): string {
  switch (regla) {
    case "mitad_corrida":
      return "tallas agotadas con el resto al día: viaja la mitad de las cajas";
    case "solo_7_dias":
      return `corrida dispareja: solo ${DIAS_CORRIDA_DISPAREJA} días de las tallas agotadas`;
    case "quince_dias":
      return "las hermanas quedarían muy surtidas: la talla corta va a 15 días";
    case "goteo":
      return "goteo: una caja por envío";
    case "cobertura_suficiente":
      return "a la talla corta le alcanza para 15 días: no se fuerza la caja";
    case "colchon":
      return "va en subida: objetivo de 45 días";
    case "tope_color":
      return "va en subida: tope de cajas del color por envío";
  }
}

// Si una talla trae varias reglas, la que se enseña en el producto.
const ORDEN_REGLA: ReglaFba[] = [
  "tope_color",
  "colchon",
  "goteo",
  "quince_dias",
  "cobertura_suficiente",
  "mitad_corrida",
  "solo_7_dias",
];

/**
 * Sobrante tolerado a las tallas hermanas: posición ≤ 1.5× su venta del
 * objetivo. Lo fijó el negocio (26-ago-2026): la posición trae el en camino
 * dentro y 1.3 marcaba "dispareja" corridas que el negocio ve al día.
 */
export const FACTOR_SOBRANTE_CORRIDA = 1.5;

/** Días a cubrir de la talla agotada cuando la corrida ya está dispareja. */
export const DIAS_CORRIDA_DISPAREJA = 7;

/**
 * Faltante junto (pares) de las tallas cortas a partir del cual esa venta
 * pesa más que el sobrante: con más que esto, la corrida dispareja se
 * surte COMPLETA en vez de gotear 7 días. Lo fijó el negocio en 200.
 */
export const FALTANTE_GRANDE_CORRIDA = 200;

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
  plan?: PlanParaSugerencias,
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
    skus: string[];
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
      { modelo, color, titulo: r.titulo, tallas: 0, ventaDiaria: 0, disponible: 0, enTransferencia: 0, faltante: 0, detalleTallas: [] as TallaGrupo[], skus: [] as string[] };
    g.skus.push(enCatalogo?.sku ? String(enCatalogo.sku) : r.sku);

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

  // Con el plan de cajas, la vista dice lo que el plan manda: sus cajas y
  // sus reglas (hermanas, goteo, colchón), no una cuenta aparte.
  let grupoDeSku: Map<string, string> | null = null;
  const delPlan = new Map<string, { cajas: number; pares: number; regla: ReglaFba | null }>();
  // Cajas de productos que Amazon no tiene en sus renglones (nunca han
  // vendido): el plan las manda a probar y la vista también las enseña.
  const sinRenglon = new Map<
    string,
    { modelo: string; color: string; cajas: number; pares: number; skus: Set<string> }
  >();
  if (plan) {
    grupoDeSku = new Map();
    for (const [clave, g] of grupos) for (const sk of g.skus) grupoDeSku.set(sk, clave);
    for (const c of plan.cajas) {
      const clave = c.aporta.map((a) => grupoDeSku!.get(a.sku)).find((x) => x);
      if (!clave) {
        const modelo = (c.modelo ?? "").toUpperCase();
        const color = (c.color ?? "").toUpperCase();
        const k = claveGrupoFba(modelo, color);
        const x = sinRenglon.get(k) ?? { modelo, color, cajas: 0, pares: 0, skus: new Set<string>() };
        x.cajas += c.cantidad;
        x.pares += c.paresTotales;
        for (const a of c.aporta) x.skus.add(a.sku);
        sinRenglon.set(k, x);
        continue;
      }
      const d = delPlan.get(clave) ?? { cajas: 0, pares: 0, regla: null };
      d.cajas += c.cantidad;
      d.pares += c.paresTotales;
      delPlan.set(clave, d);
    }
    for (const a of plan.ajustesCorrida) {
      const clave = grupoDeSku.get(a.sku);
      if (!clave) continue;
      const d = delPlan.get(clave) ?? { cajas: 0, pares: 0, regla: null };
      if (d.regla === null || ORDEN_REGLA.indexOf(a.regla) < ORDEN_REGLA.indexOf(d.regla)) {
        d.regla = a.regla;
      }
      delPlan.set(clave, d);
    }
  }

  const extras: SugerenciaFba[] = [...sinRenglon.values()].map((x) => ({
    modelo: x.modelo,
    color: x.color,
    producto: `${x.modelo} ${x.color}`.trim(),
    titulo: null,
    tallas: x.skus.size,
    ventaDiaria: 0,
    disponible: 0,
    enTransferencia: 0,
    cobertura: null,
    faltantePares: 0,
    paresPorCaja: corridas.get(claveGrupoFba(x.modelo, x.color)) ?? null,
    cajas: x.cajas,
    pares: x.pares,
    tieneCorrida: true,
    ajusteCorrida: null,
    skus: [...x.skus],
    aProbar: true,
  }));

  return [...grupos.entries()]
    .filter(
      ([clave, g]) =>
        (g.ventaDiaria > 0 && g.faltante >= 1) || (delPlan.get(clave)?.cajas ?? 0) > 0,
    )
    .map(([clave, g]): SugerenciaFba => {
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
        // El sobrante se mide con la posición completa contra el objetivo
        // real de la talla (30 días + los 7 que el envío tarda en volverse
        // vendible): contra 30 pelones, una talla recién surtida al
        // objetivo ya sería "dispareja".
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
        } else if (g.faltante <= FALTANTE_GRANDE_CORRIDA) {
          ajusteCorrida = "solo_7_dias";
          // Una semana de venta de cada talla agotada por envío; su
          // faltante (que ya trae la posición descontada) hace de tope.
          faltanteEnvio = agotadas.reduce(
            (a, t) => a + Math.min(t.faltante, t.ventaDiaria * DIAS_CORRIDA_DISPAREJA),
            0,
          );
        }
        // Con un faltante junto de más de 200 pares, esa venta pesa más
        // que la hermana pasada del factor: se surte COMPLETO, sin ajuste.
      }

      const enPlan = plan ? (delPlan.get(clave) ?? { cajas: 0, pares: 0, regla: null }) : null;
      const cajasCompletas = paresPorCaja ? Math.ceil(g.faltante / paresPorCaja) : 0;
      const cajasCuenta = paresPorCaja
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
        cajas: enPlan ? enPlan.cajas : cajasCuenta,
        pares: enPlan
          ? enPlan.pares
          : paresPorCaja
            ? cajasCuenta * paresPorCaja
            : Math.round(faltanteEnvio),
        tieneCorrida: Boolean(paresPorCaja) || (enPlan?.cajas ?? 0) > 0,
        ajusteCorrida: enPlan ? enPlan.regla : ajusteCorrida,
        skus: g.skus,
        aProbar: g.ventaDiaria <= 0 && (enPlan?.cajas ?? 0) > 0,
      };
    })
    .concat(extras)
    // Lo que se manda a probar (sin cobertura) va al final.
    .sort((a, b) =>
      a.cobertura === null || b.cobertura === null
        ? Number(a.cobertura === null) - Number(b.cobertura === null)
        : a.cobertura - b.cobertura,
    );
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

export interface AmazonCompraSku {
  /** venta diaria corregida por agotamiento (la que usa el cálculo) */
  ventaDiaria: number;
  /** venta diaria realmente observada (unidades / 30), sin corrección */
  ventaDiariaReal: number;
  stock: number;
}

export interface AmazonParaComprasResultado {
  datos: Map<string, AmazonCompraSku>;
  advertencias: string[];
  disponible: boolean;
}

/**
 * Amazon por SKU para el pedido a China: venta diaria de los últimos 30
 * días — corregida por agotamiento con las fotos diarias del inventario
 * (`amazon_inventario_snapshots`): un día con el SKU en cero y sin ventas
 * no cuenta como día de venta — junto a la observada, y el stock (FBA + lo
 * que viaja hacia FBA). Solo calzado. Si Amazon no está conectado o las
 * tablas están vacías, regresa un mapa vacío. Si falla una fuente opcional,
 * conserva los datos válidos y declara la degradación; las fuentes obligatorias
 * propagan el error para impedir que se confunda una falla con un cero real.
 */
const cacheAmazonCompras = new Map<
  string,
  { en: number; resultado: AmazonParaComprasResultado }
>();
const VIDA_CACHE_AMZ_MS = 60_000;

/** Solo para pruebas: olvida el minuto de caché. */
export function limpiarCacheAmazonCompras(): void {
  cacheAmazonCompras.clear();
}

/**
 * La suma en la base. Devuelve null si la función no existe todavía, si
 * la base no sabe de RPC (las pruebas) o si truena: el llamador cae al
 * camino renglón por renglón.
 */
async function resumenComprasEnBase(
  db: DB,
  cuentaId: string,
  desde: string,
): Promise<{ seller_sku: string; unidades: number | string; dias_agotado: number }[] | null> {
  if (typeof (db as any).rpc !== "function") return null;
  try {
    // Por PÁGINAS: el API corta en 1,000 renglones y la suma trae ~1,900
    // SKUs; sin paginar, Planificación China perdía la venta de casi mil
    // SKUs sin avisar.
    const { filas, error, errorCodigo } = await traerRpcTodo<{
      seller_sku: string;
      unidades: number | string;
      dias_agotado: number;
    }>(db, "amazon_compras_por_sku", { p_account: cuentaId, p_desde: desde });
    if (error) {
      if (esErrorObjetoLegacy({ message: error, code: errorCodigo }, ["amazon_compras_por_sku"])) {
        return null;
      }
      throw new Error(`amazon_compras_por_sku: ${error}`);
    }
    return filas;
  } catch (error) {
    throw error;
  }
}

export async function amazonParaCompras(
  db: DB,
): Promise<AmazonParaComprasResultado> {
  // Cada clic en Planificación bajaba ~30 días de ventas de Amazon fila por
  // fila solo para sumarlas; un minuto de caché por instancia lo evita.
  const guardado = cacheAmazonCompras.get("unica");
  if (guardado && Date.now() - guardado.en < VIDA_CACHE_AMZ_MS) return guardado.resultado;

  const desde = new Date(Date.now() - VENTANA_VENTA_AMZ * 86_400_000).toISOString().slice(0, 10);
  try {
    const advertencias: string[] = [];
    // Las lecturas van FILTRADAS por la cuenta de Amazon. Sin el filtro,
    // Postgres no podía usar el índice (account_id, fecha, …) que ordena la
    // paginación y volvía a ordenar ~80 mil fotos en disco EN CADA PÁGINA:
    // hasta 7 s por página, ~100 páginas por clic en /pedidos, y la base
    // entera lenta para todos mientras tanto. Hay una sola cuenta, así que
    // el resultado es el mismo. Si no se puede saber la cuenta (o la base
    // simulada de las pruebas no la tiene), se lee sin filtro, como antes.
    let cuentaId: string | null = null;
    try {
      cuentaId = (await cuentaAmazon(db))?.id ?? null;
    } catch {
      cuentaId = null;
    }
    const porCuenta = (q: any) => (cuentaId ? q.eq("account_id", cuentaId) : q);

    // La venta por SKU y los días agotado se piden YA SUMADOS a la base
    // (`amazon_compras_por_sku`, migración 0050): bajar 30 días de ventas
    // diarias y de fotos del inventario renglón por renglón eran más de
    // cien viajes al API por clic, y /pedidos moría a los 60 s de Vercel
    // con la base cargada. Si la función no existe (o la base simulada de
    // las pruebas no la tiene), se cae al camino viejo, renglón por renglón.
    const resumen = cuentaId ? await resumenComprasEnBase(db, cuentaId, desde) : null;

    const [ventas, inventario, entrantes, fotos] = await Promise.all([
      resumen
        ? Promise.resolve([] as any[])
        : // `fecha` va en el select para que la paginación ordene por una
          // llave ÚNICA (seller_sku solo empata entre días y duplicaba filas).
          traerTodo<any>(db, "amazon_ventas_diarias", "seller_sku, unidades, fecha", (q) =>
            porCuenta(q).gte("fecha", desde),
          ),
      traerTodo<any>(db, "amazon_inventario", "seller_sku, disponible, en_transferencia", (q) =>
        porCuenta(q),
      ),
      // El detalle de envíos entrantes, para NO contar como stock lo que
      // lleva semanas atorado camino a FBA (mismo criterio que el plan).
      traerTodo<any>(
        db,
        "amazon_envios_entrantes",
        "shipment_id, seller_sku, nombre, estado, enviado, recibido, vigente",
        (q) => porCuenta(q),
      ).catch((err) => {
        advertencias.push(
          `No se pudieron leer los envíos entrantes de Amazon: ${(err as Error).message}`,
        );
        return [] as any[];
      }),
      // Las fotos diarias del inventario, para saber qué días estuvo en
      // cero cada SKU. Si aún no hay fotos, la corrección simplemente no
      // aplica (venta corregida = observada).
      resumen
        ? Promise.resolve([] as any[])
        : traerTodo<any>(
            db,
            "amazon_inventario_snapshots",
            "seller_sku, fecha, disponible",
            (q) => porCuenta(q).gte("fecha", desde),
          ).catch((err) => {
            advertencias.push(
              `No se pudieron leer los días agotados de Amazon: ${(err as Error).message}`,
            );
            return [] as any[];
          }),
    ]);
    const enCamino = resumirEnCamino(entrantes);

    // Unidades por SKU y en qué fechas vendió (si vendió, ese día SÍ tuvo
    // stock aunque la foto lo marque en cero: se agotó a media jornada).
    const ventaSku = new Map<string, { unidades: number; fechas: Set<string> }>();
    // Días agotado = fotos con disponible en cero y sin venta ese día.
    const diasAgotado = new Map<string, number>();

    if (resumen) {
      for (const r of resumen) {
        const sku = String(r.seller_sku ?? "");
        if (!esCalzado(sku)) continue;
        ventaSku.set(sku, { unidades: Number(r.unidades) || 0, fechas: new Set<string>() });
        if ((r.dias_agotado ?? 0) > 0) diasAgotado.set(sku, Number(r.dias_agotado));
      }
    } else {
      for (const v of ventas) {
        const sku = String(v.seller_sku ?? "");
        if (!esCalzado(sku)) continue;
        const e = ventaSku.get(sku) ?? { unidades: 0, fechas: new Set<string>() };
        e.unidades += v.unidades ?? 0;
        if ((v.unidades ?? 0) > 0) e.fechas.add(String(v.fecha ?? ""));
        ventaSku.set(sku, e);
      }
      for (const f of fotos) {
        const sku = String(f.seller_sku ?? "");
        if (!esCalzado(sku)) continue;
        if ((f.disponible ?? 0) > 0) continue;
        if (ventaSku.get(sku)?.fechas.has(String(f.fecha ?? ""))) continue;
        diasAgotado.set(sku, (diasAgotado.get(sku) ?? 0) + 1);
      }
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
    const resultado = { datos: mapa, advertencias, disponible: true };
    if (advertencias.length === 0) {
      cacheAmazonCompras.set("unica", { en: Date.now(), resultado });
    }
    return resultado;
  } catch (err) {
    console.error("amazonParaCompras tronó:", (err as Error).message);
    throw err;
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
