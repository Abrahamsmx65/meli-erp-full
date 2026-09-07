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

export type ClaseCargo = "full" | "publicidad" | "venta" | "pago" | "otro";

export interface CargoMeli {
  detalleId: string;
  periodo: string;
  fecha: string | null;
  tipo: string | null;
  subtipo: string | null;
  descripcion: string | null;
  monto: number;
  clase: ClaseCargo;
}

/**
 * Clasificación por texto del tipo y la descripción del cargo:
 *  - full: almacenamiento, retiros, servicio de Full (el gasto del corte)
 *  - publicidad: Product Ads (ya se cuenta desde el API de publicidad)
 *  - venta: comisión y envío (ya vienen en el neto de Mercado Pago)
 *  - pago: abonos, pagos y bonificaciones (no son gasto)
 *  - otro: lo que no se reconoce, se enseña y cuenta como otro cargo
 */
export function clasificarCargo(texto: string): ClaseCargo {
  const t = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (/almacen|storage|prolongad|retiro|fulfillment|servicio de full|servicio full|deposito/.test(t)) return "full";
  if (/publicidad|product ads|anuncio|advertising/.test(t)) return "publicidad";
  if (/comision|tarifa de venta|cargo por venta|costo de envio|costo por envio|envio|flete|shipping/.test(t)) return "venta";
  if (/\bpago\b|abono|bonificacion|payment|credito aplicado/.test(t)) return "pago";
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

/** Todos los renglones facturados del periodo (YYYY-MM), paginados. */
export async function leerCargosDelPeriodo(cliente: MeliClient, periodo: string): Promise<CargoMeli[]> {
  // 1. La clave del periodo, de la lista de periodos de MELI.
  let clave: string | null = null;
  let claves: string[] = [];
  let errorPeriodos: string | null = null;
  try {
    const crudo = await conRutas(
      ["/billing/integration/monthly/periods", "/billing/integration/periods"],
      (ruta) => cliente.get<unknown>(ruta, { group: "ML", document_type: "BILL", limit: 24, offset: 0 }),
    );
    ({ clave, claves } = claveDePeriodo(crudo, periodo));
  } catch (err) {
    errorPeriodos = (err as Error).message;
  }
  if (!clave) {
    const muestra = claves.length ? ` Periodos que MELI lista: ${claves.slice(0, 12).join(", ")}.` : "";
    const detalle = errorPeriodos ? ` La lista de periodos falló: ${errorPeriodos}.` : "";
    throw new MeliError(
      `MELI no lista un periodo de facturación para ${periodo}.${muestra}${detalle}`,
      404,
      { claves },
      "/billing/integration/monthly/periods",
    );
  }

  // 2. Los renglones de ese periodo.
  const rutas = [
    `/billing/integration/periods/key/${encodeURIComponent(clave)}/group/ML/details`,
    `/billing/integration/monthly/periods/key/${encodeURIComponent(clave)}/group/ML/details`,
  ];
  const limite = 150;
  const cargos: CargoMeli[] = [];
  const vistos = new Set<string>();
  for (let pagina = 0; pagina < 200; pagina++) {
    const crudo = await conRutas(rutas, (ruta) =>
      cliente.get<unknown>(ruta, { document_type: "BILL", limit: limite, offset: pagina * limite }),
    );
    const lote = extraerCargos(crudo, periodo);
    for (const c of lote) {
      if (vistos.has(c.detalleId)) continue;
      vistos.add(c.detalleId);
      cargos.push(c);
    }
    if (lote.length < limite) break;
  }
  return cargos;
}

export interface ResultadoCargos {
  cargos: number;
  /** suma de los cargos de clase full */
  full: number;
  error: string | null;
}

/** Lee los cargos del periodo y los guarda (reemplaza lo del periodo). */
export async function sincronizarCargos(admin: DB, accountId: string, periodo: string): Promise<ResultadoCargos> {
  const cliente = await clienteDeCuenta(admin, accountId);
  if (!cliente) return { cargos: 0, full: 0, error: "No hay cuenta de MELI conectada." };
  let cargos: CargoMeli[];
  try {
    cargos = await leerCargosDelPeriodo(cliente, periodo);
  } catch (err) {
    const e = err as MeliError;
    const detalle = e instanceof MeliError ? ` (HTTP ${e.status})` : "";
    return { cargos: 0, full: 0, error: `MELI no entregó la facturación del periodo${detalle}: ${e.message}` };
  }
  await admin.from("meli_cargos").delete().eq("account_id", accountId).eq("periodo", periodo);
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
    leido_en: new Date().toISOString(),
  }));
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await admin
      .from("meli_cargos")
      .upsert(filas.slice(i, i + 500), { onConflict: "account_id,detalle_id" });
    if (error) return { cargos: 0, full: 0, error: `No se pudieron guardar los cargos: ${error.message}` };
  }
  const full = cargos.filter((c) => c.clase === "full").reduce((a, c) => a + c.monto, 0);
  return { cargos: cargos.length, full, error: null };
}

/** Los cargos guardados del periodo. */
export async function cargosGuardados(db: DB, accountId: string, periodo: string): Promise<CargoMeli[]> {
  const filas = await traerTodo<any>(
    db,
    "meli_cargos",
    "detalle_id, periodo, fecha, tipo, subtipo, descripcion, monto, clase",
    (q) => q.eq("account_id", accountId).eq("periodo", periodo),
  ).catch(() => [] as any[]);
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
