/**
 * Costos de envío por publicación: encontrar las variantes mal medidas.
 *
 * Cómo cobra MELI el envío en Full: al recibir la mercancía la MIDE y guarda
 * el resultado en los atributos PACKAGE_HEIGHT/WIDTH/LENGTH/WEIGHT de la
 * publicación (con PACKAGE_DATA_SOURCE = MEASUREMENT; si dice SELLER son las
 * que declaró el vendedor). Con esas medidas calcula un peso facturable y de
 * ahí sale el costo de envío que nos descuenta en cada venta.
 *
 * El problema: esa medición se equivoca seguido. En el GT229 —el caso que
 * destapó esto— quince tallas miden ~27 × 24 × 10 cm y cobran $88.50, pero
 * una quedó guardada como 11 × 29 × 37 cm ($139.50) y otra como 28 × 25 × 25
 * ($190). Es la misma pantufla en la misma caja: la diferencia es un error de
 * captura que se paga en CADA venta de esa talla.
 *
 * Cómo se detecta aquí: las hermanas del mismo modelo son la evidencia. Se
 * ordenan los tres lados de cada caja de mayor a menor (MELI a veces guarda
 * los ejes permutados, y eso NO es un error: 26×10×26 y 10×26×26 son la misma
 * caja), se saca la mediana lado por lado entre las hermanas, y esa mediana es
 * "la medida real". Después se le pregunta al simulador de MELI cuánto cuesta
 * el envío con las medidas que tiene la publicación y cuánto costaría con las
 * de consenso. La diferencia es el sobrecosto, y con eso se arma el caso.
 *
 * El simulador es `/users/{id}/shipping_options/free`. Pide las medidas como
 * "AltoxAnchoxLargo,gramos" y SOLO acepta enteros (con decimales contesta 400),
 * así que los centímetros se redondean hacia arriba. Contesta `list_cost` (el
 * costo que paga el vendedor, ya con el descuento de envío gratis obligatorio)
 * y `billable_weight` (el peso facturable que salió de esas medidas).
 */
import { MeliClient, enLotes, trozos } from "../meli/client";
import { traerTodo, type DB } from "../datos/repos";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
export interface Medida {
  alto: number;
  ancho: number;
  largo: number;
  peso: number;
}

export interface VarianteEnvio {
  sku: string;
  itemId: string | null;
  /** el "código Full" con el que MELI identifica el producto en la bodega */
  inventoryId: string | null;
  modelo: string;
  color: string | null;
  talla: string | null;
  /** medidas con las que MELI cobra hoy; null si la publicación no las tiene */
  medida: Medida | null;
  /** MEASUREMENT = las midió MELI · SELLER = las declaró el vendedor */
  fuente: string | null;
  /** las que declaró el vendedor, para ver si MELI las pisó */
  medidaVendedor: Medida | null;
  precio: number | null;
  tipoPublicacion: string | null;
  envioGratis: boolean;
  estado: string | null;
  costo: number | null;
  costoNormal: number | null;
  pesoFacturable: number | null;
}

/** Un pedido real: lo que MELI cobró y lo que cobró a las hermanas a ese mismo precio. */
export interface CobroReal {
  fecha: string;
  /** total del pedido por unidad: el envío cambia con él */
  total: number;
  envio: number;
  /** lo que pagaron las hermanas del modelo al mismo precio; null si ninguna vendió a ese precio */
  normal: number | null;
  hermanas: number;
}

/**
 * Lo que MELI cobró de envío en las ventas REALES de un SKU (por unidad),
 * comparado pedido por pedido contra las hermanas AL MISMO PRECIO (RPC
 * `envio_real_por_sku`). El envío cambia con el precio de cada pedido, así
 * que dos pedidos a distinto precio no se comparan.
 */
export interface EnvioReal {
  ordenes: number;
  unidades: number;
  /** mediana de todo lo cobrado por unidad, sin distinguir precio */
  mediana: number;
  /** pedidos que tuvieron alguna hermana al mismo precio con qué compararse */
  comparables: number;
  /** pedidos que pagaron más de $5 sobre lo normal de las hermanas */
  ordenesDeMas: number;
  /** pesos pagados de más en la ventana (solo diferencias mayores a $5 por pedido) */
  pagadoDeMas: number;
  /** mediana de (cobrado − normal) en los comparables; negativo = paga menos que las hermanas */
  deMasPorVenta: number | null;
  /** los dos últimos pedidos, el más reciente primero */
  ultimos: CobroReal[];
}

export interface VarianteRevisada extends VarianteEnvio {
  /** la medida de consenso del modelo (lo que miden sus hermanas) */
  medidaReal: Medida | null;
  /** costo - costoNormal según el SIMULADOR, solo si es positivo */
  sobrecosto: number;
  /** lo que MELI cobró en sus ventas reales; null si no vendió en la ventana */
  envioReal: EnvioReal | null;
  /** pesos pagados de más en la ventana, real (0 si no cobra de más o no hay con qué comparar) */
  pagadoDeMas: number;
  /** true si el veredicto sale de ventas reales comparables; false si solo del simulador */
  conVentas: boolean;
}

export interface ModeloRevisado {
  modelo: string;
  variantes: VarianteRevisada[];
  /** cuántas hermanas sostienen la medida de consenso */
  hermanas: number;
  medidaReal: Medida | null;
  /** el costo normal según el simulador */
  costoNormal: number | null;
  /**
   * las que cobran de más. Con ventas comparables manda lo real
   * (pagadoDeMas > 0); sin ventas en la ventana, lo que dice el simulador.
   */
  malas: VarianteRevisada[];
  /** el sobrecosto SIMULADO que sale de MI bolsa: solo las de envío gratis */
  sobrecosto: number;
  /** pesos pagados de más en la ventana, real, sumando las malas con ventas */
  pagadoDeMas: number;
}

/** Con menos pedidos comparables el veredicto real no vale: manda el simulador. */
const MIN_COMPARABLES = 2;
/**
 * Un solo pedido con envío doble casi siempre es un carrito cuya otra orden
 * no está registrada, no una medida mal capturada: para señalar una talla
 * hacen falta al menos dos pedidos que hayan pagado de más.
 */
const MIN_ORDENES_DE_MAS = 2;

// ---------------------------------------------------------------------------
// Lectura de los atributos de MELI
// ---------------------------------------------------------------------------
interface ValorCrudo {
  name?: string | null;
  struct?: { number?: number | null; unit?: string | null } | null;
}

interface AtributoCrudo {
  id?: string;
  value_name?: string | null;
  value_struct?: { number?: number | null; unit?: string | null } | null;
  /** el user product manda el valor SOLO aquí: sin value_name ni value_struct */
  values?: ValorCrudo[] | null;
}

/**
 * Saca un número de un atributo de medida. MELI manda `value_struct`
 * ({number: 26.2, unit: "cm"}) cuando puede, y "26.2 cm" en texto cuando no.
 * El user product (`/user-products/{id}`) no manda ninguno de los dos: su
 * valor viene SOLO en `values[0].struct` / `values[0].name`. Hasta el
 * 25-sep-2026 eso no se leía y 1,110 de 1,693 publicaciones —todas las que
 * guardan la medida en el user product— quedaban "sin medida" y fuera de la
 * revisión. El peso llega en g o en kg según la publicación: aquí siempre
 * sale en g, y las medidas siempre en cm.
 */
export function numeroDeAtributo(a: AtributoCrudo | undefined, aGramos = false): number | null {
  if (!a) return null;
  const struct = a.value_struct ?? a.values?.[0]?.struct ?? null;
  let n = typeof struct?.number === "number" ? struct.number : null;
  let unidad = struct?.unit ?? null;

  if (n == null) {
    const texto = (a.value_name ?? a.values?.[0]?.name ?? "").trim();
    const m = texto.match(/^([\d.,]+)\s*([a-zA-Z]*)$/);
    if (!m) return null;
    n = Number(m[1].replace(",", "."));
    unidad = m[2] || unidad;
  }
  if (n == null || !Number.isFinite(n)) return null;

  const u = (unidad ?? "").toLowerCase();
  if (aGramos) {
    if (u === "kg") return n * 1000;
    return n; // g
  }
  if (u === "mm") return n / 10;
  if (u === "m") return n * 100;
  return n; // cm
}

function medidaDe(
  mapa: Map<string, AtributoCrudo>,
  prefijo: "PACKAGE" | "SELLER_PACKAGE",
): Medida | null {
  const alto = numeroDeAtributo(mapa.get(`${prefijo}_HEIGHT`));
  const ancho = numeroDeAtributo(mapa.get(`${prefijo}_WIDTH`));
  const largo = numeroDeAtributo(mapa.get(`${prefijo}_LENGTH`));
  const peso = numeroDeAtributo(mapa.get(`${prefijo}_WEIGHT`), true);
  if (alto == null || ancho == null || largo == null || peso == null) return null;
  if (alto <= 0 || ancho <= 0 || largo <= 0 || peso <= 0) return null;
  return { alto, ancho, largo, peso };
}

/** Lee las medidas (las de MELI y las del vendedor) de los atributos de un item. */
export function medidasDeAtributos(atributos: AtributoCrudo[] | undefined): {
  medida: Medida | null;
  medidaVendedor: Medida | null;
  fuente: string | null;
} {
  const mapa = new Map<string, AtributoCrudo>();
  for (const a of atributos ?? []) if (a?.id) mapa.set(a.id, a);
  return {
    medida: medidaDe(mapa, "PACKAGE"),
    medidaVendedor: medidaDe(mapa, "SELLER_PACKAGE"),
    fuente: mapa.get("PACKAGE_DATA_SOURCE")?.value_name ?? mapa.get("PACKAGE_DATA_SOURCE")?.values?.[0]?.name ?? null,
  };
}

// ---------------------------------------------------------------------------
// Comparación entre hermanas
// ---------------------------------------------------------------------------
/**
 * Los tres lados de mayor a menor. MELI guarda los ejes en cualquier orden
 * (la misma caja aparece como 26×26×10 en una talla y 10×26×26 en otra), así
 * que sin ordenar primero se marcarían como distintas cajas idénticas.
 */
export function ladosOrdenados(m: Medida): [number, number, number] {
  const [a, b, c] = [m.alto, m.ancho, m.largo].sort((x, y) => y - x);
  return [a, b, c];
}

function mediana(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

/**
 * La medida "real" del modelo: la mediana lado por lado (ya ordenados) y la
 * mediana del peso entre todas las hermanas que sí tienen medidas.
 *
 * Mediana y no promedio a propósito: el promedio se lo lleva justo el error
 * que estamos buscando (una caja de 37 cm entre quince de 10 empuja el
 * promedio y tapa el problema). Con menos de tres hermanas no hay consenso
 * que valga: se devuelve null y ese modelo se reporta "sin comparación".
 */
export function medidaDeConsenso(variantes: VarianteEnvio[]): Medida | null {
  const conMedida = variantes.filter((v) => v.medida).map((v) => v.medida!);
  if (conMedida.length < 3) return null;
  // Los lados salen ordenados de mayor a menor, así que la mediana del mayor
  // es el largo de la caja, la del de en medio el ancho y la del menor el
  // alto. Se nombran así para que la medida de consenso se lea como se ve una
  // caja de zapatos (28 × 24 × 10) y no al revés.
  const lados = conMedida.map(ladosOrdenados);
  return {
    largo: mediana(lados.map((l) => l[0])),
    ancho: mediana(lados.map((l) => l[1])),
    alto: mediana(lados.map((l) => l[2])),
    peso: mediana(conMedida.map((m) => m.peso)),
  };
}

/** Tolerancias: medio centímetro y 20 g no son un error de captura. */
const HOLGURA_CM = 0.5;
const HOLGURA_G = 20;

/**
 * ¿Vale la pena preguntarle el costo al simulador?
 *
 * Solo si la caja se pasa del consenso en algún lado o en el peso. Si todos
 * sus lados y su peso están por debajo, el peso facturable no puede salir
 * mayor y el envío no puede costar más: preguntar sería gastar una llamada
 * para confirmar que no hay problema.
 */
export function puedeCobrarDeMas(m: Medida, consenso: Medida): boolean {
  const suyos = ladosOrdenados(m);
  const buenos = ladosOrdenados(consenso);
  if (m.peso > consenso.peso + HOLGURA_G) return true;
  return suyos.some((lado, i) => lado > buenos[i] + HOLGURA_CM);
}

/** Formato que pide el simulador: "AltoxAnchoxLargo,gramos", SOLO enteros. */
export function dimensionesParaMeli(m: Medida): string {
  const cm = (n: number) => Math.max(1, Math.ceil(n - 0.001));
  return `${cm(m.alto)}x${cm(m.ancho)}x${cm(m.largo)},${Math.max(1, Math.round(m.peso))}`;
}

export function claveTarifa(m: Medida, precio: number, tipo: string): string {
  return `${dimensionesParaMeli(m)}|${Math.round(precio)}|${tipo}`;
}

// ---------------------------------------------------------------------------
// Armado del diagnóstico (puro: se prueba sin tocar MELI ni la base)
// ---------------------------------------------------------------------------
export function armarRevision(
  variantes: VarianteEnvio[],
  enviosReales: Map<string, EnvioReal> = new Map(),
): ModeloRevisado[] {
  const porModelo = new Map<string, VarianteEnvio[]>();
  for (const v of variantes) {
    const k = v.modelo || "(sin modelo)";
    const lista = porModelo.get(k);
    if (lista) lista.push(v);
    else porModelo.set(k, [v]);
  }

  const salida: ModeloRevisado[] = [];
  for (const [modelo, lista] of porModelo) {
    const medidaReal = medidaDeConsenso(lista);
    const hermanas = lista.filter((v) => v.medida).length;

    // El costo "normal" del modelo es el que más se repite entre las hermanas
    // que están bien medidas; si no hay ninguno calculado todavía, queda null.
    const normales = lista
      .map((v) => v.costoNormal)
      .filter((c): c is number => typeof c === "number");
    const costoNormal = normales.length ? mediana(normales) : null;

    const revisadas: VarianteRevisada[] = lista.map((v) => {
      const real = enviosReales.get(v.sku) ?? null;
      const conVentas = !!real && real.comparables >= MIN_COMPARABLES;
      return {
        ...v,
        medidaReal,
        // El sobrecosto se calcula pague quien pague. Con envío gratis lo absorbe
        // el vendedor; sin él lo paga el comprador, y un envío inflado por una
        // medida mal capturada espanta la venta igual. Las dos cosas hay que
        // verlas; lo que NO se mezcla es el dinero: la suma del modelo cuenta
        // solo lo que sale de la bolsa propia.
        sobrecosto:
          v.costo != null && v.costoNormal != null
            ? Math.max(0, Math.round((v.costo - v.costoNormal) * 100) / 100)
            : 0,
        envioReal: real,
        pagadoDeMas: conVentas ? Math.round(real.pagadoDeMas * 100) / 100 : 0,
        conVentas,
      };
    });

    // Manda lo real: una variante con ventas comparables es mala solo si de
    // verdad pagó de más. Sin ventas en la ventana, vale lo que dice el
    // simulador (es lo único que hay, y avisa de lo que va a pasar al vender).
    const malas = revisadas.filter((v) =>
      v.conVentas ? v.pagadoDeMas > 0 && (v.envioReal?.ordenesDeMas ?? 0) >= MIN_ORDENES_DE_MAS : v.sobrecosto > 0,
    );
    const redondear = (n: number) => Math.round(n * 100) / 100;
    salida.push({
      modelo,
      variantes: revisadas.sort((a, b) => a.sku.localeCompare(b.sku, "es")),
      hermanas,
      medidaReal,
      costoNormal,
      malas: malas.sort((a, b) => b.pagadoDeMas - a.pagadoDeMas || b.sobrecosto - a.sobrecosto),
      sobrecosto: redondear(
        malas.filter((v) => v.envioGratis).reduce((a, v) => a + v.sobrecosto, 0),
      ),
      pagadoDeMas: redondear(malas.reduce((a, v) => a + v.pagadoDeMas, 0)),
    });
  }

  // Primero los modelos con dinero REAL de por medio, luego los que solo el
  // simulador señala, después el resto por nombre.
  return salida.sort(
    (a, b) =>
      b.pagadoDeMas - a.pagadoDeMas || b.sobrecosto - a.sobrecosto || a.modelo.localeCompare(b.modelo, "es"),
  );
}

// ---------------------------------------------------------------------------
// Traer las medidas de MELI
// ---------------------------------------------------------------------------
interface VariacionCruda {
  id?: number | string | null;
  price?: number | null;
  inventory_id?: string | null;
  user_product_id?: string | null;
}

interface ItemCrudo {
  id: string;
  price?: number | null;
  status?: string | null;
  listing_type_id?: string | null;
  shipping?: { free_shipping?: boolean; logistic_type?: string | null } | null;
  attributes?: AtributoCrudo[];
  variations?: VariacionCruda[];
}

interface FilaSku {
  sku: string;
  item_id: string | null;
  variation_id: string | null;
  user_product_id: string | null;
  inventory_id: string | null;
  modelo: string | null;
  color: string | null;
  talla: string | null;
  estado: string | null;
}

interface FilaPrevia {
  sku: string;
  alto: number | null;
  ancho: number | null;
  largo: number | null;
  peso: number | null;
  fuente: string | null;
  medidas_en: string | null;
  costo: number | null;
  costo_normal: number | null;
  precio_venta: number | null;
  precio_en: string | null;
}

/** Cada cuánto se vuelve a leer el precio de venta: las promociones cambian a diario. */
const REFRESCO_PRECIO_MS = 86_400_000;

/**
 * ¿Hay que volver a pedirle a MELI la medida de esta publicación?
 *
 *   · Sin medida guardada: sí, obvio.
 *   · Cobra de más: SIEMPRE. Son justo las que se reclamaron; la corrección
 *     de MELI se ve cuando se relee, y son pocas (decenas, no miles).
 *   · El resto: cuando la lectura guardada ya cumplió `refrescoMs`.
 *
 * `medidas_en` es la fecha en que se LEYÓ de MELI, no la de la última pasada:
 * una pasada que reutiliza la medida guardada no la vuelve fresca. Ese era el
 * bug que dejaba las corregidas como pendientes para siempre: cada "revisar
 * de nuevo" les ponía fecha de hoy sin releerlas y los 30 días nunca corrían.
 */
export function hayQueReleer(
  previa: Pick<FilaPrevia, "alto" | "medidas_en" | "costo" | "costo_normal"> | undefined,
  refrescoMs: number,
  ahora = Date.now(),
): boolean {
  if (!previa || previa.alto == null) return true;
  if (previa.costo != null && previa.costo_normal != null && previa.costo > previa.costo_normal) return true;
  const leidaEn = previa.medidas_en ? Date.parse(previa.medidas_en) : 0;
  return ahora - leidaEn >= refrescoMs;
}

/**
 * Relee de MELI las medidas de todas las publicaciones de Full.
 *
 * Las medidas viven en DOS lugares distintos y hay que ir por los dos:
 *
 *   · Publicación por talla (una MLM = un SKU): los atributos PACKAGE_* vienen
 *     en el item, y el multiget (`/items?ids=`) trae 20 de un golpe.
 *   · Publicación con variantes dentro (una MLM con 100 tallas): ni el item ni
 *     la variante traen PACKAGE_*. Viven en el "user product" de cada variante,
 *     que se consulta de una en una porque MELI limita esa ruta a ~1/s. Son la
 *     mayoría de los SKUs de Full, así que no es un caso de borde.
 *
 * Por eso la lectura de user products va por tandas: se atienden primero las
 * que nunca se han leído y después las más viejas, hasta que se acaba el
 * tiempo (`limiteMs`). Lo que quedó se reporta en `pendientes` y se termina en
 * la siguiente pasada. `refrescarDias` es cada cuánto se vuelve a preguntar
 * por una medida que ya se tenía: MELI vuelve a medir de vez en cuando, y la
 * medida nueva es justo lo que hay que vigilar.
 */
export async function sincronizarMedidas(
  cliente: MeliClient,
  db: DB,
  accountId: string,
  opts?: { limiteMs?: number; refrescarDias?: number },
): Promise<{
  publicaciones: number;
  conMedidas: number;
  sinMedidas: number;
  userProducts: number;
  pendientes: number;
}> {
  const arranque = Date.now();
  const limite = opts?.limiteMs ?? 120_000;
  const refresco = (opts?.refrescarDias ?? 30) * 86_400_000;

  const filas = await traerTodo<FilaSku>(
    db,
    "skus",
    "sku, item_id, variation_id, user_product_id, inventory_id, modelo, color, talla, estado",
    (q) => q.eq("account_id", accountId).eq("activo", true).not("item_id", "is", null),
  );

  // Varios SKUs comparten publicación cuando la publicación tiene variantes:
  // se pide cada item UNA vez y se reparte a sus SKUs.
  const itemIds = [...new Set(filas.map((f) => f.item_id).filter((x): x is string => !!x))];

  const items = new Map<string, ItemCrudo>();
  await enLotes(trozos(itemIds, 20), 5, async (lote) => {
    const r = await cliente.get<{ code: number; body: ItemCrudo }[]>("/items", {
      ids: lote.join(","),
      attributes: "id,price,status,listing_type_id,shipping,attributes,variations",
    });
    for (const e of r ?? []) {
      if (e?.code === 200 && e.body?.id) items.set(e.body.id, e.body);
    }
  });

  const previas = await traerTodo<FilaPrevia>(
    db,
    "medidas_envio",
    "sku, alto, ancho, largo, peso, fuente, medidas_en, costo, costo_normal, precio_venta, precio_en",
    (q) => q.eq("account_id", accountId),
  );
  const antes = new Map(previas.map((p) => [p.sku, p]));
  // Las que sí se le preguntaron a MELI en ESTA pasada: solo esas estrenan
  // fecha de lectura. Las que se reutilizaron de la base conservan la suya.
  const leidasAhora = new Set<string>();

  // ------------------------------------------------------------ primera vuelta
  // Lo que se puede resolver con lo que ya trajo el multiget.
  interface Pendiente {
    fila: FilaSku;
    userProductId: string;
    desde: number; // qué tan vieja es la medida guardada: primero las que faltan
  }

  const resueltas = new Map<string, { medida: Medida | null; medidaVendedor: Medida | null; fuente: string | null }>();
  const porUserProduct = new Map<string, Pendiente[]>();
  const base = new Map<string, { item: ItemCrudo; variacion: VariacionCruda | null }>();

  for (const f of filas) {
    const item = f.item_id ? items.get(f.item_id) : undefined;
    if (!item) continue;
    // Solo Full: en drop off el envío no se cobra con estas medidas.
    if ((item.shipping?.logistic_type ?? null) !== "fulfillment") continue;

    const variacion =
      f.variation_id && item.variations
        ? (item.variations.find((v) => String(v.id) === String(f.variation_id)) ?? null)
        : null;
    base.set(f.sku, { item, variacion });

    const delItem = medidasDeAtributos(item.attributes);
    if (delItem.medida) {
      resueltas.set(f.sku, delItem);
      leidasAhora.add(f.sku);
      continue;
    }

    // Sin medidas en la publicación: hay que ir al user product de la variante.
    const up = variacion?.user_product_id ?? f.user_product_id ?? null;
    if (!up) continue;

    const previa = antes.get(f.sku);
    const leidaEn = previa?.medidas_en ? Date.parse(previa.medidas_en) : 0;
    if (previa?.alto != null && !hayQueReleer(previa, refresco)) {
      // La medida guardada sigue fresca: no se gasta una llamada en ella.
      resueltas.set(f.sku, {
        medida: { alto: previa.alto, ancho: previa.ancho!, largo: previa.largo!, peso: previa.peso! },
        medidaVendedor: null,
        fuente: previa.fuente,
      });
      continue;
    }

    const lista = porUserProduct.get(up);
    const pendiente: Pendiente = { fila: f, userProductId: up, desde: leidaEn };
    if (lista) lista.push(pendiente);
    else porUserProduct.set(up, [pendiente]);
  }

  // ------------------------------------------------------------ user products
  // Primero las que nunca se han leído, después las más viejas.
  const cola = [...porUserProduct.entries()].sort((a, b) => a[1][0].desde - b[1][0].desde);
  let leidos = 0;
  let pendientes = 0;

  // De cinco en cinco. La nota vieja decía "~1/s" y de ahí venía la idea de
  // preguntar de una en una, pero medido contra la cuenta real: de 20
  // llamadas simultáneas pasaron 16 y 4 contestaron 429. Cinco en vuelo
  // avanza cinco veces más rápido y los rebotes ocasionales los absorbe el
  // reintento con espera del cliente, que respeta el Retry-After de MELI.
  // Las medidas se llevan hasta el 70 % del tiempo: el resto es para los
  // precios de venta, que si no nunca arrancaban (con 1,110 user products
  // por leer, cada pasada se acababa antes de llegar a ellos).
  const limiteMedidas = limite * 0.7;
  await enLotes(cola, 5, async ([up, grupo]) => {
    if (Date.now() - arranque > limiteMedidas) {
      pendientes += grupo.length;
      return;
    }
    try {
      const cuerpo = await cliente.get<{ attributes?: AtributoCrudo[] }>(`/user-products/${up}`, undefined, {
        reintentos: 3,
      });
      leidos++;
      const m = medidasDeAtributos(cuerpo?.attributes);
      for (const p of grupo) {
        resueltas.set(p.fila.sku, m);
        leidasAhora.add(p.fila.sku);
      }
    } catch {
      // Una que MELI no contesta se queda pendiente y se reintenta después.
      pendientes += grupo.length;
    }
  });

  // ------------------------------------------------------------ precio de venta
  // El costo de envío se cobra por tramo de PRECIO ($299–$498 con descuento,
  // desde $499 completo) y el precio de la publicación no es el que se vende:
  // una de $499 puede estar en promoción a $341, y MELI enseña y cobra el
  // envío a $341. `/items/{id}/sale_price` da ese precio; es una llamada por
  // publicación, así que va por tandas con el mismo presupuesto de tiempo:
  // primero las que nunca se han leído, después las más viejas (se refresca
  // cada día: las promociones cambian).
  const porItem = new Map<string, { skus: string[]; desde: number }>();
  for (const f of filas) {
    if (!f.item_id || !base.has(f.sku)) continue;
    const previa = antes.get(f.sku);
    const leidoEn = previa?.precio_en ? Date.parse(previa.precio_en) : 0;
    const entrada = porItem.get(f.item_id);
    if (entrada) {
      entrada.skus.push(f.sku);
      entrada.desde = Math.min(entrada.desde, leidoEn);
    } else porItem.set(f.item_id, { skus: [f.sku], desde: leidoEn });
  }
  const preciosLeidos = new Map<string, number>(); // sku → precio de venta
  const colaPrecios = [...porItem.entries()]
    .filter(([, e]) => Date.now() - e.desde >= REFRESCO_PRECIO_MS)
    .sort((a, b) => a[1].desde - b[1].desde);
  let preciosPendientes = 0;
  await enLotes(colaPrecios, 5, async ([itemId, e]) => {
    if (Date.now() - arranque > limite) {
      preciosPendientes += e.skus.length;
      return;
    }
    try {
      const sp = await cliente.get<{ amount?: number | null }>(
        `/items/${itemId}/sale_price`,
        { context: "channel_marketplace" },
        { reintentos: 2 },
      );
      // Si MELI no da precio de venta, vale el de la publicación (se anota
      // igual para no volver a preguntar hoy).
      const item = items.get(itemId);
      const precio = typeof sp?.amount === "number" && sp.amount > 0 ? sp.amount : (item?.price ?? null);
      if (precio != null) for (const sku of e.skus) preciosLeidos.set(sku, precio);
    } catch {
      preciosPendientes += e.skus.length;
    }
  });
  pendientes += preciosPendientes;

  // ------------------------------------------------------------------ guardar
  const ahora = new Date().toISOString();
  let conMedidas = 0;

  const renglones = filas
    .filter((f) => base.has(f.sku))
    .map((f) => {
      const { item, variacion } = base.get(f.sku)!;
      const leida = resueltas.get(f.sku);
      const medida = leida?.medida ?? null;
      if (medida) conMedidas++;

      const previa = antes.get(f.sku);
      const huella = (a: number | null, b: number | null, c: number | null, d: number | null) =>
        `${a}x${b}x${c},${d}`;
      const precioVenta = preciosLeidos.get(f.sku);
      // Si cambiaron las medidas O el precio de venta, el costo guardado ya no vale.
      const cambio =
        !previa ||
        huella(previa.alto, previa.ancho, previa.largo, previa.peso) !==
          huella(medida?.alto ?? null, medida?.ancho ?? null, medida?.largo ?? null, medida?.peso ?? null) ||
        (precioVenta != null && Number(previa.precio_venta) !== precioVenta);

      return {
        account_id: accountId,
        sku: f.sku,
        item_id: f.item_id,
        inventory_id: variacion?.inventory_id ?? f.inventory_id,
        user_product_id: variacion?.user_product_id ?? f.user_product_id,
        modelo: f.modelo ?? "",
        color: f.color,
        talla: f.talla,
        alto: medida?.alto ?? null,
        ancho: medida?.ancho ?? null,
        largo: medida?.largo ?? null,
        peso: medida?.peso ?? null,
        fuente: leida?.fuente ?? null,
        largo_vendedor: leida?.medidaVendedor?.largo ?? null,
        ancho_vendedor: leida?.medidaVendedor?.ancho ?? null,
        alto_vendedor: leida?.medidaVendedor?.alto ?? null,
        peso_vendedor: leida?.medidaVendedor?.peso ?? null,
        precio: variacion?.price ?? item.price ?? null,
        tipo_publicacion: item.listing_type_id ?? null,
        envio_gratis: item.shipping?.free_shipping ?? true,
        estado: item.status ?? f.estado,
        // Si las medidas cambiaron, el costo guardado ya no vale.
        ...(cambio ? { costo: null, costo_normal: null, peso_facturable: null } : {}),
        // La fecha de lectura solo cambia si de verdad se le preguntó a MELI.
        ...(medida && leidasAhora.has(f.sku) ? { medidas_en: ahora } : {}),
        ...(precioVenta != null ? { precio_venta: precioVenta, precio_en: ahora } : {}),
        actualizado_en: ahora,
      };
    });

  for (const lote of trozos(renglones, 500)) {
    const { error } = await db.from("medidas_envio").upsert(lote, { onConflict: "account_id,sku" });
    if (error) throw new Error(`medidas_envio: ${error.message}`);
  }

  return {
    publicaciones: renglones.length,
    conMedidas,
    sinMedidas: renglones.length - conMedidas,
    userProducts: leidos,
    pendientes,
  };
}

// ---------------------------------------------------------------------------
// Preguntarle el costo a MELI
// ---------------------------------------------------------------------------
interface RespuestaSimulador {
  coverage?: {
    all_country?: {
      list_cost?: number | null;
      cost?: number | null;
      billable_weight?: number | null;
      discount?: unknown;
    } | null;
  } | null;
}

export interface Tarifa {
  /** `list_cost`: el costo de lista del envío para el vendedor */
  costo: number | null;
  pesoFacturable: number | null;
  /** `cost`: lo que MELI dice que paga el vendedor ya con sus descuentos, si lo manda */
  costoConDescuento?: number | null;
  /** la respuesta cruda de `coverage.all_country`, para la sonda */
  crudo?: unknown;
}

/**
 * El simulador de costos de envío de MELI para ESTA cuenta.
 * El costo depende del vendedor (su nivel y sus descuentos), de las medidas y
 * del precio de la publicación, así que la caché lleva las tres cosas.
 */
export async function preguntarTarifa(
  cliente: MeliClient,
  meliUserId: number,
  m: Medida,
  precio: number,
  tipo: string,
): Promise<Tarifa> {
  const r = await cliente.get<RespuestaSimulador>(
    `/users/${meliUserId}/shipping_options/free`,
    {
      dimensions: dimensionesParaMeli(m),
      verbose: "true",
      item_price: Math.round(precio),
      listing_type_id: tipo,
      mode: "me2",
      condition: "new",
      logistic_type: "fulfillment",
    },
    { reintentos: 2 },
  );
  const c = r?.coverage?.all_country ?? null;
  return {
    costo: typeof c?.list_cost === "number" ? c.list_cost : null,
    pesoFacturable: typeof c?.billable_weight === "number" ? c.billable_weight : null,
    costoConDescuento: typeof c?.cost === "number" ? c.cost : null,
    crudo: c,
  };
}

interface FilaMedida {
  sku: string;
  item_id: string | null;
  inventory_id: string | null;
  modelo: string | null;
  color: string | null;
  talla: string | null;
  alto: number | null;
  ancho: number | null;
  largo: number | null;
  peso: number | null;
  fuente: string | null;
  alto_vendedor: number | null;
  ancho_vendedor: number | null;
  largo_vendedor: number | null;
  peso_vendedor: number | null;
  precio: number | null;
  precio_venta: number | null;
  tipo_publicacion: string | null;
  envio_gratis: boolean | null;
  estado: string | null;
  costo: number | null;
  costo_normal: number | null;
  peso_facturable: number | null;
}

function aVariante(f: FilaMedida): VarianteEnvio {
  const completa = (a: number | null, b: number | null, c: number | null, p: number | null) =>
    a != null && b != null && c != null && p != null ? { alto: a, ancho: b, largo: c, peso: p } : null;
  return {
    sku: f.sku,
    itemId: f.item_id,
    inventoryId: f.inventory_id,
    modelo: f.modelo ?? "",
    color: f.color,
    talla: f.talla,
    medida: completa(f.alto, f.ancho, f.largo, f.peso),
    fuente: f.fuente,
    medidaVendedor: completa(f.alto_vendedor, f.ancho_vendedor, f.largo_vendedor, f.peso_vendedor),
    // El precio con el que se cobra el envío es el de VENTA (promoción), no
    // el de lista; sin él, el de lista.
    precio: f.precio_venta ?? f.precio,
    tipoPublicacion: f.tipo_publicacion,
    envioGratis: f.envio_gratis ?? true,
    estado: f.estado,
    costo: f.costo,
    costoNormal: f.costo_normal,
    pesoFacturable: f.peso_facturable,
  };
}

/**
 * Calcula, para cada publicación, cuánto cuesta su envío con las medidas que
 * tiene y cuánto costaría con las de sus hermanas.
 *
 * Dos ahorros que hacen que esto sea viable:
 *   · la caché `tarifas_envio` (misma caja + mismo precio = misma tarifa), y
 *   · no preguntar por las cajas que están POR DEBAJO del consenso: si ningún
 *     lado ni el peso se pasan, el envío no puede costar más.
 *
 * `limiteMs` corta el trabajo antes de que Vercel corte la función: lo que
 * quedó pendiente se devuelve en el conteo y se termina en la siguiente
 * pasada, que ya encuentra hecho todo lo anterior.
 */
export async function calcularCostos(
  cliente: MeliClient,
  db: DB,
  accountId: string,
  meliUserId: number,
  opts?: { limiteMs?: number; soloModelo?: string },
): Promise<{ calculadas: number; pendientes: number; llamadas: number }> {
  const arranque = Date.now();
  const limite = opts?.limiteMs ?? 240_000;

  const filas = await traerTodo<FilaMedida>(
    db,
    "medidas_envio",
    "sku, item_id, inventory_id, modelo, color, talla, alto, ancho, largo, peso, fuente, alto_vendedor, ancho_vendedor, largo_vendedor, peso_vendedor, precio, precio_venta, tipo_publicacion, envio_gratis, estado, costo, costo_normal, peso_facturable",
    (q) => {
      const base = q.eq("account_id", accountId);
      return opts?.soloModelo ? base.eq("modelo", opts.soloModelo) : base;
    },
  );

  const cache = new Map<string, Tarifa>();
  const guardadas = await traerTodo<{ clave: string; costo: number | null; peso_facturable: number | null }>(
    db,
    "tarifas_envio",
    "clave, costo, peso_facturable",
    (q) => q.eq("account_id", accountId),
  );
  for (const t of guardadas) cache.set(t.clave, { costo: t.costo, pesoFacturable: t.peso_facturable });

  const nuevas: { clave: string; tarifa: Tarifa }[] = [];
  let llamadas = 0;

  const tarifa = async (m: Medida, precio: number, tipo: string): Promise<Tarifa> => {
    const clave = claveTarifa(m, precio, tipo);
    const guardada = cache.get(clave);
    if (guardada) return guardada;
    const t = await preguntarTarifa(cliente, meliUserId, m, precio, tipo);
    llamadas++;
    cache.set(clave, t);
    nuevas.push({ clave, tarifa: t });
    return t;
  };

  // Consenso por modelo, con TODAS las hermanas (aunque se haya pedido un modelo).
  const porModelo = new Map<string, VarianteEnvio[]>();
  for (const f of filas) {
    const v = aVariante(f);
    const lista = porModelo.get(v.modelo);
    if (lista) lista.push(v);
    else porModelo.set(v.modelo, [v]);
  }

  const cambios: Record<string, unknown>[] = [];
  let pendientes = 0;

  for (const [, lista] of porModelo) {
    const consenso = medidaDeConsenso(lista);

    for (const v of lista) {
      // Ya calculada y sin cambios: no se vuelve a preguntar.
      if (v.costo != null && v.costoNormal != null) continue;
      if (!v.medida || !consenso || v.precio == null) continue;

      if (Date.now() - arranque > limite) {
        pendientes++;
        continue;
      }

      const tipo = v.tipoPublicacion || "gold_special";
      try {
        const normal = await tarifa(consenso, v.precio, tipo);
        const suya = puedeCobrarDeMas(v.medida, consenso)
          ? await tarifa(v.medida, v.precio, tipo)
          : normal;

        cambios.push({
          account_id: accountId,
          sku: v.sku,
          costo: suya.costo,
          costo_normal: normal.costo,
          peso_facturable: suya.pesoFacturable,
        });
      } catch {
        // Una publicación que el simulador rechaza (medidas absurdas, sin
        // precio válido) no debe tumbar la revisión entera: se queda sin
        // costo y se vuelve a intentar en la siguiente pasada.
        pendientes++;
      }
    }
  }

  for (const lote of trozos(cambios, 500)) {
    const { error } = await db.from("medidas_envio").upsert(lote, { onConflict: "account_id,sku" });
    if (error) throw new Error(`medidas_envio (costos): ${error.message}`);
  }

  const ahora = new Date().toISOString();
  for (const lote of trozos(nuevas, 500)) {
    const { error } = await db.from("tarifas_envio").upsert(
      lote.map((n) => ({
        account_id: accountId,
        clave: n.clave,
        costo: n.tarifa.costo,
        peso_facturable: n.tarifa.pesoFacturable,
        actualizado_en: ahora,
      })),
      { onConflict: "account_id,clave" },
    );
    if (error) throw new Error(`tarifas_envio: ${error.message}`);
  }

  return { calculadas: cambios.length, pendientes, llamadas };
}

/** Lo guardado, ya comparado y ordenado, para la pantalla y para el Excel. */
/** Ventana de ventas reales con la que se compara: dos meses de cobros. */
export const DIAS_VENTAS_REALES = 60;

interface FilaEnvioReal {
  sku: string;
  ordenes: number;
  unidades: number;
  mediana: number | string;
  comparables: number;
  ordenes_de_mas: number;
  pagado_de_mas: number | string;
  de_mas_por_venta: number | string | null;
  ultimos: { fecha: string; total: number; envio: number; normal: number | null; hermanas: number }[] | null;
}

/** Arma el mapa sku → EnvioReal con lo que contesta el RPC. */
export function armarEnviosReales(filas: FilaEnvioReal[]): Map<string, EnvioReal> {
  const salida = new Map<string, EnvioReal>();
  for (const f of filas) {
    salida.set(f.sku, {
      ordenes: Number(f.ordenes),
      unidades: Number(f.unidades),
      mediana: Number(f.mediana),
      comparables: Number(f.comparables),
      ordenesDeMas: Number(f.ordenes_de_mas ?? 0),
      pagadoDeMas: Number(f.pagado_de_mas),
      deMasPorVenta: f.de_mas_por_venta == null ? null : Number(f.de_mas_por_venta),
      ultimos: (f.ultimos ?? []).map((u) => ({
        fecha: u.fecha,
        total: Number(u.total),
        envio: Number(u.envio),
        normal: u.normal == null ? null : Number(u.normal),
        hermanas: Number(u.hermanas ?? 0),
      })),
    });
  }
  return salida;
}

/**
 * Lo que MELI cobró de envío en las ventas reales de cada SKU (RPC
 * `envio_real_por_sku`, sobre `ordenes_neto.envio_vendedor`). Si el RPC
 * falla se devuelve vacío y la revisión se queda con el simulador: se
 * declara con `conVentas = false`, no se inventa.
 */
export async function leerEnviosReales(db: DB, accountId: string): Promise<Map<string, EnvioReal>> {
  const desde = new Date(Date.now() - DIAS_VENTAS_REALES * 86_400_000).toISOString();
  const { data, error } = await db.rpc("envio_real_por_sku", { p_account: accountId, p_desde: desde });
  if (error) return new Map();
  return armarEnviosReales((data ?? []) as FilaEnvioReal[]);
}

export async function leerRevision(db: DB, accountId: string): Promise<ModeloRevisado[]> {
  const [filas, reales] = await Promise.all([
    traerTodo<FilaMedida>(
      db,
      "medidas_envio",
      "sku, item_id, inventory_id, modelo, color, talla, alto, ancho, largo, peso, fuente, alto_vendedor, ancho_vendedor, largo_vendedor, peso_vendedor, precio, precio_venta, tipo_publicacion, envio_gratis, estado, costo, costo_normal, peso_facturable",
      (q) => q.eq("account_id", accountId),
    ),
    leerEnviosReales(db, accountId),
  ]);
  return armarRevision(filas.map(aVariante), reales);
}
