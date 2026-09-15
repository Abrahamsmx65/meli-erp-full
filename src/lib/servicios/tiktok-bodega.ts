/**
 * Lleva lo que Industher acumula en la bodega TikTok al kardex, como
 * ENTRADAS por diferencia. Industher no descuenta pedidos; eso lo hace el
 * kardex con los envíos confirmados de TikTok.
 *
 * Reutiliza el mismo armado de cajas que el plan de Full (`construirCajas`),
 * filtrado a la bodega de TikTok: así el amarre caja → SKU de MELI es el
 * mismo en todo el ERP y no hay dos formas de leer la misma corrida.
 */
import { traerTodo, type DB } from "../datos/repos";
import { conCacheApp } from "./cache-app";
import { construirCajas } from "../importar/cajas";
import { construirIndice } from "../importar/sku";
import type { Corrida, FilaExistencia } from "../importar/excel";
import { aliasDesdeTikTok, conciliarAcumulado, esAlmacenTikTok, paresPorSkuDesdeCajas } from "../tiktok/bodega";
import { confirmarSalidasAtribuidas, estadoSalidas3pl } from "./tiktok-3pl";
import type { Movimiento } from "../tiktok/kardex";
import { registrarMovimientos } from "./tiktok";

export interface ResultadoBodegaTikTok {
  /** cómo se llama la bodega en Industher; null si el API todavía no la reporta */
  almacen: string | null;
  fechaFoto: string | null;
  cajas: number;
  skus: number;
  pares: number;
  entradas: number;
  retiros: number;
  sinAmarre: number;
}

/**
 * Solo LEER cuántos pares por SKU reporta Industher en la bodega TikTok,
 * sin mover el kardex: para el panel de desfases y la simulación.
 */
export async function paresEnBodegaTikTok(
  db: DB,
  accountId: string,
): Promise<{ almacen: string | null; fechaFoto: string | null; pares: Map<string, number> }> {
  const eq = (q: any) => q.eq("account_id", accountId);
  const existRaw = await traerTodo<any>(
    db,
    "existencias",
    "almacen, codigo_almacen, sku_caja, pedido, modelo, color, talla, contenedor, cajas_fisicas, cajas_apartadas, en_camino, cajas_disponibles, pares_por_caja, importado_en",
    eq,
  );
  const filas = (existRaw ?? []).filter((e: any) => esAlmacenTikTok(e.almacen));
  if (!filas.length) return { almacen: null, fechaFoto: null, pares: new Map() };
  const almacen: string = filas[0].almacen;
  const fechaFoto = filas.map((e: any) => String(e.importado_en)).sort().at(-1) as string;
  const [skus, corridasRaw, mapeoRaw, ttSkus] = await Promise.all([
    traerTodo<any>(db, "skus", "sku", (q) => eq(q).eq("activo", true)),
    traerTodo<any>(db, "corridas", "pedido, modelo, color, tallas, total", eq),
    traerTodo<any>(db, "mapeo_sku", "sku_construido, sku_meli", eq),
    traerTodo<any>(db, "tiktok_skus", "seller_sku", (q) => eq(q).eq("activo", true)),
  ]);
  const corridas: Corrida[] = (corridasRaw ?? []).map((c: any) => ({ pedido: c.pedido, modelo: c.modelo, color: c.color, tallas: c.tallas ?? {}, total: c.total ?? 0 }));
  const existencias: FilaExistencia[] = filas.map((e: any) => ({
    almacen: e.almacen, codigoAlmacen: e.codigo_almacen ?? "", skuCaja: e.sku_caja, pedido: e.pedido ?? "", modelo: e.modelo, color: e.color ?? "",
    talla: e.talla, contenedor: e.contenedor ?? "", cajasFisicas: e.cajas_fisicas ?? 0, cajasApartadas: e.cajas_apartadas ?? 0, enCamino: e.en_camino ?? 0,
    cajasDisponibles: e.cajas_disponibles ?? 0, paresPorCaja: e.pares_por_caja ?? 0, paresDisponibles: 0,
  }));
  const r = construirCajas(existencias, corridas, {
    indice: skus.length ? construirIndice(skus.map((s: any) => s.sku)) : null,
    mapeoManual: new Map((mapeoRaw ?? []).map((m: any) => [m.sku_construido, m.sku_meli])),
    almacenes: [almacen],
    incluirTikTok: true,
  });
  return {
    almacen,
    fechaFoto,
    pares: paresPorSkuDesdeCajas(r.cajas, aliasDesdeTikTok((ttSkus ?? []).map((t: any) => t.seller_sku))),
  };
}

export interface EstanteTikTok {
  /** pares por SKU que reporta el 3PL; null = no hubo lectura, y entonces no se topa nada */
  pares: Map<string, number> | null;
  /** SKUs contados a mano DESPUÉS de la foto: su conteo manda sobre el 3PL */
  contadosDespues: Set<string>;
}

/**
 * El estante del 3PL para topar lo que se le publica a TikTok, masticado 15
 * min (la misma clave que usa /tiktok/desfases; la foto de Industher cambia
 * cada pocas horas). Si algo falla se devuelve `pares: null`: sin lectura no
 * se topa nada, porque un API caído no puede apagar la tienda.
 */
export async function leerEstanteTikTok(db: DB, accountId: string): Promise<EstanteTikTok> {
  const vacio: EstanteTikTok = { pares: null, contadosDespues: new Set() };
  try {
    const bodega = await conCacheApp(db, accountId, "tiktok-bodega", 15 * 60_000, () =>
      paresEnBodegaTikTok(db, accountId),
    );
    if (!bodega?.almacen || !bodega.pares) return vacio;

    let contadosDespues = new Set<string>();
    if (bodega.fechaFoto) {
      const ajustes = await traerTodo<any>(db, "tiktok_movimientos", "sku, tipo, fecha, id", (q) =>
        q.eq("account_id", accountId).eq("tipo", "ajuste").gt("fecha", bodega.fechaFoto),
      ).catch(() => []);
      contadosDespues = new Set((ajustes ?? []).map((a: any) => String(a.sku)));
    }
    return { pares: bodega.pares, contadosDespues };
  } catch {
    return vacio;
  }
}

export async function sincronizarSaldoDesdeBodega(
  db: DB,
  accountId: string,
): Promise<ResultadoBodegaTikTok> {
  const eq = (q: any) => q.eq("account_id", accountId);
  const vacio: ResultadoBodegaTikTok = {
    almacen: null,
    fechaFoto: null,
    cajas: 0,
    skus: 0,
    pares: 0,
    entradas: 0,
    retiros: 0,
    sinAmarre: 0,
  };

  const existRaw = await traerTodo<any>(
    db,
    "existencias",
    "almacen, codigo_almacen, sku_caja, pedido, modelo, color, talla, contenedor, cajas_fisicas, cajas_apartadas, en_camino, cajas_disponibles, pares_por_caja, importado_en",
    eq,
  );
  const filasTikTok = (existRaw ?? []).filter((e: any) => esAlmacenTikTok(e.almacen));
  if (!filasTikTok.length) return vacio;

  const almacen: string = filasTikTok[0].almacen;
  const fechaFoto = filasTikTok
    .map((e: any) => String(e.importado_en))
    .sort()
    .at(-1) as string;

  // La bodega de TikTok NO surte a Full, nunca. Se pisa cada vez: el RPC de
  // existencias da de alta los almacenes nuevos con surte_full = true y un
  // "solo si no existe" dejaba a TikTok surtiendo a Full (pasó en producción).
  await db
    .from("almacenes_activos")
    .upsert(
      { account_id: accountId, almacen, surte_full: false },
      { onConflict: "account_id,almacen" },
    );

  const [skus, corridasRaw, mapeoRaw, movsRaw, ttSkus] = await Promise.all([
    traerTodo<any>(db, "skus", "sku", (q) => eq(q).eq("activo", true)),
    traerTodo<any>(db, "corridas", "pedido, modelo, color, tallas, total", eq),
    traerTodo<any>(db, "mapeo_sku", "sku_construido, sku_meli", eq),
    traerTodo<any>(db, "tiktok_movimientos", "sku, tipo, cantidad, fecha, referencia, id", eq),
    traerTodo<any>(db, "tiktok_skus", "seller_sku", (q) => eq(q).eq("activo", true)),
  ]);
  const alias = aliasDesdeTikTok((ttSkus ?? []).map((t: any) => t.seller_sku));

  const corridas: Corrida[] = (corridasRaw ?? []).map((c: any) => ({
    pedido: c.pedido,
    modelo: c.modelo,
    color: c.color,
    tallas: c.tallas ?? {},
    total: c.total ?? 0,
  }));

  const existencias: FilaExistencia[] = filasTikTok.map((e: any) => ({
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

  const resultado = construirCajas(existencias, corridas, {
    indice: skus.length ? construirIndice(skus.map((s: any) => s.sku)) : null,
    mapeoManual: new Map((mapeoRaw ?? []).map((m: any) => [m.sku_construido, m.sku_meli])),
    almacenes: [almacen],
    incluirTikTok: true,
  });

  const pares = paresPorSkuDesdeCajas(resultado.cajas, alias);
  const movimientos: Movimiento[] = (movsRaw ?? []).map((m: any) => ({
    sku: m.sku,
    tipo: m.tipo,
    cantidad: m.cantidad,
    fecha: m.fecha,
    referencia: m.referencia ?? null,
  }));

  // Lo que el 3PL ya descontó por nuestra cuenta no es merma ni entrada.
  const salidas = await estadoSalidas3pl(db, accountId);
  const { movimientos: nuevos, atribuidas } = conciliarAcumulado(pares, movimientos, fechaFoto, salidas);
  if (nuevos.length) {
    await registrarMovimientos(db, accountId, nuevos);
  }
  if (atribuidas.size) {
    await confirmarSalidasAtribuidas(db, accountId, atribuidas);
  }

  return {
    almacen,
    fechaFoto,
    cajas: resultado.cajas.reduce((a, c) => a + c.cajasDisponibles + (c.cajasApartadas ?? 0), 0),
    skus: pares.size,
    pares: [...pares.values()].reduce((a, b) => a + b, 0),
    entradas: nuevos.filter((m) => m.tipo === "entrada").length,
    retiros: nuevos.filter((m) => m.tipo === "merma").length,
    sinAmarre: resultado.sinAmarre.length,
  };
}
