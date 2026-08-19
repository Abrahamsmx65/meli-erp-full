/**
 * Integración con el sistema de inventarios de Industher.
 *
 * El almacén expone un API con la misma información que el reporte de
 * existencias que hoy se sube a mano en /importar. Aquí se descarga, se
 * normaliza a la misma forma (FilaExistencia) y se guarda en la tabla
 * `existencias`, reemplazando SOLO los renglones de los almacenes que el API
 * reporta — los que siguen llegando por Excel (si los hay) no se tocan.
 *
 * Igual que con el Excel: los campos se buscan por NOMBRE, no por posición.
 * Como todavía no conocemos la forma exacta de la respuesta, el normalizador
 * acepta sinónimos y reporta qué campos reconoció y cuáles ignoró, para poder
 * auditar la primera sincronización real y ajustar si hace falta.
 */
import { canonizar, normalizarTalla } from "../importar/sku";
import type { FilaExistencia } from "../importar/excel";
import { upsertEnTandas, type DB } from "../datos/repos";
import { invalidar } from "./cache";

const URL_POR_OMISION = "https://inventarios-industher.vercel.app/api/integracion/inventario";
const ALMACEN_POR_OMISION = "Industher";

// ---------------------------------------------------------------------------
// Descarga
// ---------------------------------------------------------------------------

/**
 * Al pegar la llave en Vercel es fácil que se cuelen comillas o espacios
 * (sobre todo copiándola de un .env o de un chat). Se limpian aquí: una llave
 * con basura alrededor falla con "API Key inválida" y nadie sabe por qué.
 */
function limpiarValor(v: string | undefined): string {
  return (v ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
}

export function configuracionIndusther(): { url: string; apiKey: string } | null {
  const apiKey = limpiarValor(process.env.INDUSTHER_API_KEY);
  if (!apiKey) return null;
  return { url: limpiarValor(process.env.INDUSTHER_API_URL) || URL_POR_OMISION, apiKey };
}

/** Baja el inventario crudo del API de Industher. Nunca registra la llave. */
export async function descargarInventarioIndusther(): Promise<unknown> {
  const config = configuracionIndusther();
  if (!config) {
    throw new Error(
      "Falta INDUSTHER_API_KEY en las variables de entorno. Agrégala en Vercel para activar la integración.",
    );
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(config.url, {
      headers: { "x-api-key": config.apiKey, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      throw new Error("El API de Industher no contestó en 30 segundos.");
    }
    throw new Error(`No se pudo alcanzar el API de Industher: ${e.message}`);
  }

  const texto = await respuesta.text();
  let cuerpo: unknown = null;
  try {
    cuerpo = texto ? JSON.parse(texto) : null;
  } catch {
    throw new Error(
      `El API de Industher contestó ${respuesta.status} pero no regresó JSON válido.`,
    );
  }

  if (!respuesta.ok) {
    const detalle =
      (cuerpo as { error?: string; mensaje?: string; message?: string } | null)?.error ??
      (cuerpo as { mensaje?: string } | null)?.mensaje ??
      (cuerpo as { message?: string } | null)?.message ??
      `HTTP ${respuesta.status}`;
    throw new Error(`El API de Industher rechazó la petición: ${detalle}`);
  }

  return cuerpo;
}

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

export interface InventarioNormalizado {
  filas: FilaExistencia[];
  avisos: string[];
  almacenes: string[];
  /** campo nuestro -> clave tal como vino en el JSON del API */
  camposDetectados: Record<string, string>;
  /** claves del API que no se reconocieron (para auditar la primera corrida) */
  camposIgnorados: string[];
}

/**
 * Sinónimos aceptados por campo, en forma canónica. El primero que exista en
 * el JSON gana. Mismo espíritu que localizarEncabezado() del Excel.
 */
const SINONIMOS: Record<string, string[]> = {
  almacen: ["ALMACEN", "BODEGA", "WAREHOUSE", "SUCURSAL"],
  codigoAlmacen: ["CODIGO-ALMACEN", "CLAVE-ALMACEN", "CODIGO-BODEGA"],
  skuCaja: ["SKU", "SKU-CAJA", "CODIGO", "CLAVE", "CODIGO-SKU"],
  pedido: ["N-PEDIDO", "PEDIDO", "NO-PEDIDO", "NUM-PEDIDO", "NUMERO-PEDIDO", "ORDEN"],
  modelo: ["MODELO", "ESTILO", "MODEL"],
  color: ["COLOR"],
  talla: ["TALLA", "SIZE", "MEDIDA"],
  contenedor: ["CONTENEDOR", "CONTAINER"],
  cajasFisicas: ["CAJAS-FISICAS", "FISICAS", "CAJAS-TOTALES", "TOTAL-CAJAS"],
  cajasApartadas: ["CAJAS-APARTADAS", "APARTADAS", "RESERVADAS", "CAJAS-RESERVADAS"],
  enCamino: ["EN-CAMINO", "EN-TRANSITO", "TRANSITO"],
  cajasDisponibles: [
    "CAJAS-DISPONIBLES",
    "DISPONIBLES",
    "CAJAS",
    "EXISTENCIA-CAJAS",
    "STOCK-CAJAS",
    "CANTIDAD-CAJAS",
  ],
  paresPorCaja: [
    "PARES-POR-CAJA",
    "PARES-CAJA",
    "PIEZAS-POR-CAJA",
    "PZAS-POR-CAJA",
    "UNIDADES-POR-CAJA",
  ],
};

/** Claves bajo las que suele venir envuelta la lista en una respuesta JSON. */
const ENVOLTURAS = [
  "INVENTARIO",
  "EXISTENCIAS",
  "DATA",
  "DATOS",
  "ITEMS",
  "PRODUCTOS",
  "RESULTADOS",
  "RESULTS",
  "ROWS",
  "FILAS",
  "REGISTROS",
];

/**
 * Canoniza una clave de JSON. A diferencia de los encabezados de Excel, las
 * claves de un API suelen venir en camelCase ("cajasDisponibles"), y canonizar
 * a secas las aplastaría ("CAJASDISPONIBLES" ya no empata con
 * "CAJAS-DISPONIBLES"). Se parte el camelCase antes de canonizar.
 */
function canonizarClave(k: string): string {
  return canonizar(k.replace(/([a-z0-9])([A-Z])/g, "$1 $2"));
}

function texto(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function numero(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const t = String(v).trim();
  if (!t || t === "-" || t === "—") return 0;
  const n = Number(t.replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Encuentra la lista de renglones dentro de la respuesta, venga como venga. */
export function extraerLista(cuerpo: unknown): Record<string, unknown>[] {
  if (Array.isArray(cuerpo)) return cuerpo as Record<string, unknown>[];

  if (cuerpo && typeof cuerpo === "object") {
    const obj = cuerpo as Record<string, unknown>;

    // Primero las envolturas conocidas, en orden de preferencia.
    for (const envoltura of ENVOLTURAS) {
      for (const [k, v] of Object.entries(obj)) {
        if (canonizarClave(k) === envoltura && Array.isArray(v)) {
          return v as Record<string, unknown>[];
        }
      }
    }

    // Si no, la primera propiedad que sea una lista de objetos.
    for (const v of Object.values(obj)) {
      if (Array.isArray(v) && v.length && typeof v[0] === "object" && v[0] !== null) {
        return v as Record<string, unknown>[];
      }
    }
  }

  throw new Error(
    "No encontré una lista de inventario en la respuesta del API. " +
      `Recibí: ${JSON.stringify(cuerpo).slice(0, 200)}`,
  );
}

export function normalizarInventario(cuerpo: unknown): InventarioNormalizado {
  const lista = extraerLista(cuerpo);
  const avisos: string[] = [];

  if (!lista.length) {
    return {
      filas: [],
      avisos: ["El API contestó bien pero la lista de inventario vino vacía."],
      almacenes: [],
      camposDetectados: {},
      camposIgnorados: [],
    };
  }

  // El primer renglón define qué campos trae el API (forma canónica -> clave real).
  const clavesApi = new Map<string, string>();
  for (const k of Object.keys(lista[0])) {
    const c = canonizarClave(k);
    if (c && !clavesApi.has(c)) clavesApi.set(c, k);
  }

  const camposDetectados: Record<string, string> = {};
  const claveDe = (campo: string): string | undefined => {
    for (const sinonimo of SINONIMOS[campo]) {
      const real = clavesApi.get(sinonimo);
      if (real != null) {
        camposDetectados[campo] = real;
        return real;
      }
    }
    return undefined;
  };

  const kAlmacen = claveDe("almacen");
  const kCodAlmacen = claveDe("codigoAlmacen");
  const kSku = claveDe("skuCaja");
  const kPedido = claveDe("pedido");
  const kModelo = claveDe("modelo");
  const kColor = claveDe("color");
  const kTalla = claveDe("talla");
  const kContenedor = claveDe("contenedor");
  const kFisicas = claveDe("cajasFisicas");
  const kApartadas = claveDe("cajasApartadas");
  const kCamino = claveDe("enCamino");
  const kDisponibles = claveDe("cajasDisponibles");
  const kParesCaja = claveDe("paresPorCaja");

  if (!kModelo && !kSku) {
    throw new Error(
      "La respuesta del API no trae ni SKU ni MODELO. Campos recibidos: " +
        [...clavesApi.values()].join(", "),
    );
  }
  if (!kDisponibles && !kFisicas) {
    throw new Error(
      "La respuesta del API no trae cajas (ni disponibles ni físicas). Campos recibidos: " +
        [...clavesApi.values()].join(", "),
    );
  }

  const reconocidas = new Set(Object.values(camposDetectados));
  const camposIgnorados = [...clavesApi.values()].filter((k) => !reconocidas.has(k));

  if (!kTalla) {
    avisos.push(
      'El API no trae campo de talla; todos los renglones se guardan como "CORRIDA" (caja mixta).',
    );
  }

  const filas: FilaExistencia[] = [];
  const almacenes = new Set<string>();
  let saltadas = 0;

  for (const r of lista) {
    const modelo = kModelo ? texto(r[kModelo]) : "";
    const pedido = kPedido ? texto(r[kPedido]) : "";
    const color = kColor ? texto(r[kColor]) : "";

    // Si no viene SKU de caja, se arma como se arma en bodega: PEDIDO-MODELO-COLOR.
    const skuCaja =
      (kSku ? texto(r[kSku]) : "") || [pedido, modelo, color].filter(Boolean).join("-");

    if (!skuCaja && !modelo) {
      saltadas++;
      continue;
    }

    const fisicas = kFisicas ? numero(r[kFisicas]) : 0;
    const apartadas = kApartadas ? numero(r[kApartadas]) : 0;
    const disponibles = kDisponibles
      ? numero(r[kDisponibles])
      : Math.max(0, fisicas - apartadas);

    const almacen = (kAlmacen ? texto(r[kAlmacen]) : "") || ALMACEN_POR_OMISION;
    almacenes.add(almacen);

    filas.push({
      almacen,
      codigoAlmacen: kCodAlmacen ? texto(r[kCodAlmacen]) : "",
      skuCaja,
      pedido,
      modelo: modelo || skuCaja,
      color,
      talla: kTalla ? normalizarTalla(r[kTalla]) || "CORRIDA" : "CORRIDA",
      contenedor: kContenedor ? texto(r[kContenedor]) : "",
      cajasFisicas: fisicas,
      cajasApartadas: apartadas,
      enCamino: kCamino ? numero(r[kCamino]) : 0,
      cajasDisponibles: disponibles,
      paresPorCaja: kParesCaja ? numero(r[kParesCaja]) : 0,
      paresDisponibles: 0,
    });
  }

  if (saltadas > 0) {
    avisos.push(`${saltadas} renglones venían sin SKU ni modelo y se saltaron.`);
  }

  // La tabla tiene llave única (almacén, SKU, talla, contenedor): si el API
  // repite un renglón hay que fusionarlo, o el upsert de Postgres truena.
  const porClave = new Map<string, FilaExistencia>();
  let duplicadas = 0;
  for (const f of filas) {
    const clave = [f.almacen, f.skuCaja, f.talla, f.contenedor].map(canonizar).join("|");
    const previa = porClave.get(clave);
    if (!previa) {
      porClave.set(clave, f);
      continue;
    }
    duplicadas++;
    previa.cajasFisicas += f.cajasFisicas;
    previa.cajasApartadas += f.cajasApartadas;
    previa.enCamino += f.enCamino;
    previa.cajasDisponibles += f.cajasDisponibles;
    previa.paresPorCaja = previa.paresPorCaja || f.paresPorCaja;
  }
  if (duplicadas > 0) {
    filas.length = 0;
    filas.push(...porClave.values());
    avisos.push(
      `${duplicadas} renglones venían repetidos (mismo almacén, SKU, talla y contenedor); se sumaron sus cajas.`,
    );
  }
  if (!kParesCaja) {
    avisos.push(
      "El API no trae pares por caja; sin ese dato las cajas mixtas no convierten a pares. Revisa los campos ignorados.",
    );
  }

  return {
    filas,
    avisos,
    almacenes: [...almacenes].sort(),
    camposDetectados,
    camposIgnorados,
  };
}

// ---------------------------------------------------------------------------
// Sincronización completa
// ---------------------------------------------------------------------------

export interface ResumenSincronizacion {
  renglones: number;
  cajasDisponibles: number;
  almacenes: string[];
  avisos: string[];
  camposDetectados: Record<string, string>;
  camposIgnorados: string[];
}

/**
 * Descarga, normaliza y guarda. Reemplaza la foto SOLO de los almacenes que
 * el API reporta: es el mismo criterio que el Excel (una foto vieja planea
 * con cajas que ya se movieron) pero sin pisar los almacenes que no vienen.
 */
export async function sincronizarInventarioIndusther(
  db: DB,
  accountId: string,
): Promise<ResumenSincronizacion> {
  const crudo = await descargarInventarioIndusther();
  const inv = normalizarInventario(crudo);

  if (!inv.filas.length) {
    throw new Error(
      "El API contestó pero no vino ningún renglón de inventario; no se tocó nada.",
    );
  }

  // Foto nueva de estos almacenes: fuera la anterior.
  const { error: errorBorrado } = await db
    .from("existencias")
    .delete()
    .eq("account_id", accountId)
    .in("almacen", inv.almacenes);
  if (errorBorrado) throw new Error(`existencias: ${errorBorrado.message}`);

  const filas = inv.filas.map((f) => ({
    account_id: accountId,
    almacen: f.almacen,
    codigo_almacen: f.codigoAlmacen,
    sku_caja: f.skuCaja,
    pedido: f.pedido,
    modelo: f.modelo,
    color: f.color,
    talla: f.talla,
    contenedor: f.contenedor || "",
    cajas_fisicas: f.cajasFisicas,
    cajas_apartadas: f.cajasApartadas,
    en_camino: f.enCamino,
    cajas_disponibles: f.cajasDisponibles,
    pares_por_caja: f.paresPorCaja,
  }));

  await upsertEnTandas(db, "existencias", filas, "account_id,almacen,sku_caja,talla,contenedor");

  // Igual que en el Excel: un almacén nuevo entra surtiendo a Full por omisión.
  const almacenes = inv.almacenes.map((a) => ({
    account_id: accountId,
    almacen: a,
    surte_full: true,
  }));
  if (almacenes.length) {
    await db
      .from("almacenes_activos")
      .upsert(almacenes, { onConflict: "account_id,almacen", ignoreDuplicates: true });
  }

  await invalidar(db, accountId, "Se sincronizó el inventario desde el API de Industher.");

  return {
    renglones: inv.filas.length,
    cajasDisponibles: inv.filas.reduce((a, f) => a + f.cajasDisponibles, 0),
    almacenes: inv.almacenes,
    avisos: inv.avisos,
    camposDetectados: inv.camposDetectados,
    camposIgnorados: inv.camposIgnorados,
  };
}
