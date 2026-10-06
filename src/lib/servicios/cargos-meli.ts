/**
 * Cargos facturados por Mercado Libre en el periodo (API de facturación).
 *
 * Lo que MELI cobra por VENDER (comisión y envío) ya viene descontado en el
 * neto que deposita Mercado Pago. Lo que cobra por TENER el producto en Full
 * —almacenamiento, almacenamiento prolongado, retiros de stock— no pasa por
 * la venta: se factura aparte en el periodo y se descuenta del saldo. Esos
 * son los "gastos de Full" del corte, y salen de aquí.
 *
 * La lectura es tolerante a propósito: el API de facturación cambia de forma
 * según el sitio y la versión, así que se prueban varias rutas y se buscan
 * los campos por nombre (detail_amount / amount, detail_type / type…). Cada
 * renglón se guarda con su crudo en `meli_cargos` para poder reclasificarlo
 * sin volver a pedirlo. Si no se puede leer, el corte lo dice y los gastos
 * de Full se capturan a mano en gastos_meli.
 */
import { MeliError, type MeliClient } from "../meli/client";
import { traerTodo, type DB } from "../datos/repos";
import { clienteDeCuenta } from "./webhooks";
import { invalidarCortesDePeriodos } from "./corte-invalidar";

export type ClaseCargo = "full" | "publicidad" | "venta" | "pago" | "bonificacion" | "otro" | "resumen";

export interface CargoMeli {
  detalleId: string;
  periodo: string;
  fecha: string | null;
  tipo: string | null;
  subtipo: string | null;
  descripcion: string | null;
  monto: number;
  clase: ClaseCargo;
  /** la orden a la que MELI amarra el cargo, si la trae */
  ordenId?: string | null;
  /** el renglón tal cual lo mandó MELI, para reclasificar sin volver a pedir */
  crudo?: unknown;
}

/** Busca en el renglón un id de orden/operación de MELI (16 dígitos o más). */
export function ordenDeCargo(r: unknown): string | null {
  let hallado: string | null = null;
  const recorrer = (nodo: unknown, profundidad: number) => {
    if (hallado || nodo == null || profundidad > 5) return;
    if (Array.isArray(nodo)) {
      for (const x of nodo) recorrer(x, profundidad + 1);
      return;
    }
    if (typeof nodo !== "object") return;
    for (const [k, v] of Object.entries(nodo as Record<string, unknown>)) {
      if (/order|operation|sale_id|pack_id/i.test(k) && (typeof v === "number" || typeof v === "string") && /^\d{10,}$/.test(String(v))) {
        hallado = String(v);
        return;
      }
      if (v && typeof v === "object") recorrer(v, profundidad + 1);
    }
  };
  recorrer(r, 0);
  return hallado;
}

/**
 * Clasificación de un cargo facturado, por los CÓDIGOS de MELI México
 * (verificados en la factura de septiembre 2026) y, de respaldo, por texto:
 *  - full: CFWA almacenamiento Full, CFCB colecta Full, CFPB incumplimiento
 *    en Envíos Full, retiros… (el gasto de Full del corte)
 *  - publicidad: PADS, Product Ads (ya se cuenta por el API de publicidad;
 *    de respaldo si el API falla)
 *  - venta: CV cargo por venta, CFF/CDS cargo por envíos (ya descontados del
 *    pago: van dentro del neto)
 *  - bonificacion: BONUS/BV/BFF, anulaciones de cargos (no se suman: las de
 *    órdenes canceladas ya quedaron fuera con la orden)
 *  - pago: pagos y abonos (no son gasto)
 *  - otro: lo demás (cargo por devolución, Mi página…): se enseña y se resta
 */
export function clasificarCargo(texto: string): ClaseCargo {
  const t = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const codigo = (c: string) => new RegExp(`(^|[^a-z])${c}([^a-z]|$)`).test(t);
  if (codigo("cfwa") || codigo("cfcb") || codigo("cfpb")) return "full";
  if (/almacen|storage|prolongad|retiro|fulfillment|servicio de full|servicio full|colecta full|incumplimiento en envios full|deposito/.test(t)) return "full";
  if (codigo("pads") || /publicidad|product ads|anuncio|advertising/.test(t)) return "publicidad";
  if (codigo("bonus") || /anulacion|bonificacion/.test(t)) return "bonificacion";
  if (codigo("cv") || codigo("cff") || codigo("cds") || /comision|tarifa de venta|cargo por venta|costo de envio|costo por envio|cargo por envio|envio|flete|shipping/.test(t)) return "venta";
  if (/\bpago\b|abono|payment|credito aplicado/.test(t)) return "pago";
  return "otro";
}

const numero = (x: unknown): number | null => {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x))) return Number(x);
  return null;
};
const texto = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);
/** Un identificador puede venir como número o como texto. */
const ident = (x: unknown): string | null =>
  typeof x === "number" && Number.isFinite(x) ? String(x) : texto(x);

/** Saca los renglones de una página del API, sea cual sea su forma. */
export function extraerCargos(crudo: unknown, periodo: string): CargoMeli[] {
  const raiz: any = crudo && typeof crudo === "object" ? crudo : {};
  const lista: any[] = Array.isArray(raiz.results)
    ? raiz.results
    : Array.isArray(raiz.details)
      ? raiz.details
      : Array.isArray(raiz)
        ? raiz
        : [];
  const salida: CargoMeli[] = [];
  lista.forEach((r, i) => {
    const c: any = r?.charge_info && typeof r.charge_info === "object" ? r.charge_info : r ?? {};
    const monto = numero(c.detail_amount) ?? numero(c.amount) ?? numero(r?.amount) ?? numero(r?.total_amount);
    if (monto == null) return;
    const tipo = texto(c.detail_type) ?? texto(c.type) ?? texto(r?.type) ?? texto(c.concept);
    const subtipo = texto(c.detail_sub_type) ?? texto(c.sub_type) ?? null;
    const descripcion = texto(c.transaction_detail) ?? texto(c.description) ?? texto(r?.description) ?? null;
    const fechaCruda = texto(c.creation_date_time) ?? texto(c.date_created) ?? texto(r?.date_created) ?? texto(c.date);
    const fecha = fechaCruda && /^\d{4}-\d{2}-\d{2}/.test(fechaCruda) ? fechaCruda.slice(0, 10) : null;
    const id =
      ident(c.detail_id) ??
      ident(c.id) ??
      ident(r?.detail_id) ??
      ident(r?.id) ??
      `${periodo}:${i}:${tipo ?? ""}:${monto}`;
    salida.push({
      detalleId: String(id),
      periodo,
      fecha,
      tipo,
      subtipo,
      descripcion,
      monto,
      clase: clasificarCargo([tipo, subtipo, descripcion].filter(Boolean).join(" ")),
      ordenId: ordenDeCargo(r),
      crudo: r,
    });
  });
  return salida;
}

async function conRutas<T>(rutas: string[], pedir: (ruta: string) => Promise<T>): Promise<T> {
  let ultimo: MeliError | null = null;
  for (const ruta of rutas) {
    try {
      return await pedir(ruta);
    } catch (err) {
      if (err instanceof MeliError && (err.status === 404 || err.status === 400)) {
        ultimo = err;
        continue;
      }
      throw err;
    }
  }
  throw ultimo ?? new MeliError("Sin ruta que responda.", 404, null, rutas[0]);
}

/**
 * MELI le pone su propia clave a cada periodo de facturación (no acepta
 * "2026-09": contesta 422 "Invalid format for value"). La clave sale de la
 * lista de periodos: se busca el que EMPIEZA en el mes pedido, o el que
 * trae el mes en su clave. Devuelve también las claves que vinieron, para
 * que el error diga qué formato usa MELI si ninguna amarra.
 */
export function claveDePeriodo(crudo: unknown, periodo: string): { clave: string | null; claves: string[] } {
  const raiz: any = crudo && typeof crudo === "object" ? crudo : {};
  const lista: any[] = Array.isArray(raiz.results) ? raiz.results : Array.isArray(raiz.periods) ? raiz.periods : Array.isArray(raiz) ? raiz : [];
  const claves: string[] = [];
  let clave: string | null = null;
  for (const r of lista) {
    const per: any = r?.period && typeof r.period === "object" ? r.period : r ?? {};
    const k = per.key ?? r?.key ?? per.period_key ?? per.id;
    if (k == null) continue;
    const key = String(k);
    claves.push(key);
    const desde = String(per.date_from ?? per.from ?? per.start_date ?? r?.date_from ?? "");
    if (!clave && (desde.startsWith(periodo) || key.startsWith(periodo) || key.includes(periodo))) clave = key;
  }
  return { clave, claves };
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** La clave del periodo en MELI (2026-09 → "2026-09-01"), de su lista de periodos. */
export async function resolverClavePeriodo(cliente: MeliClient, periodo: string): Promise<string> {
  let clave: string | null = null;
  let claves: string[] = [];
  let errorPeriodos: string | null = null;
  let crudoPeriodos: unknown = null;
  try {
    // MELI topa `limit` en 12: un año de periodos por llamada.
    crudoPeriodos = await conRutas(
      ["/billing/integration/monthly/periods", "/billing/integration/periods"],
      (ruta) => cliente.get<unknown>(ruta, { group: "ML", document_type: "BILL", limit: 12, offset: 0 }),
    );
    ({ clave, claves } = claveDePeriodo(crudoPeriodos, periodo));
  } catch (err) {
    errorPeriodos = (err as Error).message;
  }
  if (!clave) {
    const muestra = claves.length ? ` Periodos que MELI lista: ${claves.slice(0, 12).join(", ")}.` : "";
    const detalle = errorPeriodos ? ` La lista de periodos falló: ${errorPeriodos}.` : "";
    const crudoTexto = crudoPeriodos ? ` Respuesta de MELI: ${JSON.stringify(crudoPeriodos).slice(0, 600)}` : "";
    throw new MeliError(
      `MELI no lista un periodo de facturación para ${periodo}.${muestra}${detalle}${crudoTexto}`,
      404,
      { claves },
      "/billing/integration/monthly/periods",
    );
  }
  return clave;
}

/**
 * El resumen del periodo, por si MELI ya trae ahí los totales por tipo de
 * cargo. Lo que se reconozca como Full/publicidad/venta/pago se clasifica;
 * lo demás entra como "resumen": se enseña pero NUNCA se resta (un total
 * global tomado como gasto duplicaría todo el mes).
 */
export function extraerResumen(crudo: unknown, periodo: string): CargoMeli[] {
  const salida: CargoMeli[] = [];
  const recorrer = (nodo: unknown, etiqueta: string, profundidad: number) => {
    if (profundidad > 5 || nodo == null) return;
    if (Array.isArray(nodo)) {
      nodo.forEach((x, i) => recorrer(x, `${etiqueta}[${i}]`, profundidad + 1));
      return;
    }
    if (typeof nodo !== "object") return;
    const o = nodo as Record<string, unknown>;
    const monto = numero(o.amount) ?? numero(o.total_amount) ?? numero(o.detail_amount) ?? numero(o.value);
    const nombre = texto(o.detail_type) ?? texto(o.type) ?? texto(o.description) ?? texto(o.name) ?? texto(o.concept) ?? etiqueta;
    if (monto != null) {
      const clase = clasificarCargo(nombre);
      salida.push({
        detalleId: `resumen:${periodo}:${nombre}`.slice(0, 200),
        periodo,
        fecha: null,
        tipo: nombre,
        subtipo: "resumen",
        descripcion: texto(o.description) ?? null,
        monto,
        clase: clase === "otro" ? "resumen" : clase,
      });
    }
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === "object") recorrer(v, k, profundidad + 1);
      else if (typeof v === "number" && /amount|total|charge|fee|cost|bonus|discount/i.test(k) && !["amount", "total_amount", "detail_amount", "value"].includes(k)) {
        const clase = clasificarCargo(k);
        salida.push({
          detalleId: `resumen:${periodo}:${etiqueta}.${k}`.slice(0, 200),
          periodo,
          fecha: null,
          tipo: `${etiqueta}.${k}`,
          subtipo: "resumen",
          descripcion: null,
          monto: v,
          clase: clase === "otro" ? "resumen" : clase,
        });
      }
    }
  };
  recorrer(crudo, "resumen", 0);
  return salida;
}

/**
 * Cómo se parte la lectura cuando el periodo pasa de 10 mil renglones (MELI
 * topa offset + limit en 10_000): por DÍA (lo completo) o, si MELI no acepta
 * filtro de fecha, por SUBTIPO de cargo (solo los tipos que interesan).
 */
export type ParticionCargos =
  | { modo: "ninguna" }
  | { modo: "dia"; param: "date_from" | "from" | "date_created_from" | "creation_date_from" }
  | { modo: "subtipo"; param: string };

export interface ProgresoCargos {
  periodo: string;
  clave: string | null;
  /** renglones leídos del periodo (acumulado) */
  offset: number;
  total: number | null;
  completo: boolean;
  actualizadoEn: string | null;
  particion?: ParticionCargos | null;
  /** el día o el subtipo que se está leyendo, y el offset dentro de él */
  cursor?: string | null;
  offsetParticion?: number;
  /**
   * Filtros de partición ya sondeados sin éxito (`modo:param`): el sondeo
   * cuesta una llamada de cuota por candidato y un latido no alcanza para
   * los ocho, así que lo probado se recuerda y el siguiente latido sigue.
   */
  sondeados?: string[];
  /**
   * Cómo se está leyendo: `id` = por `from_id`/`last_id` (la paginación que
   * MELI recomienda, sin tope), `offset` = la vieja, topada en 10 mil (solo
   * si MELI rechaza la de id). null = todavía no se sabe.
   */
  modo?: "id" | "offset" | null;
  /** el `last_id` de la última página leída por id; desde ahí se retoma */
  desdeId?: string | number | null;
  /**
   * Cómo vino la última página por id (renglones, `last_id`, `total` y las
   * claves del cuerpo): cuando MELI corta la lectura antes de tiempo, la
   * bitácora dice con qué contestó, sin tener que volver a pedirlo.
   */
  ultimaPagina?: UltimaPaginaCargos | null;
  /** veces que el periodo se releyó por haber quedado corto contra el total de MELI */
  relecturas?: number;
}

export interface UltimaPaginaCargos {
  renglones: number;
  lastId: string | number | null;
  total: number | null;
  claves: string[];
}

/** Los subtipos de la factura que el corte necesita cuando hay que leer por tipo. */
export const SUBTIPOS_INTERES = ["CFWA", "CFCB", "CFPB", "PADS", "CDSD", "CESM", "CDS", "BDS", "BFF", "BV", "CFF", "CV"];

/** Los días del periodo YYYY-MM. */
export function diasDelPeriodo(periodo: string): string[] {
  const [a, m] = periodo.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Array.from({ length: ultimo }, (_, i) => `${periodo}-${String(i + 1).padStart(2, "0")}`);
}

/** Los parámetros de consulta de una partición en un cursor dado. */
export function paramsDeParticion(part: ParticionCargos, cursor: string): Record<string, string> {
  if (part.modo === "ninguna") return {};
  if (part.modo === "subtipo") return { [part.param]: cursor };
  switch (part.param) {
    case "date_from":
      return { date_from: cursor, date_to: cursor };
    case "from":
      return { from: cursor, to: cursor };
    case "date_created_from":
      return { date_created_from: cursor, date_created_to: cursor };
    case "creation_date_from":
      return { creation_date_from: `${cursor}T00:00:00.000-06:00`, creation_date_to: `${cursor}T23:59:59.999-06:00` };
  }
}

/** Los cursores (días o subtipos) de una partición, en orden. */
export function cursoresDe(part: ParticionCargos, periodo: string): string[] {
  if (part.modo === "dia") return diasDelPeriodo(periodo);
  if (part.modo === "subtipo") return SUBTIPOS_INTERES;
  return [""];
}

/**
 * Dónde vive cada cosa: la cuenta de calzado guarda en meli_cargos y su
 * avance en sync_log; la de fundas en yz_cargos y yz_sync_log. La lectura
 * del API es la misma.
 */
export interface AlmacenCargos {
  cliente: MeliClient;
  tabla: string;
  leerProgreso(periodo: string): Promise<ProgresoCargos>;
  guardarProgreso(p: ProgresoCargos, extra?: Record<string, unknown>): Promise<void>;
  /** periodos con lectura a medias (offset > 0 y no completo), el más reciente primero */
  pendientes(): Promise<string[]>;
  /** la espera entre llamadas (las pruebas la vuelven instantánea) */
  dormir?: (ms: number) => Promise<void>;
}

/** El avance de la lectura de detalles del periodo (bitácora en sync_log). */
export async function progresoCargos(db: DB, accountId: string, periodo: string): Promise<ProgresoCargos> {
  const { data } = await db
    .from("sync_log")
    .select("detalle, fin")
    .eq("account_id", accountId)
    .eq("tarea", "cargos_meli")
    .eq("detalle->>periodo", periodo)
    .order("inicio", { ascending: false })
    .limit(1)
    .maybeSingle();
  return progresoDeDetalle(periodo, data?.detalle, data?.fin ?? null);
}

export function progresoDeDetalle(periodo: string, detalle: unknown, actualizadoEn: string | null): ProgresoCargos {
  const d: any = detalle ?? {};
  return {
    periodo,
    clave: typeof d.clave === "string" ? d.clave : null,
    offset: Number(d.offset) || 0,
    total: d.total == null ? null : Number(d.total),
    completo: Boolean(d.completo),
    actualizadoEn,
    particion: d.particion && typeof d.particion === "object" ? (d.particion as ParticionCargos) : null,
    cursor: typeof d.cursor === "string" ? d.cursor : null,
    offsetParticion: Number(d.offsetParticion) || 0,
    sondeados: Array.isArray(d.sondeados) ? d.sondeados.filter((s: unknown) => typeof s === "string") : [],
    modo: d.modo === "id" || d.modo === "offset" ? d.modo : null,
    desdeId: typeof d.desdeId === "string" || typeof d.desdeId === "number" ? d.desdeId : null,
    ultimaPagina: d.ultimaPagina && typeof d.ultimaPagina === "object" ? (d.ultimaPagina as UltimaPaginaCargos) : null,
    relecturas: Number(d.relecturas) || 0,
  };
}

/** El almacén de la cuenta de calzado (meli_cargos + sync_log). */
export async function almacenMeli(admin: DB, accountId: string): Promise<AlmacenCargos | null> {
  const cliente = await clienteDeCuenta(admin, accountId);
  if (!cliente) return null;
  return {
    cliente,
    tabla: "meli_cargos",
    leerProgreso: (periodo) => progresoCargos(admin, accountId, periodo),
    guardarProgreso: async (p, extra) => {
      await admin.from("sync_log").insert({
        account_id: accountId,
        tarea: "cargos_meli",
        estado: "ok",
        fin: new Date().toISOString(),
        detalle: { periodo: p.periodo, clave: p.clave, offset: p.offset, total: p.total, completo: p.completo, particion: p.particion ?? null, cursor: p.cursor ?? null, offsetParticion: p.offsetParticion ?? 0, sondeados: p.sondeados ?? [], modo: p.modo ?? null, desdeId: p.desdeId ?? null, ultimaPagina: p.ultimaPagina ?? null, relecturas: p.relecturas ?? 0, ...extra },
      });
    },
    pendientes: async () => {
      const { data } = await admin
        .from("sync_log")
        .select("detalle")
        .eq("account_id", accountId)
        .eq("tarea", "cargos_meli")
        .order("inicio", { ascending: false })
        .limit(12);
      return periodosPendientes((data ?? []).map((f: any) => f.detalle));
    },
  };
}

/** De la bitácora (más reciente primero), los periodos cuya ÚLTIMA huella quedó a medias. */
export function periodosPendientes(detalles: unknown[]): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const d of detalles as any[]) {
    const periodo = typeof d?.periodo === "string" ? d.periodo : null;
    if (!periodo || vistos.has(periodo)) continue;
    vistos.add(periodo);
    if (d.completo) continue;
    if (!(Number(d.offset) > 0)) continue; // nunca arrancó bien: no insistir solo
    salida.push(periodo);
  }
  return salida;
}

async function guardarCargos(admin: DB, accountId: string, tabla: string, periodo: string, cargos: CargoMeli[]): Promise<void> {
  if (!cargos.length) return;
  const filas = cargos.map((c) => ({
    account_id: accountId,
    periodo,
    detalle_id: c.detalleId,
    fecha: c.fecha,
    tipo: c.tipo,
    subtipo: c.subtipo,
    descripcion: c.descripcion,
    monto: c.monto,
    clase: c.clase,
    orden_id: c.ordenId ?? null,
    crudo: c.crudo ?? null,
    leido_en: new Date().toISOString(),
  }));
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await admin.from(tabla).upsert(filas.slice(i, i + 500), { onConflict: "account_id,detalle_id" });
    if (error) throw new Error(`No se pudieron guardar los cargos: ${error.message}`);
  }
}

export interface ResultadoCargos {
  /** el periodo leído (para invalidar su corte) */
  periodo?: string;
  /** renglones guardados del periodo (acumulado) */
  cargos: number;
  /** suma de los cargos de clase full guardados */
  full: number;
  /** renglones que MELI declara para el periodo; null = no lo dijo */
  total: number | null;
  completo: boolean;
  error: string | null;
}

/** Segundos entre páginas: el endpoint de detalles da 5 llamadas por minuto. */
const PASO_CUOTA_MS = 12_500;
const LIMITE_DETALLES = 150;
/** MELI: "The sum of the offset and the limit cannot exceed 10_000". */
const TOPE_OFFSET = 10_000;

const totalDe = (crudo: any): number | null =>
  typeof crudo?.total === "number" ? crudo.total : typeof crudo?.paging?.total === "number" ? crudo.paging.total : null;

/** Los filtros que se prueban para partir un periodo grande, en orden. */
export const CANDIDATOS_PARTICION: Exclude<ParticionCargos, { modo: "ninguna" }>[] = [
  { modo: "dia", param: "date_from" },
  { modo: "dia", param: "from" },
  { modo: "dia", param: "date_created_from" },
  { modo: "dia", param: "creation_date_from" },
  { modo: "subtipo", param: "detail_sub_type" },
  { modo: "subtipo", param: "sub_type" },
  { modo: "subtipo", param: "charge_sub_type" },
  { modo: "subtipo", param: "detail_type" },
];

const nombreDeCandidato = (c: Exclude<ParticionCargos, { modo: "ninguna" }>): string => `${c.modo}:${c.param}`;

export type ResultadoSondeo =
  | { tipo: "encontrada"; particion: Exclude<ParticionCargos, { modo: "ninguna" }> }
  /** ningún filtro bajó el total: MELI no deja partir el periodo */
  | { tipo: "agotado" }
  /** se acabó el plazo a media sonda; `sondeados` trae lo ya descartado */
  | { tipo: "sin_tiempo"; sondeados: string[] };

/**
 * Averigua qué filtro acepta MELI para partir un periodo grande: se pide UN
 * renglón con cada candidato y se acepta el primero cuyo total baje del
 * total del periodo (un parámetro desconocido lo ignora o contesta 4xx).
 * Primero por día (lectura completa); si no, por subtipo de cargo.
 *
 * REANUDABLE: cada candidato cuesta una llamada de la cuota (5 por minuto)
 * y un latido no alcanza para los ocho; lo descartado se devuelve en
 * `sondeados` para que el siguiente latido siga donde se quedó. Hasta el
 * 6-oct-2026 quedarse sin tiempo se confundía con «ningún filtro sirve».
 */
export async function sondearParticion(
  cliente: MeliClient,
  clave: string,
  periodo: string,
  totalPeriodo: number,
  finMs: number,
  opts: { sondeados?: string[]; dormir?: (ms: number) => Promise<void> } = {},
): Promise<ResultadoSondeo> {
  const espera = opts.dormir ?? dormir;
  const ruta = `/billing/integration/periods/key/${encodeURIComponent(clave)}/group/ML/details`;
  const dia = diasDelPeriodo(periodo)[0];
  const sondeados = [...(opts.sondeados ?? [])];
  const pendientes = CANDIDATOS_PARTICION.filter((c) => !sondeados.includes(nombreDeCandidato(c)));
  let i = 0;
  while (i < pendientes.length) {
    const cand = pendientes[i];
    if (Date.now() + PASO_CUOTA_MS > finMs) return { tipo: "sin_tiempo", sondeados };
    const cursor = cand.modo === "dia" ? dia : "CFWA";
    try {
      const crudo = await cliente.get<unknown>(ruta, { document_type: "BILL", limit: 1, offset: 0, ...paramsDeParticion(cand, cursor) }, { reintentos: 0 });
      const t = totalDe(crudo);
      if (t != null && t < totalPeriodo) return { tipo: "encontrada", particion: cand };
    } catch (err) {
      const e = err as MeliError;
      if (e instanceof MeliError && e.status === 429) {
        // Cuota agotada: el MISMO candidato se vuelve a preguntar tras un minuto.
        if (Date.now() + 62_000 > finMs) return { tipo: "sin_tiempo", sondeados };
        await espera(62_000);
        continue;
      }
      // 400/422: parámetro desconocido, siguiente candidato.
    }
    sondeados.push(nombreDeCandidato(cand));
    i++;
    await espera(PASO_CUOTA_MS);
  }
  return { tipo: "agotado" };
}

/**
 * Lee (o sigue leyendo) los cargos del periodo hasta agotar `finMs`.
 *
 * El endpoint de detalles tiene cuota de 5 llamadas por minuto, topa
 * offset + limit en 10 mil y un mes trae decenas de miles de renglones
 * (comisión y envío de cada orden), así que la lectura es REANUDABLE y,
 * cuando el periodo pasa de 10 mil, PARTIDA por día o por subtipo. El
 * avance queda en la bitácora del almacén y el latido o el cron la
 * continúan hasta completarla. Al empezar de cero se borra lo del periodo;
 * las páginas se guardan conforme llegan.
 */
export async function sincronizarCargosCon(
  admin: DB,
  accountId: string,
  periodo: string,
  almacen: AlmacenCargos,
  finMs = Date.now() + 100_000,
): Promise<ResultadoCargos> {
  const { cliente, tabla } = almacen;
  const totalesGuardados = async (): Promise<{ cargos: number; full: number }> => {
    const filas = await cargosGuardados(admin, accountId, periodo, tabla);
    return { cargos: filas.length, full: filas.filter((c) => c.clase === "full").reduce((a, c) => a + c.monto, 0) };
  };

  const progreso = await almacen.leerProgreso(periodo);
  // Releer un periodo que ya se dio por completo (a mano, o porque se leyó
  // con el mes todavía abierto): se vuelve a empezar SIN tirar lo guardado,
  // que el upsert por detalle_id actualiza; así el corte no se queda en
  // cero mientras dura la relectura.
  const relectura = progreso.completo;
  if (progreso.completo) {
    // Releer por haber quedado corto se cuenta: si MELI vuelve a cortar la
    // lectura en el mismo lugar, insistir cada latido no cambia nada.
    if (necesitaRelecturaPorTotal(progreso)) progreso.relecturas = (progreso.relecturas ?? 0) + 1;
    progreso.completo = false;
    progreso.offset = 0;
    progreso.total = null;
    progreso.particion = null;
    progreso.cursor = null;
    progreso.offsetParticion = 0;
    progreso.sondeados = [];
    progreso.modo = null;
    progreso.desdeId = null;
    progreso.ultimaPagina = null;
  }

  try {
    if (!progreso.clave) progreso.clave = await resolverClavePeriodo(cliente, periodo);
  } catch (err) {
    return { periodo, ...(await totalesGuardados()), total: null, completo: false, error: (err as Error).message };
  }
  const clave = progreso.clave;
  const ruta = `/billing/integration/periods/key/${encodeURIComponent(clave)}/group/ML/details`;

  // Al arrancar de cero: fuera lo viejo del periodo, y el resumen si existe.
  if (progreso.offset === 0 && !progreso.particion) {
    if (!relectura) await admin.from(tabla).delete().eq("account_id", accountId).eq("periodo", periodo);
    try {
      const crudo = await cliente.get<unknown>(
        `/billing/integration/periods/key/${encodeURIComponent(clave)}/group/ML/summary`,
        { document_type: "BILL" },
        { reintentos: 0 },
      );
      await guardarCargos(admin, accountId, tabla, periodo, extraerResumen(crudo, periodo));
      await almacen.guardarProgreso(progreso, { resumen: JSON.stringify(crudo).slice(0, 2000) });
    } catch (err) {
      await almacen.guardarProgreso(progreso, { resumenError: (err as Error).message.slice(0, 300) });
    }
  }

  let error: string | null = null;
  let paginas = 0;
  const vistos = new Set<string>();
  const avisos: string[] = [];
  const espera = almacen.dormir ?? dormir;

  // PRIMERO por id (`from_id`/`last_id`), que es la paginación que MELI
  // documenta para este endpoint y no tiene tope; solo si MELI la rechaza
  // se cae a la vieja por offset (topada en 10 mil, partida por día).
  if (progreso.modo !== "offset" && (!progreso.particion || progreso.particion.modo === "ninguna")) {
    const porId = await leerPorId(admin, accountId, periodo, almacen, ruta, progreso, finMs, { vistos, avisos, espera });
    paginas += porId.paginas;
    if (porId.estado !== "rechazado") {
      if (porId.estado === "completo") {
        progreso.completo = true;
        if (progreso.total != null && progreso.total > 0 && progreso.offset < progreso.total * 0.95) {
          const u = progreso.ultimaPagina;
          avisos.push(
            `MELI dio por terminada la lectura con ${progreso.offset.toLocaleString("es-MX")} de ${progreso.total.toLocaleString("es-MX")} renglones` +
              (u ? ` (última página: ${u.renglones} renglones, last_id ${u.lastId ?? "ninguno"}, total ${u.total ?? "ninguno"}).` : "."),
          );
        }
      }
      error = porId.error;
      await almacen.guardarProgreso(progreso, { paginas, error, avisos });
      const t = await totalesGuardados();
      return { periodo, ...t, total: progreso.total, completo: progreso.completo, error };
    }
    progreso.modo = "offset";
    avisos.push(`MELI no aceptó la paginación por id (${porId.error ?? "sin detalle"}): se lee por offset.`);
  }

  let particion: ParticionCargos = progreso.particion ?? { modo: "ninguna" };
  let cursores = cursoresDe(particion, periodo);
  let iCursor = Math.max(0, progreso.cursor ? cursores.indexOf(progreso.cursor) : 0);
  // Sin partición, el offset del periodo ES el de la lectura: así una
  // lectura vieja que se quedó en 9,900 no vuelve a empezar de cero.
  let offsetParticion = progreso.offsetParticion || (particion.modo === "ninguna" ? progreso.offset : 0);

  const guardar = async () => {
    progreso.particion = particion;
    progreso.cursor = cursores[iCursor] ?? null;
    progreso.offsetParticion = offsetParticion;
    await almacen.guardarProgreso(progreso, { paginas, error, avisos });
  };

  while (Date.now() < finMs) {
    if (iCursor >= cursores.length) {
      progreso.completo = true;
      break;
    }
    const cursor = cursores[iCursor];

    // El tope de MELI se revisa ANTES de pedir: con el offset en 9,900 la
    // siguiente página pasa de 10 mil y MELI contesta 422. Hasta el
    // 6-oct-2026 el tope solo se miraba después de una página buena, así
    // que agosto 2026 (74,059 renglones) se quedó en 9,900 contestando 422
    // en cada latido, y como siempre estaba «pendiente», mayo, junio y
    // julio nunca empezaron.
    if (offsetParticion + LIMITE_DETALLES > TOPE_OFFSET) {
      if (particion.modo === "ninguna") {
        // El periodo pasa de 10 mil: hay que partirlo.
        const sondeo = await sondearParticion(cliente, clave, periodo, progreso.total ?? TOPE_OFFSET + 1, finMs, {
          sondeados: progreso.sondeados,
          dormir: espera,
        });
        if (sondeo.tipo === "sin_tiempo") {
          progreso.sondeados = sondeo.sondeados;
          error = `El periodo pasa de 10 mil renglones; se está buscando cómo partirlo (${sondeo.sondeados.length} de ${CANDIDATOS_PARTICION.length} filtros descartados). Sigue en el fondo.`;
          break;
        }
        if (sondeo.tipo === "agotado") {
          error = "El periodo pasa de 10 mil renglones y MELI no aceptó ningún filtro para partirlo: se leyeron los primeros 10 mil.";
          progreso.completo = true;
          break;
        }
        particion = sondeo.particion;
        cursores = cursoresDe(particion, periodo);
        iCursor = 0;
        offsetParticion = 0;
        avisos.push(`Periodo partido por ${particion.modo} (${particion.param}).`);
        await guardar();
        continue;
      }
      avisos.push(`${cursor} pasa de 10 mil renglones: se leyeron los primeros 10 mil.`);
      iCursor++;
      offsetParticion = 0;
      continue;
    }

    let crudo: any;
    try {
      crudo = await cliente.get<unknown>(
        ruta,
        { document_type: "BILL", limit: LIMITE_DETALLES, offset: offsetParticion, ...paramsDeParticion(particion, cursor) },
        { reintentos: 0 },
      );
    } catch (err) {
      const e = err as MeliError;
      if (e instanceof MeliError && e.status === 429) {
        // Cuota agotada: si cabe un minuto de espera, se espera; si no, el
        // fondo retoma donde se quedó.
        if (Date.now() + 62_000 < finMs) {
          await espera(62_000);
          continue;
        }
        error = "MELI limita este endpoint a 5 llamadas por minuto: la lectura sigue sola en segundo plano.";
        break;
      }
      error = e.message;
      break;
    }
    paginas++;
    const lote = extraerCargos(crudo, periodo).filter((c) => !vistos.has(c.detalleId) && vistos.add(c.detalleId));
    await guardarCargos(admin, accountId, tabla, periodo, lote);
    progreso.offset += lote.length;
    offsetParticion += LIMITE_DETALLES;
    const totalAqui = totalDe(crudo);
    if (particion.modo === "ninguna" && totalAqui != null) progreso.total = totalAqui;

    // ¿Se acabó este cursor? (Si no, y la siguiente página pasa del tope,
    // la vuelta de arriba lo parte o salta de cursor.)
    const agotado = lote.length < LIMITE_DETALLES || (totalAqui != null && offsetParticion >= totalAqui);
    if (agotado) {
      iCursor++;
      offsetParticion = 0;
    }
    if (Date.now() + PASO_CUOTA_MS >= finMs) break;
    await espera(PASO_CUOTA_MS);
  }
  if (iCursor >= cursores.length && !error) progreso.completo = true;
  await guardar();
  const t = await totalesGuardados();
  return { ...t, total: progreso.total, completo: progreso.completo, error };
}

/** Renglones por página en la lectura por id: el máximo que MELI documenta. */
export const LIMITE_POR_ID = 1000;

/** El `last_id` de una página de detalles, o null si MELI no lo manda. */
export function ultimoIdDe(crudo: unknown): string | number | null {
  const r: any = crudo ?? {};
  for (const v of [r.last_id, r.paging?.last_id, r.lastId]) {
    if (typeof v === "number" || (typeof v === "string" && v !== "")) return v;
  }
  return null;
}

/** El mayor `detail_id` numérico de la página, o null si ninguno es número. */
export function mayorIdDe(cargos: Pick<CargoMeli, "detalleId">[]): number | null {
  let mayor: number | null = null;
  for (const c of cargos) {
    if (!/^\d+$/.test(c.detalleId)) continue;
    const n = Number(c.detalleId);
    if (Number.isSafeInteger(n) && (mayor == null || n > mayor)) mayor = n;
  }
  return mayor;
}

/** ¿El cursor nuevo va DESPUÉS del anterior? (ids numéricos se comparan como números) */
export function avanza(anterior: string | number, nuevo: string | number): boolean {
  const a = String(anterior);
  const n = String(nuevo);
  if (/^\d+$/.test(a) && /^\d+$/.test(n)) return BigInt(n) > BigInt(a);
  return n !== a;
}

/**
 * Lee el periodo por id: `from_id` = el `last_id` de la página anterior,
 * `limit` 1000, orden por ID ascendente (la paginación que MELI recomienda;
 * la de offset topa en 10 mil y agosto 2026 trae 74 mil renglones).
 * Reanudable: `progreso.desdeId` guarda desde dónde seguir.
 *
 * `rechazado` = MELI no entendió la paginación por id (4xx en la primera
 * página, o una página llena sin `last_id`): el que llama se cae a la
 * lectura por offset. Lo ya guardado se queda (upsert por detalle_id).
 */
async function leerPorId(
  admin: DB,
  accountId: string,
  periodo: string,
  almacen: AlmacenCargos,
  ruta: string,
  progreso: ProgresoCargos,
  finMs: number,
  ctx: { vistos: Set<string>; avisos: string[]; espera: (ms: number) => Promise<void> },
): Promise<{ estado: "completo" | "sin_plazo" | "rechazado"; paginas: number; error: string | null }> {
  const { cliente, tabla } = almacen;
  let paginas = 0;
  let desdeId: string | number = progreso.desdeId ?? 0;
  const offsetAntes = progreso.offset;
  if (progreso.desdeId == null) {
    // Arranque por id: el contador de renglones vuelve a cero (lo que se
    // haya leído por offset se vuelve a leer y el upsert lo deja igual).
    progreso.offset = 0;
  }
  const rechazado = (motivo: string) => {
    progreso.offset = offsetAntes;
    return { estado: "rechazado" as const, paginas, error: motivo };
  };
  while (Date.now() < finMs) {
    let crudo: any;
    try {
      crudo = await cliente.get<unknown>(
        ruta,
        { document_type: "BILL", limit: LIMITE_POR_ID, from_id: desdeId, sort_by: "ID", order_by: "ASC" },
        { reintentos: 0 },
      );
    } catch (err) {
      const e = err as MeliError;
      if (e instanceof MeliError && e.status === 429) {
        if (Date.now() + 62_000 < finMs) {
          await ctx.espera(62_000);
          continue;
        }
        return { estado: "sin_plazo", paginas, error: "MELI limita este endpoint a 5 llamadas por minuto: la lectura sigue sola en segundo plano." };
      }
      if (e instanceof MeliError && (e.status === 400 || e.status === 422) && progreso.modo !== "id") {
        return rechazado(e.message.slice(0, 300));
      }
      return { estado: "sin_plazo", paginas, error: e.message };
    }
    const resultados: unknown[] = Array.isArray(crudo?.results) ? crudo.results : Array.isArray(crudo) ? crudo : [];
    const lastId = ultimoIdDe(crudo);
    if (progreso.modo !== "id" && lastId == null && resultados.length >= LIMITE_POR_ID) {
      // Página llena y sin cursor: MELI ignoró `from_id`, no hay cómo seguir.
      return rechazado("la respuesta no trae last_id");
    }
    progreso.modo = "id";
    paginas++;
    const cargos = extraerCargos(crudo, periodo);
    const lote = cargos.filter((c) => !ctx.vistos.has(c.detalleId) && ctx.vistos.add(c.detalleId));
    await guardarCargos(admin, accountId, tabla, periodo, lote);
    progreso.offset += lote.length;
    // MELI cuenta el `total` DESDE `from_id` (74,059 en la primera página,
    // 55,059 con 20 mil leídos): el total del periodo es el de la primera.
    const totalAqui = totalDe(crudo);
    if (totalAqui != null && (String(desdeId) === "0" || progreso.total == null)) progreso.total = totalAqui;
    progreso.ultimaPagina = {
      renglones: resultados.length,
      lastId,
      total: totalAqui,
      claves: crudo && typeof crudo === "object" && !Array.isArray(crudo) ? Object.keys(crudo).slice(0, 12) : [],
    };

    // El cursor es el `last_id` de MELI o, si no lo manda, el mayor id de
    // la página: los renglones traen su `detail_id`.
    const ultimo = lastId ?? mayorIdDe(cargos);
    if (!resultados.length || ultimo == null || !avanza(desdeId, ultimo)) {
      return { estado: "completo", paginas, error: null };
    }
    // Una página corta NO es el final mientras MELI diga que faltan
    // renglones desde aquí: el 6-oct-2026 julio y agosto 2026 contestaron
    // 950 renglones en el día 10 (con ~48 mil y ~50 mil por delante según
    // su `total`) y la lectura los dio por completos con solo diez días.
    if (resultados.length < LIMITE_POR_ID && (totalAqui == null || totalAqui <= resultados.length)) {
      return { estado: "completo", paginas, error: null };
    }
    if (resultados.length < LIMITE_POR_ID) {
      ctx.avisos.push(`Página corta en ${desdeId} (${resultados.length} renglones con ${totalAqui} por delante): se sigue desde ${ultimo}.`);
    }
    desdeId = ultimo;
    progreso.desdeId = desdeId;
    if (Date.now() + PASO_CUOTA_MS >= finMs) break;
    // Avance guardado por página: si Vercel corta, se retoma aquí.
    await almacen.guardarProgreso(progreso, { paginas, error: null, avisos: ctx.avisos });
    await ctx.espera(PASO_CUOTA_MS);
  }
  return { estado: "sin_plazo", paginas, error: null };
}

/** La cuenta de calzado: lee (o sigue leyendo) los cargos del periodo. */
export async function sincronizarCargos(admin: DB, accountId: string, periodo: string, finMs = Date.now() + 100_000): Promise<ResultadoCargos> {
  const almacen = await almacenMeli(admin, accountId);
  if (!almacen) return { cargos: 0, full: 0, total: null, completo: false, error: "No hay cuenta de MELI conectada." };
  return sincronizarCargosCon(admin, accountId, periodo, almacen, finMs);
}

/**
 * Continúa la lectura de cargos que quedó a medias (la más reciente) y, si
 * no hay nada a medias, ARRANCA sola la del mes anterior y la del mes en
 * curso cuando nunca se han leído (o su último intento tiene más de 6 h):
 * sin esto los gastos de Full del corte dependían de un clic.
 * null = nada que hacer.
 */
export async function continuarCargosCon(admin: DB, accountId: string, almacen: AlmacenCargos, finMs: number): Promise<ResultadoCargos | null> {
  const [pendiente] = await almacen.pendientes();
  if (pendiente) return sincronizarCargosCon(admin, accountId, pendiente, almacen, finMs);
  const hoy = new Date(Date.now() - 6 * 3_600_000);
  const actual = hoy.toISOString().slice(0, 7);
  const anterior = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  for (const periodo of [anterior, actual]) {
    const p = await almacen.leerProgreso(periodo);
    // Un mes «completo» que se leyó con el mes todavía abierto sigue
    // creciendo en MELI: septiembre 2026 se leyó el 7-sep (9,132 renglones)
    // y se quedó así todo el mes. Se relee cada tanto hasta que la última
    // lectura sea posterior al cierre del mes.
    if (p.completo && !leidoAntesDeCerrar(p, periodo)) continue;
    const cadaMs = (p.completo ? HORAS_RELECTURA_MES_ABIERTO : 6) * 3_600_000;
    if (p.actualizadoEn && Date.parse(p.actualizadoEn) > Date.now() - cadaMs) continue;
    return sincronizarCargosCon(admin, accountId, periodo, almacen, finMs);
  }
  // Con el mes anterior y el actual al día, los meses VIEJOS que nunca se
  // leyeron (mayo, junio y julio de 2026 salían con $0 de gastos de Full):
  // uno por latido, del más reciente al más viejo, hasta el primer mes con
  // venta. Un mes que MELI ya no lista no se insiste más que una vez al día.
  for (const periodo of mesesHaciaAtras(anterior, PRIMER_PERIODO_FACTURACION)) {
    const p = await almacen.leerProgreso(periodo);
    // Un mes «completo» que se quedó corto por el tope de offset (agosto
    // 2026: 9,900 de 74,059) se relee por id en cuanto se pueda; si la
    // lectura por id también falló (modo offset), ya no se insiste.
    const porTotal = necesitaRelecturaPorTotal(p);
    if (p.completo && !porTotal) continue;
    // La espera de un día es para el mes que MELI NO lista (sin clave). Un
    // mes con clave que se quedó en cero fue la cuota (429 en la primera
    // llamada): agosto 2026 arrancó su relectura a las 22:14Z del 6-oct,
    // MELI contestó 429 y el bucle lo dejó esperando 24 h mientras seguía
    // con julio. Con clave se reintenta en el siguiente latido.
    if (!porTotal && !p.clave && p.actualizadoEn && Date.parse(p.actualizadoEn) > Date.now() - 24 * 3_600_000) continue;
    try {
      return await sincronizarCargosCon(admin, accountId, periodo, almacen, finMs);
    } catch (err) {
      // Que quede huella con fecha: sin ella el siguiente latido lo volvería
      // a pedir y MELI recibiría la misma pregunta cada 30 segundos.
      await almacen.guardarProgreso(
        { periodo, clave: null, offset: 0, total: null, completo: false, actualizadoEn: new Date().toISOString(), particion: null, cursor: null, offsetParticion: 0 },
        { error: (err as Error).message.slice(0, 300) },
      );
      return { periodo, cargos: 0, full: 0, total: null, completo: false, error: `${periodo}: ${(err as Error).message}` };
    }
  }
  return null;
}

/** El primer mes con venta de calzado: antes no hay facturación que pedir. */
export const PRIMER_PERIODO_FACTURACION = "2026-05";

/** Cada cuántas horas se relee un mes que sigue abierto en MELI. */
export const HORAS_RELECTURA_MES_ABIERTO = 12;

/** Veces que un mes corto se relee por id antes de dejarlo declarado como corto. */
export const MAX_RELECTURAS_CORTAS = 2;

/**
 * ¿Se dio por completo con menos renglones de los que MELI declara? Entonces
 * toca releerlo por id: lo leído por offset antes del 6-oct-2026 (`modo`
 * vacío) y lo que la lectura por id cortó antes de tiempo (julio y agosto
 * 2026 se quedaron en el día 10 con 13,950 de 61,966 y 24,950 de 74,059).
 * Si MELI rechazó el id (`offset`) o ya se releyó `MAX_RELECTURAS_CORTAS`
 * veces y sigue corto, releer no cambiaría nada: queda declarado en la
 * revisión general.
 */
export function necesitaRelecturaPorTotal(p: Pick<ProgresoCargos, "completo" | "offset" | "total" | "modo" | "relecturas">): boolean {
  return (
    p.completo &&
    p.total != null &&
    p.total > 0 &&
    p.offset < p.total * 0.95 &&
    p.modo !== "offset" &&
    (p.relecturas ?? 0) < MAX_RELECTURAS_CORTAS
  );
}

/** El instante en que cierra el periodo YYYY-MM: el primer día del mes siguiente a las 0:00 de México (UTC−6). */
export function cierreDelPeriodoMs(periodo: string): number {
  const [a, m] = periodo.split("-").map(Number);
  return Date.UTC(a, m, 1, 6);
}

/**
 * ¿La última lectura del periodo se hizo cuando el mes aún no cerraba? Un
 * progreso sin fecha cuenta como leído antes de tiempo (no se sabe).
 */
export function leidoAntesDeCerrar(p: Pick<ProgresoCargos, "actualizadoEn">, periodo: string): boolean {
  if (!p.actualizadoEn) return true;
  return Date.parse(p.actualizadoEn) < cierreDelPeriodoMs(periodo);
}

/** Los meses ANTERIORES a `desde` (exclusivo), del más reciente al más viejo, hasta `hasta` (inclusivo). */
export function mesesHaciaAtras(desde: string, hasta: string): string[] {
  const out: string[] = [];
  let [y, m] = desde.split("-").map(Number);
  for (let i = 0; i < 60; i++) {
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
    const periodo = `${y}-${String(m).padStart(2, "0")}`;
    if (periodo < hasta) break;
    out.push(periodo);
  }
  return out;
}

/**
 * La cuenta de calzado, montada en el latido. Cargos nuevos son gastos de
 * Full nuevos: el corte masticado de ese mes (y el corte general) quedan
 * viejos y se marcan para recalcular; hasta el 6-oct-2026 solo lo hacía el
 * botón de la pantalla, y septiembre se releyó completo en el fondo sin
 * que el corte se enterara.
 */
export async function continuarCargosPendientes(admin: DB, accountId: string, finMs: number): Promise<ResultadoCargos | null> {
  const almacen = await almacenMeli(admin, accountId);
  if (!almacen) return null;
  const r = await continuarCargosCon(admin, accountId, almacen, finMs);
  if (r?.periodo && r.cargos > 0) {
    await invalidarCortesDePeriodos(admin, { meliAccountId: accountId }, [r.periodo], "Se leyó facturación del periodo en el fondo.").catch(() => undefined);
  }
  return r;
}

/** Los cargos guardados del periodo. */
export async function cargosGuardados(db: DB, accountId: string, periodo: string, tabla = "meli_cargos"): Promise<CargoMeli[]> {
  const filas = await traerTodo<any>(
    db,
    tabla,
    "detalle_id, periodo, fecha, tipo, subtipo, descripcion, monto, clase",
    (q) => q.eq("account_id", accountId).eq("periodo", periodo),
  );
  return filas.map((f) => ({
    detalleId: f.detalle_id,
    periodo: f.periodo,
    fecha: f.fecha,
    tipo: f.tipo,
    subtipo: f.subtipo,
    descripcion: f.descripcion,
    monto: Number(f.monto) || 0,
    clase: (f.clase ?? "otro") as ClaseCargo,
  }));
}
