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

export type ClaseCargo = "full" | "publicidad" | "venta" | "pago" | "otro" | "resumen";

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

export interface ProgresoCargos {
  periodo: string;
  clave: string | null;
  offset: number;
  total: number | null;
  completo: boolean;
  actualizadoEn: string | null;
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
  const d: any = data?.detalle ?? {};
  return {
    periodo,
    clave: typeof d.clave === "string" ? d.clave : null,
    offset: Number(d.offset) || 0,
    total: d.total == null ? null : Number(d.total),
    completo: Boolean(d.completo),
    actualizadoEn: data?.fin ?? null,
  };
}

async function guardarProgreso(db: DB, accountId: string, p: ProgresoCargos, extra?: Record<string, unknown>): Promise<void> {
  await db.from("sync_log").insert({
    account_id: accountId,
    tarea: "cargos_meli",
    estado: "ok",
    fin: new Date().toISOString(),
    detalle: { periodo: p.periodo, clave: p.clave, offset: p.offset, total: p.total, completo: p.completo, ...extra },
  });
}

async function guardarCargos(admin: DB, accountId: string, periodo: string, cargos: CargoMeli[]): Promise<void> {
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
    leido_en: new Date().toISOString(),
  }));
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await admin.from("meli_cargos").upsert(filas.slice(i, i + 500), { onConflict: "account_id,detalle_id" });
    if (error) throw new Error(`No se pudieron guardar los cargos: ${error.message}`);
  }
}

export interface ResultadoCargos {
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

/**
 * Lee (o sigue leyendo) los cargos del periodo hasta agotar `finMs`.
 *
 * El endpoint de detalles tiene cuota de 5 llamadas por minuto y un mes
 * trae decenas de miles de renglones (comisión y envío de cada orden), así
 * que la lectura es REANUDABLE: el avance queda en sync_log y el latido la
 * continúa cada minuto hasta completarla. Al empezar de cero se borra lo
 * del periodo; las páginas se guardan conforme llegan.
 */
export async function sincronizarCargos(admin: DB, accountId: string, periodo: string, finMs = Date.now() + 100_000): Promise<ResultadoCargos> {
  const cliente = await clienteDeCuenta(admin, accountId);
  if (!cliente) return { cargos: 0, full: 0, total: null, completo: false, error: "No hay cuenta de MELI conectada." };

  const totalesGuardados = async (): Promise<{ cargos: number; full: number }> => {
    const filas = await cargosGuardados(admin, accountId, periodo);
    return { cargos: filas.length, full: filas.filter((c) => c.clase === "full").reduce((a, c) => a + c.monto, 0) };
  };

  const progreso = await progresoCargos(admin, accountId, periodo);
  if (progreso.completo) {
    // Releer desde cero: el usuario lo pidió a propósito.
    progreso.completo = false;
    progreso.offset = 0;
    progreso.total = null;
  }

  try {
    if (!progreso.clave) progreso.clave = await resolverClavePeriodo(cliente, periodo);
  } catch (err) {
    return { ...(await totalesGuardados()), total: null, completo: false, error: (err as Error).message };
  }
  const clave = progreso.clave;

  // Al arrancar de cero: fuera lo viejo del periodo, y el resumen si existe.
  if (progreso.offset === 0) {
    await admin.from("meli_cargos").delete().eq("account_id", accountId).eq("periodo", periodo);
    try {
      const crudo = await cliente.get<unknown>(
        `/billing/integration/periods/key/${encodeURIComponent(clave)}/group/ML/summary`,
        { document_type: "BILL" },
        { reintentos: 0 },
      );
      await guardarCargos(admin, accountId, periodo, extraerResumen(crudo, periodo));
      await guardarProgreso(admin, accountId, progreso, { resumen: JSON.stringify(crudo).slice(0, 2000) });
    } catch (err) {
      await guardarProgreso(admin, accountId, progreso, { resumenError: (err as Error).message.slice(0, 300) });
    }
  }

  let error: string | null = null;
  let paginas = 0;
  while (Date.now() < finMs) {
    let crudo: any;
    try {
      crudo = await cliente.get<unknown>(
        `/billing/integration/periods/key/${encodeURIComponent(clave)}/group/ML/details`,
        { document_type: "BILL", limit: LIMITE_DETALLES, offset: progreso.offset },
        { reintentos: 0 },
      );
    } catch (err) {
      const e = err as MeliError;
      if (e instanceof MeliError && e.status === 429) {
        // Cuota agotada: si cabe un minuto de espera, se espera; si no, el
        // latido retoma donde se quedó.
        if (Date.now() + 62_000 < finMs) {
          await dormir(62_000);
          continue;
        }
        error = "MELI limita este endpoint a 5 llamadas por minuto: la lectura sigue sola en segundo plano.";
        break;
      }
      error = e.message;
      break;
    }
    paginas++;
    const lote = extraerCargos(crudo, periodo);
    await guardarCargos(admin, accountId, periodo, lote);
    if (typeof crudo?.total === "number") progreso.total = crudo.total;
    else if (typeof crudo?.paging?.total === "number") progreso.total = crudo.paging.total;
    progreso.offset += lote.length;
    if (lote.length < LIMITE_DETALLES || (progreso.total != null && progreso.offset >= progreso.total)) {
      progreso.completo = true;
      break;
    }
    if (Date.now() + PASO_CUOTA_MS >= finMs) break;
    await dormir(PASO_CUOTA_MS);
  }
  await guardarProgreso(admin, accountId, progreso, { paginas, error });
  return { ...(await totalesGuardados()), total: progreso.total, completo: progreso.completo, error };
}

/**
 * Continúa en el latido la lectura de cargos que quedó a medias (la más
 * reciente sin completar). Devuelve null si no hay nada pendiente.
 */
export async function continuarCargosPendientes(admin: DB, accountId: string, finMs: number): Promise<ResultadoCargos | null> {
  const { data } = await admin
    .from("sync_log")
    .select("detalle")
    .eq("account_id", accountId)
    .eq("tarea", "cargos_meli")
    .order("inicio", { ascending: false })
    .limit(12);
  const vistos = new Set<string>();
  for (const f of data ?? []) {
    const d: any = f.detalle ?? {};
    const periodo = typeof d.periodo === "string" ? d.periodo : null;
    if (!periodo || vistos.has(periodo)) continue;
    vistos.add(periodo);
    // Solo la ÚLTIMA huella de cada periodo dice si quedó a medias.
    if (d.completo) continue;
    if (!(Number(d.offset) > 0)) continue; // nunca arrancó bien: no insistir solo
    return sincronizarCargos(admin, accountId, periodo, finMs);
  }
  return null;
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
