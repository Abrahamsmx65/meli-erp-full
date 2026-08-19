/**
 * Vista unificada de inventario: bodega + Full en un solo renglón por SKU.
 *
 * Hasta ahora las dos mitades vivían separadas — las existencias en cajas por
 * un lado, el stock de Mercado Libre por otro — y para saber "cuántos pares
 * tengo de este modelo, contando todo" había que cruzarlas a mano. Aquí se
 * cruzan una vez.
 */
import { construirCajas } from "../importar/cajas";
import { construirIndice } from "../importar/sku";
import { traerTodo, type DB } from "../datos/repos";
import type { Corrida, FilaExistencia } from "../importar/excel";

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

export async function cargarInventario(db: DB, accountId: string): Promise<ResumenInventario> {
  const guardado = cacheInventario.get(accountId);
  if (guardado && Date.now() - guardado.en < VIDA_CACHE_MS) return guardado.datos;

  const datos = await cargarInventarioSinCache(db, accountId);
  cacheInventario.set(accountId, { en: Date.now(), datos });
  return datos;
}

async function cargarInventarioSinCache(db: DB, accountId: string): Promise<ResumenInventario> {
  const eq = (q: any) => q.eq("account_id", accountId);

  const [skus, stock, corridasRaw, existRaw, mapeoRaw, almacenesRaw] = await Promise.all([
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
    crudos: { corridas: corridasRaw, skus },
  };
}
