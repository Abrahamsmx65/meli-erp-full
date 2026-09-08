/**
 * Vista unificada de inventario: bodega + Full en un solo renglón por SKU.
 *
 * Hasta ahora las dos mitades vivían separadas — las existencias en cajas por
 * un lado, el stock de Mercado Libre por otro — y para saber "cuántos pares
 * tengo de este modelo, contando todo" había que cruzarlas a mano. Aquí se
 * cruzan una vez.
 */
import { construirCajas } from "../importar/cajas";
import { canonizar, construirIndice } from "../importar/sku";
import { buscarVariante, indexarCatalogo } from "../etiquetas/resolver";
import { traerTodo, type DB } from "../datos/repos";
import { VERSION_MOTOR } from "./cache";
import type { Corrida, FilaExistencia } from "../importar/excel";

/**
 * Almacén ficticio para los pedidos que ya salieron de China pero que el
 * reporte del almacén todavía no menciona. No es una bodega de México: los
 * agregados que cuentan "lo que ya está aquí" lo excluyen a propósito.
 */
export const ALMACEN_CHINA = "En camino de China";

export interface RenglonInventario {
  sku: string;
  modelo: string;
  color: string;
  talla: string;
  titulo: string | null;
  inventoryId: string | null;
  /** pares listos para vender en Full */
  enFull: number;
  /** pares viajando hacia Full */
  enTransferencia: number;
  /** pares en cajas cerradas en bodega */
  enBodega: number;
  /** pares que vienen de China */
  enCamino: number;
  total: number;
  /** de qué pedidos sale el inventario de bodega */
  pedidos: { pedido: string; almacen: string; cajas: number; pares: number }[];
  almacenes: string[];
}

export interface ResumenInventario {
  renglones: RenglonInventario[];
  totales: {
    skus: number;
    enFull: number;
    enTransferencia: number;
    enBodega: number;
    enCamino: number;
  };
  porAlmacen: { almacen: string; cajas: number; pares: number }[];
  porPedido: { pedido: string; cajas: number; pares: number; almacenes: string[] }[];
  /**
   * Cajas EXACTAS por modelo en las bodegas de México: cada caja se cuenta
   * una sola vez. Una caja de corrida trae varias tallas, pero todas del
   * mismo modelo y color, así que a nivel familia el número sí es de verdad
   * (a nivel talla no lo sería: la misma caja aparecería en cada talla).
   */
  cajasPorModelo: Record<string, number>;
  /**
   * Las tablas crudas que ya se leyeron, para que quien necesite ambas cosas
   * (la página de pedidos usa inventario Y sugerencia de compra) no vuelva a
   * pedirlas a la base: era el doble de viajes por cada clic.
   */
  crudos: { corridas: any[]; skus: any[] };
}

/**
 * Caché en memoria del proceso: cruzar bodega con Full lee seis tablas y
 * arma todas las cajas — es lo que hace lentas a Bodega y a Planificación
 * China. El resultado vive 60 segundos en la instancia: los clics seguidos
 * son instantáneos y el dato nunca envejece más de un minuto.
 */
const cacheInventario = new Map<string, { en: number; datos: ResumenInventario }>();
const VIDA_CACHE_MS = 60_000;

/**
 * Tira el caché de una cuenta. Lo llaman las rutas que cambian sus insumos
 * (importar existencias, cargar un pedido, amarrar un SKU, editar una
 * corrida): sin esto, el usuario guardaba y veía el dato viejo hasta un
 * minuto después.
 */
export function invalidarInventario(accountId: string): void {
  cacheInventario.delete(accountId);
  cacheCatalogo.delete(accountId);
}

/**
 * SOLO el catálogo de cajas de bodega (sin cruzar contra Full): lo que el
 * optimizador necesita para planear un envío. Lo usa el plan de FBA, que
 * corre sobre las MISMAS cajas físicas que el plan de Full — cada canal ve
 * todo lo disponible, y lo que un envío registrado aparta desaparece para
 * los dos en la siguiente sincronización con Industher.
 */
const cacheCatalogo = new Map<
  string,
  { en: number; datos: Awaited<ReturnType<typeof catalogoBodegaSinCache>> }
>();

export async function catalogoBodega(db: DB, accountId: string) {
  const guardado = cacheCatalogo.get(accountId);
  if (guardado && Date.now() - guardado.en < VIDA_CACHE_MS) return guardado.datos;
  const datos = await catalogoBodegaSinCache(db, accountId);
  cacheCatalogo.set(accountId, { en: Date.now(), datos });
  return datos;
}

async function catalogoBodegaSinCache(db: DB, accountId: string) {
  const eq = (q: any) => q.eq("account_id", accountId);

  const [skus, corridasRaw, existRaw, mapeoRaw, almacenesRaw] = await Promise.all([
    traerTodo<any>(db, "skus", "sku, modelo, color, talla", (q) => eq(q).eq("activo", true)),
    traerTodo<any>(db, "corridas", "pedido, modelo, color, tallas, total", eq),
    traerTodo<any>(
      db,
      "existencias",
      "almacen, codigo_almacen, sku_caja, pedido, modelo, color, talla, contenedor, cajas_fisicas, cajas_apartadas, en_camino, cajas_disponibles, pares_por_caja",
      eq,
    ),
    traerTodo<any>(db, "mapeo_sku", "sku_construido, sku_meli", eq),
    traerTodo<any>(db, "almacenes_activos", "almacen, surte_full", eq),
  ]);

  const corridas: Corrida[] = corridasRaw.map((c) => ({
    pedido: c.pedido,
    modelo: c.modelo,
    color: c.color,
    tallas: c.tallas ?? {},
    total: c.total ?? 0,
  }));

  const existencias: FilaExistencia[] = existRaw.map((e) => ({
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
  }));

  const indice = skus.length ? construirIndice(skus.map((s: any) => s.sku)) : null;
  const catalogo = construirCajas(existencias, corridas, {
    indice,
    mapeoManual: new Map(mapeoRaw.map((m: any) => [m.sku_construido, m.sku_meli])),
    almacenes: almacenesRaw.filter((a: any) => a.surte_full).map((a: any) => a.almacen),
  });

  return { catalogo, skus };
}

/** Lo que se guarda en `inventario_cache`, con la versión que lo produjo. */
interface InventarioGuardado {
  versionMotor: string;
  datos: ResumenInventario;
}

export async function cargarInventario(db: DB, accountId: string): Promise<ResumenInventario> {
  const guardado = cacheInventario.get(accountId);
  if (guardado && Date.now() - guardado.en < VIDA_CACHE_MS) return guardado.datos;

  // Primero el resultado masticado en la base (como plan_cache): lo escriben
  // recalcularInventario y el latido, y lo marca obsoleto invalidar() con
  // los mismos disparos que al plan (importar, amarres, corridas, Industher).
  try {
    const { data } = await db
      .from("inventario_cache")
      .select("datos, vigente")
      .eq("account_id", accountId)
      .maybeSingle();
    const enBase = (data?.datos ?? null) as InventarioGuardado | null;
    if (enBase?.datos && (data?.vigente ?? true) && enBase.versionMotor === VERSION_MOTOR) {
      cacheInventario.set(accountId, { en: Date.now(), datos: enBase.datos });
      return enBase.datos;
    }
  } catch {
    // Tabla aún sin migrar o error de lectura: se calcula como siempre.
  }

  return recalcularInventario(db, accountId);
}

/** Calcula la vista completa, la guarda masticada y refresca los cachés. */
export async function recalcularInventario(db: DB, accountId: string): Promise<ResumenInventario> {
  const t0 = Date.now();
  const datos = await cargarInventarioSinCache(db, accountId);
  cacheInventario.set(accountId, { en: Date.now(), datos });

  const guardado: InventarioGuardado = { versionMotor: VERSION_MOTOR, datos };
  const { error } = await db.from("inventario_cache").upsert(
    {
      account_id: accountId,
      generado_en: new Date().toISOString(),
      vigente: true,
      motivo: null,
      ms_calculo: Date.now() - t0,
      datos: guardado,
    },
    { onConflict: "account_id" },
  );
  // Sin guardar, el dato sirve igual: solo se pierde el ahorro.
  if (error) console.error("No se pudo guardar el inventario en caché:", error.message);

  return datos;
}

async function cargarInventarioSinCache(db: DB, accountId: string): Promise<ResumenInventario> {
  const eq = (q: any) => q.eq("account_id", accountId);

  const [skus, stock, corridasRaw, existRaw, mapeoRaw, almacenesRaw, pedidosVivos] = await Promise.all([
    traerTodo<any>(db, "skus", "sku, titulo, inventory_id, modelo, color, talla", (q) =>
      eq(q).eq("activo", true),
    ),
    traerTodo<any>(db, "stock_full", "sku, disponible, en_transferencia", eq),
    traerTodo<any>(db, "corridas", "pedido, modelo, color, tallas, total", eq),
    traerTodo<any>(
      db,
      "existencias",
      "almacen, codigo_almacen, sku_caja, pedido, modelo, color, talla, contenedor, cajas_fisicas, cajas_apartadas, en_camino, cajas_disponibles, pares_por_caja",
      eq,
    ),
    traerTodo<any>(db, "mapeo_sku", "sku_construido, sku_meli", eq),
    traerTodo<any>(db, "almacenes_activos", "almacen, surte_full", eq),
    // Pedidos a China que siguen vivos, con sus renglones: lo que el
    // almacén todavía no reporta cuenta aquí como "en camino".
    traerTodo<any>(
      db,
      "pedidos",
      "pedido, estado, pedido_lineas(modelo, color, tallas, cajas, pares)",
      (q) => eq(q).not("estado", "in", "(recibido,cancelado)"),
    ).catch(() => [] as any[]),
  ]);

  const corridas: Corrida[] = corridasRaw.map((c) => ({
    pedido: c.pedido,
    modelo: c.modelo,
    color: c.color,
    tallas: c.tallas ?? {},
    total: c.total ?? 0,
  }));

  const existencias: FilaExistencia[] = existRaw.map((e) => ({
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
  }));

  const indice = skus.length ? construirIndice(skus.map((s) => s.sku)) : null;
  const catalogo = construirCajas(existencias, corridas, {
    indice,
    mapeoManual: new Map(mapeoRaw.map((m) => [m.sku_construido, m.sku_meli])),
    almacenes: almacenesRaw.filter((a) => a.surte_full).map((a) => a.almacen),
  });

  // Estas cajas son EXACTAMENTE las que catalogoBodega() volvería a armar
  // leyendo las mismas tablas: se dejan servidas en su caché para que abrir
  // Bodega y luego el plan de FBA no construya el catálogo dos veces.
  cacheCatalogo.set(accountId, { en: Date.now(), datos: { catalogo, skus } });

  // --- Bodega: de cajas a pares por SKU -----------------------------------
  const bodega = new Map<
    string,
    { pares: number; enCamino: number; pedidos: Map<string, { almacen: string; cajas: number; pares: number }> }
  >();

  for (const caja of catalogo.cajas) {
    for (const item of caja.detalle) {
      const acc =
        bodega.get(item.sku) ??
        { pares: 0, enCamino: 0, pedidos: new Map() };

      acc.pares += item.piezas * caja.cajasDisponibles;
      acc.enCamino += item.piezas * caja.enCamino;

      const clave = `${caja.pedido}|${caja.almacen}`;
      const p = acc.pedidos.get(clave) ?? { almacen: caja.almacen, cajas: 0, pares: 0 };
      p.cajas += caja.cajasDisponibles;
      p.pares += item.piezas * caja.cajasDisponibles;
      acc.pedidos.set(clave, p);

      bodega.set(item.sku, acc);
    }
  }

  // --- Pedidos de China que el almacén todavía no ve -----------------------
  // El reporte del almacén es la verdad una vez que menciona un pedido (ahí
  // vienen sus cajas y su "en camino"). Pero un pedido recién cargado no
  // existe para el almacén: sus pares se suman aquí como en camino, talla
  // por talla, amarrados al SKU de MELI con los amarres de siempre.
  // El número de pedido se compara CANONIZADO: el almacén a veces lo escribe
  // con espacios o guiones ("IN 10128", "IN-10128") y una comparación literal
  // dejaría pasar el mismo pedido dos veces (una por el reporte, otra por
  // las líneas del pedido).
  const pedidosEnAlmacen = new Set(
    existRaw.map((e) => canonizar(String(e.pedido ?? ""))).filter(Boolean),
  );
  const indiceMeli = indexarCatalogo(skus);
  const pedidosEnCamino: { pedido: string; cajas: number; pares: number }[] = [];

  for (const p of pedidosVivos ?? []) {
    const numero = String(p.pedido ?? "").trim();
    if (!numero || pedidosEnAlmacen.has(canonizar(numero))) continue;

    let cajasPedido = 0;
    let paresPedido = 0;
    for (const l of p.pedido_lineas ?? []) {
      const tallas: Record<string, number> = l.tallas ?? {};
      const suma = Object.values(tallas).reduce((a, b) => a + (Number(b) || 0), 0);
      if (!suma) continue;
      // En renglones de corrida `tallas` trae pares POR CAJA y en unitallas
      // trae totales; el factor contra `pares` cubre los dos casos.
      const factor = (l.pares ?? 0) / suma;
      cajasPedido += l.cajas ?? 0;

      for (const [talla, valor] of Object.entries(tallas)) {
        const paresTalla = Math.round((Number(valor) || 0) * factor);
        if (!paresTalla) continue;
        const { construido, encontrado } = buscarVariante(indiceMeli, l.modelo, l.color ?? "", talla);
        const sku = encontrado?.sku ?? construido;

        const acc = bodega.get(sku) ?? { pares: 0, enCamino: 0, pedidos: new Map() };
        acc.enCamino += paresTalla;
        const clave = `${numero}|${ALMACEN_CHINA}`;
        const reg = acc.pedidos.get(clave) ?? { almacen: ALMACEN_CHINA, cajas: 0, pares: 0 };
        reg.pares += paresTalla;
        acc.pedidos.set(clave, reg);
        bodega.set(sku, acc);
        paresPedido += paresTalla;
      }
    }
    if (paresPedido > 0) pedidosEnCamino.push({ pedido: numero, cajas: cajasPedido, pares: paresPedido });
  }

  // --- Un renglón por SKU --------------------------------------------------
  const stockPorSku = new Map(stock.map((s) => [s.sku, s]));
  const infoSku = new Map(skus.map((s) => [s.sku, s]));

  const universo = new Set<string>([...infoSku.keys(), ...bodega.keys()]);
  const renglones: RenglonInventario[] = [];

  for (const sku of universo) {
    const info = infoSku.get(sku);
    const st = stockPorSku.get(sku);
    const bod = bodega.get(sku);

    const enFull = st?.disponible ?? 0;
    const enTransferencia = st?.en_transferencia ?? 0;
    const enBodega = bod?.pares ?? 0;
    const enCamino = bod?.enCamino ?? 0;

    // Un SKU sin nada en ningún lado y sin publicación es ruido.
    if (!info && enFull + enTransferencia + enBodega + enCamino === 0) continue;

    const pedidos = [...(bod?.pedidos.entries() ?? [])]
      .map(([clave, p]) => ({
        pedido: clave.split("|")[0] ?? "",
        almacen: p.almacen,
        cajas: p.cajas,
        pares: p.pares,
      }))
      .filter((p) => p.pares > 0)
      .sort((a, b) => b.pares - a.pares);

    renglones.push({
      sku,
      modelo: info?.modelo ?? sku.split("-")[0] ?? "",
      color: info?.color ?? "",
      talla: info?.talla ?? "",
      titulo: info?.titulo ?? null,
      inventoryId: info?.inventory_id ?? null,
      enFull,
      enTransferencia,
      enBodega,
      enCamino,
      total: enFull + enTransferencia + enBodega + enCamino,
      pedidos,
      almacenes: [...new Set(pedidos.map((p) => p.almacen))],
    });
  }

  renglones.sort((a, b) => b.total - a.total);

  // Cada caja se cuenta UNA vez, en su familia. El modelo se toma del SKU que
  // trae la caja y no del renglón del almacén: el reporte de Industher escribe
  // el modelo a su manera y la familia tiene que llamarse igual que en los
  // renglones, o la tabla mostraría familias en cero.
  const modeloDeSku = new Map(renglones.map((r) => [r.sku, r.modelo]));
  const cajasPorModelo: Record<string, number> = {};
  for (const c of catalogo.cajas) {
    if (!c.cajasDisponibles) continue;
    const sku = c.detalle[0]?.sku;
    const modelo = (sku ? modeloDeSku.get(sku) : null) ?? c.modelo;
    cajasPorModelo[modelo] = (cajasPorModelo[modelo] ?? 0) + c.cajasDisponibles;
  }

  // --- Agregados -----------------------------------------------------------
  const porAlmacen = new Map<string, { cajas: number; pares: number }>();
  const porPedido = new Map<string, { cajas: number; pares: number; almacenes: Set<string> }>();

  for (const c of catalogo.cajas) {
    const pares = c.cajasDisponibles * c.paresPorCaja;

    const a = porAlmacen.get(c.almacen) ?? { cajas: 0, pares: 0 };
    a.cajas += c.cajasDisponibles;
    a.pares += pares;
    porAlmacen.set(c.almacen, a);

    const clave = c.pedido || "(sin pedido)";
    const p = porPedido.get(clave) ?? { cajas: 0, pares: 0, almacenes: new Set<string>() };
    p.cajas += c.cajasDisponibles;
    p.pares += pares;
    p.almacenes.add(c.almacen);
    porPedido.set(clave, p);
  }

  // Los pedidos que vienen de China también se ven en la lista por pedido.
  for (const pe of pedidosEnCamino) {
    const p = porPedido.get(pe.pedido) ?? { cajas: 0, pares: 0, almacenes: new Set<string>() };
    p.cajas += pe.cajas;
    p.pares += pe.pares;
    p.almacenes.add(ALMACEN_CHINA);
    porPedido.set(pe.pedido, p);
  }

  return {
    renglones,
    totales: {
      skus: renglones.length,
      enFull: renglones.reduce((a, r) => a + r.enFull, 0),
      enTransferencia: renglones.reduce((a, r) => a + r.enTransferencia, 0),
      enBodega: renglones.reduce((a, r) => a + r.enBodega, 0),
      enCamino: renglones.reduce((a, r) => a + r.enCamino, 0),
    },
    porAlmacen: [...porAlmacen.entries()]
      .map(([almacen, v]) => ({ almacen, cajas: v.cajas, pares: v.pares }))
      .sort((a, b) => b.pares - a.pares),
    porPedido: [...porPedido.entries()]
      .map(([pedido, v]) => ({
        pedido,
        cajas: v.cajas,
        pares: v.pares,
        almacenes: [...v.almacenes].sort(),
      }))
      .sort((a, b) => b.pares - a.pares),
    cajasPorModelo,
    crudos: { corridas: corridasRaw, skus },
  };
}

/** Una talla suelta dentro de una familia. */
export interface TotalMexicoSku {
  sku: string;
  color: string;
  talla: string;
  /** pares en cajas cerradas, sumando TODAS las bodegas de México */
  pares: number;
}

/** Una familia entera (GT114, GT128…) con todo lo que hay de ella en México. */
export interface FamiliaMexico {
  modelo: string;
  /** cajas en bodega, contadas una sola vez */
  cajas: number;
  /** pares en cajas cerradas, todas las bodegas juntas */
  pares: number;
  /** cuántos colores distintos hay con existencia */
  colores: number;
  /** el desglose por talla y color, para abrir el renglón */
  detalle: TotalMexicoSku[];
}

/**
 * Lo que ya está aterrizado en México, junto por familia: GT114 va todo
 * junto, GT128 va todo junto, sin importar talla ni color. Todas las bodegas
 * suman en un solo número y lo que viene de China no entra: todavía no se
 * puede mandar a ningún lado.
 *
 * Las cajas se cuentan una sola vez porque una caja de corrida, aunque traiga
 * varias tallas, es siempre de un solo modelo. Ese es justo el número que a
 * nivel talla no se puede dar.
 */
export function familiasMexico(
  renglones: RenglonInventario[],
  cajasPorModelo: Record<string, number>,
): FamiliaMexico[] {
  const familias = new Map<string, FamiliaMexico>();

  for (const r of renglones) {
    if (r.enBodega <= 0) continue;
    const modelo = r.modelo || "(sin modelo)";
    const f =
      familias.get(modelo) ??
      { modelo, cajas: cajasPorModelo[modelo] ?? 0, pares: 0, colores: 0, detalle: [] };
    f.pares += r.enBodega;
    f.detalle.push({ sku: r.sku, color: r.color, talla: r.talla, pares: r.enBodega });
    familias.set(modelo, f);
  }

  for (const f of familias.values()) {
    f.colores = new Set(f.detalle.map((d) => d.color)).size;
    // Dentro de la familia se lee por color y luego por talla, como está el
    // producto en el rack: no por cantidad.
    f.detalle.sort(
      (a, b) =>
        a.color.localeCompare(b.color, "es") ||
        (Number(a.talla) || 0) - (Number(b.talla) || 0) ||
        a.talla.localeCompare(b.talla, "es"),
    );
  }

  return [...familias.values()].sort((a, b) => b.pares - a.pares);
}
