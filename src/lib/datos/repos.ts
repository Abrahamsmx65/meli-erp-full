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
/**
 * Llave primaria por tabla: el orden estable de la paginación.
 *
 * Ordenar por TODAS las columnas pedidas (la versión anterior) era estable
 * pero carísimo: sin índice que soporte ese orden, Postgres re-ordenaba la
 * tabla completa EN CADA página (~1.4 s por página en ventas_diarias; las
 * pantallas tardaban decenas de segundos). La llave primaria ya tiene
 * índice, es única —determinismo garantizado— y el orden sale gratis.
 */
const LLAVE_POR_TABLA: Record<string, string[]> = {
  almacenes_activos: ["account_id", "almacen"],
  amazon_envios_entrantes: ["account_id", "shipment_id", "seller_sku"],
  amazon_inventario: ["account_id", "seller_sku"],
  amazon_listings: ["account_id", "seller_sku"],
  amazon_padres: ["account_id", "asin"],
  amazon_pagos: ["account_id", "settlement_id", "seller_sku", "fecha"],
  amazon_skus: ["account_id", "seller_sku"],
  corridas: ["account_id", "pedido", "modelo", "color"],
  datos_fiscales: ["account_id", "sku"],
  existencias: ["id"],
  mapeo_sku: ["account_id", "sku_construido"],
  medidas_envio: ["account_id", "sku"],
  ordenes_neto: ["account_id", "order_id"],
  pedidos: ["id"],
  productos_config: ["account_id", "modelo", "color"],
  sku_overrides: ["account_id", "sku"],
  skus: ["id"],
  skus_pendientes: ["account_id", "item_id", "variation_id"],
  stock_full: ["account_id", "sku"],
  tarifas_envio: ["account_id", "clave"],
  tiktok_inventario: ["account_id", "sku"],
  tiktok_mapeo_sku: ["account_id", "sku_tiktok"],
  tiktok_movimientos: ["id"],
  tiktok_orden_items: ["account_id", "line_item_id"],
  tiktok_ordenes: ["account_id", "order_id"],
  tiktok_skus: ["account_id", "sku_id"],
  // Las tablas que SIEMPRE se leen por rango de fecha van ordenadas con la
  // fecha ADELANTE: así el plan usa el índice (account_id, fecha) de la
  // migración 0021 y no recorre el índice completo de la llave primaria
  // (medido: 756 ms vs 1,065 ms en la peor página de ventas_diarias). El
  // conjunto de columnas sigue siendo la llave completa: orden único.
  amazon_economia: ["account_id", "fecha", "seller_sku"],
  amazon_inventario_snapshots: ["account_id", "fecha", "seller_sku"],
  amazon_ventas_diarias: ["account_id", "fecha", "seller_sku"],
  stock_operaciones: ["account_id", "fecha", "operation_id"],
  stock_snapshots: ["account_id", "fecha", "sku"],
  ventas_diarias: ["account_id", "fecha", "sku"],
  tiktok_ventas_diarias: ["account_id", "fecha", "sku"],
};

export async function traerTodo<T>(
  db: DB,
  tabla: string,
  columnas: string,
  filtros: (q: any) => any,
  paso = 1000,
): Promise<T[]> {
  // Paginar SIN ORDER BY no es determinista en Postgres: con escrituras
  // concurrentes (el latido escribe cada minuto) una fila leída en la página
  // 0 puede reaparecer en la 3 y se suma DOS veces. El monitor de ventas
  // llegó a mostrar ~1.7× las unidades reales por esto. Orden estable por
  // la llave primaria (índice gratis); para una tabla que no esté en el
  // mapa, por todas las columnas pedidas, como antes.
  const orden =
    LLAVE_POR_TABLA[tabla] ??
    (columnas.includes("(") || columnas.includes("*")
      ? []
      : columnas.split(",").map((c) => c.trim()).filter(Boolean));

  const leer = async (pagina: number): Promise<T[]> => {
    const desde = pagina * paso;
    let q = filtros(db.from(tabla).select(columnas));
    for (const col of orden) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(desde, desde + paso - 1);
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

export class RecursoOcupadoError extends Error {
  constructor(
    public readonly recurso: string,
    mensaje = "Ya hay otra ejecución en curso.",
  ) {
    super(mensaje);
    this.name = "RecursoOcupadoError";
  }
}

export async function adquirirCandado(
  db: DB,
  accountId: string,
  recurso: string,
  ttlSegundos: number,
): Promise<string | null> {
  const { data, error } = await db.rpc("adquirir_candado_trabajo", {
    p_account_id: accountId,
    p_recurso: recurso,
    p_ttl_segundos: ttlSegundos,
  });
  if (error) throw new Error(`candado ${recurso}: ${error.message}`);
  return typeof data === "string" ? data : null;
}

export async function liberarCandado(
  db: DB,
  accountId: string,
  recurso: string,
  token: string,
): Promise<boolean> {
  const { data, error } = await db.rpc("liberar_candado_trabajo", {
    p_account_id: accountId,
    p_recurso: recurso,
    p_token: token,
  });
  if (error) throw new Error(`candado ${recurso}: ${error.message}`);
  return data === true;
}

/**
 * Ejecuta una tarea con exclusión mutua por cuenta. El candado vence solo si
 * la función muere antes del `finally`; una liberación fallida no oculta el
 * resultado de la tarea y el TTL evita un bloqueo permanente.
 */
export async function conCandado<T>(
  db: DB,
  accountId: string,
  recurso: string,
  ttlSegundos: number,
  tarea: () => Promise<T>,
  mensajeOcupado?: string,
): Promise<T> {
  const token = await adquirirCandado(db, accountId, recurso, ttlSegundos);
  if (!token) throw new RecursoOcupadoError(recurso, mensajeOcupado);

  try {
    return await tarea();
  } finally {
    try {
      await liberarCandado(db, accountId, recurso, token);
    } catch (err) {
      console.error(`No se pudo liberar el candado ${recurso}:`, (err as Error).message);
    }
  }
}

/**
 * Reemplaza una foto de existencias dentro de una sola transacción en
 * Postgres. El borrado anterior se revierte automáticamente si cualquier fila
 * nueva falla, de modo que nunca queda una foto vacía o a medias.
 */
export async function reemplazarExistencias(
  db: DB,
  accountId: string,
  almacenes: string[],
  filas: Record<string, unknown>[],
  reemplazarTodo: boolean,
): Promise<number> {
  const { data, error } = await db.rpc("reemplazar_existencias", {
    p_account_id: accountId,
    p_almacenes: almacenes,
    p_filas: filas,
    p_reemplazar_todo: reemplazarTodo,
  });
  if (error) throw new Error(`existencias: ${error.message}`);
  if (typeof data !== "number") {
    throw new Error("existencias: la base no confirmó cuántos renglones reemplazó.");
  }
  return data;
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
