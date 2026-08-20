/**
 * Capa de datos: todo lo que se lee y se escribe en Supabase vive aquí.
 * Las páginas y las rutas no hablan SQL directamente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  InventarioPropio,
  OperacionStock,
  Parametros,
  SkuOverride,
  SnapshotStock,
  StockFull,
  VentaDiaria,
} from "../engine/types";
import type { Corrida, FilaExistencia } from "../importar/excel";

export type DB = SupabaseClient<any, "public", any>;

/**
 * Trae una tabla completa. Supabase corta en 1000 renglones por petición.
 *
 * Se estima el tamaño y se piden todas las páginas EN PARALELO. Pedirlas
 * en cadena, esperando cada una para saber si hay más, convertía 32 mil
 * ventas en 33 viajes seguidos al servidor: varios segundos en puro ir y
 * venir, antes de calcular nada.
 *
 * El conteo es ESTIMADO (estadísticas de Postgres, gratis) y no exacto:
 * el exacto recorría el índice completo en cada carga de página, y estas
 * lecturas corren varias veces por clic. Si el estimado se queda corto,
 * se siguen pidiendo páginas hasta que llegue una incompleta; si se pasa,
 * las páginas de más regresan vacías y no cuestan casi nada.
 */
export async function traerTodo<T>(
  db: DB,
  tabla: string,
  columnas: string,
  filtros: (q: any) => any,
  paso = 1000,
): Promise<T[]> {
  const leer = async (pagina: number): Promise<T[]> => {
    const desde = pagina * paso;
    const { data, error } = await filtros(db.from(tabla).select(columnas)).range(
      desde,
      desde + paso - 1,
    );
    if (error) throw new Error(`${tabla}: ${error.message}`);
    return (data ?? []) as T[];
  };

  // La página 0 y el conteo salen JUNTOS: para las tablas chicas (la
  // mayoría) la página 0 basta y el conteo deja de costar un viaje EN SERIE
  // antes de cada lectura, que sumaba ~medio segundo por pantalla.
  const [primera, conteo] = await Promise.all([
    leer(0),
    filtros(db.from(tabla).select(columnas, { count: "estimated", head: true })),
  ]);
  if (conteo.error) throw new Error(`${tabla}: ${conteo.error.message}`);
  if (primera.length < paso) return primera;

  const count = conteo.count as number | null;
  const CONCURRENCIA = 6; // más que esto y Supabase empieza a encolar
  const paginas: T[][] = [primera];
  let tope = Math.max(1, Math.ceil((count ?? 0) / paso));
  let siguiente = 1;

  const trabajador = async () => {
    while (true) {
      const pagina = siguiente++;
      if (pagina >= tope) return;
      paginas[pagina] = await leer(pagina);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCIA, Math.max(1, tope - 1)) }, trabajador),
  );

  // El estimado puede quedarse corto: si la última página vino llena, hay más.
  while (paginas[tope - 1]?.length === paso) {
    paginas[tope] = await leer(tope);
    tope++;
  }

  return paginas.flat();
}

// ---------------------------------------------------------------------------
// Cuenta
// ---------------------------------------------------------------------------
export interface Cuenta {
  id: string;
  meli_user_id: number;
  nickname: string | null;
  site_id: string;
}

/**
 * La cuenta casi nunca cambia pero se consultaba EN SERIE al inicio de cada
 * página: era un viaje a la base antes de poder pedir nada más. Se cachea
 * un minuto POR USUARIO (la llave sale del token de la sesión, sin red).
 */
const cacheCuenta = new Map<string, { en: number; cuenta: Cuenta | null }>();
const VIDA_CACHE_CUENTA_MS = 60_000;

export async function cuentaActiva(db: DB): Promise<Cuenta | null> {
  let llave: string | null = null;
  try {
    const { data } = await (db as any).auth.getSession();
    llave = data?.session?.user?.id ?? null;
  } catch {
    llave = null;
  }

  if (llave) {
    const guardada = cacheCuenta.get(llave);
    if (guardada && Date.now() - guardada.en < VIDA_CACHE_CUENTA_MS) return guardada.cuenta;
  }

  const { data } = await db
    .from("meli_accounts")
    .select("id, meli_user_id, nickname, site_id")
    .order("creado_en", { ascending: true })
    .limit(1)
    .maybeSingle();
  const cuenta = (data as Cuenta) ?? null;
  if (llave) cacheCuenta.set(llave, { en: Date.now(), cuenta });
  return cuenta;
}

// ---------------------------------------------------------------------------
// Parámetros
// ---------------------------------------------------------------------------
export async function leerParametros(
  db: DB,
  accountId: string,
): Promise<Partial<Parametros>> {
  const { data } = await db
    .from("parametros")
    .select("datos")
    .eq("account_id", accountId)
    .maybeSingle();
  return (data?.datos as Partial<Parametros>) ?? {};
}

export async function guardarParametros(
  db: DB,
  accountId: string,
  datos: Partial<Parametros>,
): Promise<void> {
  const { error } = await db
    .from("parametros")
    .upsert(
      { account_id: accountId, datos, actualizado_en: new Date().toISOString() },
      { onConflict: "account_id" },
    );
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Insumos del motor
// ---------------------------------------------------------------------------
export interface InsumosPlan {
  skus: { sku: string; titulo?: string | null }[];
  stockActual: StockFull[];
  ventas: VentaDiaria[];
  snapshots: SnapshotStock[];
  operaciones: OperacionStock[];
  corridas: Corrida[];
  existencias: FilaExistencia[];
  almacenesActivos: string[];
  mapeoManual: Map<string, string>;
  overrides: SkuOverride[];
  parametros: Partial<Parametros>;
}

export async function cargarInsumos(
  db: DB,
  accountId: string,
  desde: string,
): Promise<InsumosPlan> {
  const eq = (q: any) => q.eq("account_id", accountId);

  const [
    skusRaw,
    stockRaw,
    ventasRaw,
    snapsRaw,
    opsRaw,
    corridasRaw,
    existRaw,
    almacenesRaw,
    mapeoRaw,
    overridesRaw,
    parametros,
  ] = await Promise.all([
    traerTodo<any>(db, "skus", "sku, titulo, inventory_id", (q) => eq(q).eq("activo", true)),
    traerTodo<any>(db, "stock_full", "sku, disponible, en_transferencia, no_disponible, total", eq),
    traerTodo<any>(db, "ventas_diarias", "sku, fecha, unidades, ordenes, importe", (q) =>
      eq(q).gte("fecha", desde),
    ),
    traerTodo<any>(db, "stock_snapshots", "sku, fecha, disponible, en_transferencia, origen", (q) =>
      eq(q).gte("fecha", desde),
    ),
    traerTodo<any>(
      db,
      "stock_operaciones",
      "sku, fecha, tipo, delta_disponible, resultado_disponible",
      (q) => eq(q).gte("fecha", `${desde}T00:00:00Z`),
    ),
    traerTodo<any>(db, "corridas", "pedido, modelo, color, tallas, total", eq),
    traerTodo<any>(
      db,
      "existencias",
      "almacen, codigo_almacen, sku_caja, pedido, modelo, color, talla, contenedor, cajas_fisicas, cajas_apartadas, en_camino, cajas_disponibles, pares_por_caja",
      eq,
    ),
    traerTodo<any>(db, "almacenes_activos", "almacen, surte_full", eq),
    traerTodo<any>(db, "mapeo_sku", "sku_construido, sku_meli", eq),
    traerTodo<any>(
      db,
      "sku_overrides",
      "sku, excluir, demanda_manual, factor_temporada, minimo_envio",
      eq,
    ),
    leerParametros(db, accountId),
  ]);

  return {
    skus: skusRaw.map((s) => ({ sku: s.sku, titulo: s.titulo })),
    stockActual: stockRaw.map((s) => ({
      sku: s.sku,
      disponible: s.disponible ?? 0,
      enTransferencia: s.en_transferencia ?? 0,
      noDisponible: s.no_disponible ?? 0,
      total: s.total ?? 0,
    })),
    ventas: ventasRaw.map((v) => ({
      sku: v.sku,
      fecha: v.fecha,
      unidades: v.unidades ?? 0,
      ordenes: v.ordenes ?? 0,
      importe: Number(v.importe ?? 0),
    })),
    snapshots: snapsRaw.map((s) => ({
      sku: s.sku,
      fecha: s.fecha,
      disponible: s.disponible ?? 0,
      enTransferencia: s.en_transferencia ?? 0,
      origen: s.origen,
    })),
    operaciones: opsRaw.map((o) => ({
      sku: o.sku,
      fecha: o.fecha,
      tipo: o.tipo,
      deltaDisponible: o.delta_disponible,
      resultadoDisponible: o.resultado_disponible,
    })),
    corridas: corridasRaw.map((c) => ({
      pedido: c.pedido,
      modelo: c.modelo,
      color: c.color,
      tallas: c.tallas ?? {},
      total: c.total ?? 0,
    })),
    existencias: existRaw.map((e) => ({
      almacen: e.almacen,
      codigoAlmacen: e.codigo_almacen ?? "",
      skuCaja: e.sku_caja,
      pedido: e.pedido ?? "",
      modelo: e.modelo,
      color: e.color ?? "",
      talla: e.talla,
      contenedor: e.contenedor ?? "",
      cajasFisicas: e.cajas_fisicas ?? 0,
      cajasApartadas: e.cajas_apartadas ?? 0,
      enCamino: e.en_camino ?? 0,
      cajasDisponibles: e.cajas_disponibles ?? 0,
      paresPorCaja: e.pares_por_caja ?? 0,
      paresDisponibles: 0,
    })),
    almacenesActivos: almacenesRaw.filter((a) => a.surte_full).map((a) => a.almacen),
    mapeoManual: new Map(mapeoRaw.map((m) => [m.sku_construido, m.sku_meli])),
    overrides: overridesRaw.map((o) => ({
      sku: o.sku,
      excluir: o.excluir ?? false,
      demandaManual: o.demanda_manual,
      factorTemporada: Number(o.factor_temporada ?? 1),
      minimoEnvio: o.minimo_envio,
    })),
    parametros,
  };
}

// ---------------------------------------------------------------------------
// Escrituras masivas
// ---------------------------------------------------------------------------

/** Inserta en tandas: Postgres se atraganta con upserts de 10 000 renglones. */
export async function upsertEnTandas(
  db: DB,
  tabla: string,
  filas: Record<string, unknown>[],
  onConflict: string,
  tanda = 500,
): Promise<number> {
  let escritas = 0;
  for (let i = 0; i < filas.length; i += tanda) {
    const trozo = filas.slice(i, i + tanda);
    const { error } = await db.from(tabla).upsert(trozo, { onConflict });
    if (error) throw new Error(`${tabla}: ${error.message}`);
    escritas += trozo.length;
  }
  return escritas;
}

export async function registrarSync(
  db: DB,
  accountId: string,
  tarea: string,
): Promise<number | null> {
  const { data } = await db
    .from("sync_log")
    .insert({ account_id: accountId, tarea })
    .select("id")
    .maybeSingle();
  return data?.id ?? null;
}

export async function cerrarSync(
  db: DB,
  id: number | null,
  estado: "ok" | "error",
  detalle: Record<string, unknown>,
): Promise<void> {
  if (id == null) return;
  await db
    .from("sync_log")
    .update({ fin: new Date().toISOString(), estado, detalle })
    .eq("id", id);
}
