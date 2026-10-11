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
import { aliasDesdeTikTok, conciliarAcumulado, esAlmacenTikTok, paresApartadosPorSkuDesdeCajas, paresDisponiblesPorSkuDesdeCajas, type BajaDetenida } from "../tiktok/bodega";
import { confirmarSalidasAtribuidas, estadoSalidas3pl } from "./tiktok-3pl";
import type { Movimiento } from "../tiktok/kardex";
import { registrarMovimientos } from "./tiktok";
import { skusExternos } from "./tiktok-externos";

export interface ResultadoBodegaTikTok {
  /** cómo se llama la bodega en Industher; null si el API todavía no la reporta */
  almacen: string | null;
  fechaFoto: string | null;
  cajas: number;
  skus: number;
  /** pares DISPONIBLES en el 3PL (los que entran al kardex) */
  pares: number;
  /** pares que Industher tiene APARTADOS: físicos pero no ofrecibles */
  apartadasBodega: number;
  entradas: number;
  retiros: number;
  sinAmarre: number;
  /** SKUs que se quedaron sin disponibles en la foto con pares apartados en pedidos: la baja se detuvo, no se dio de baja nada */
  detenidas: BajaDetenida[];
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
    traerTodo<any>(db, "tiktok_skus", "seller_sku, sku_interno", (q) => eq(q).eq("activo", true)),
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
    // Solo lo DISPONIBLE: lo apartado por el 3PL ya está vendido (o
    // reservado) y no se ofrece ni tapa el kardex.
    pares: paresDisponiblesPorSkuDesdeCajas(r.cajas, aliasDesdeTikTok((ttSkus ?? []).map((t: any) => ({ sellerSku: t.seller_sku, skuInterno: t.sku_interno })))),
  };
}

export interface EstanteTikTok {
  /** pares por SKU que reporta el 3PL; null = no hubo lectura, y entonces no se topa nada */
  pares: Map<string, number> | null;
  /** SKUs contados a mano DESPUÉS de la foto: su conteo manda sobre el 3PL */
  contadosDespues: Set<string>;
  /**
   * SKUs de VENDEDORES EXTERNOS (David): no viven en Industher, así que no
   * tienen estante. Para ellos la lectura siempre es «sin dato»: ni se topa
   * lo que se publica, ni la defensa los recorta, ni la alarma los juzga.
   */
  sinEstante: Set<string>;
}

/**
 * Lo que el 3PL reporta de UN SKU: null si no hubo lectura o si el SKU no
 * es de Industher (vendedor externo). Todos los que comparan kardex contra
 * estante pasan por aquí para que la regla sea una sola.
 */
export function estanteDeSku(estante: EstanteTikTok, sku: string): number | null {
  if (!estante.pares || estante.sinEstante.has(sku)) return null;
  return estante.pares.get(sku) ?? 0;
}

/**
 * El estante del 3PL para topar lo que se le publica a TikTok, masticado 15
 * min (la misma clave que usa /tiktok/desfases; la foto de Industher cambia
 * cada pocas horas). Si algo falla se devuelve `pares: null`: sin lectura no
 * se topa nada, porque un API caído no puede apagar la tienda.
 */
export async function leerEstanteTikTok(db: DB, accountId: string): Promise<EstanteTikTok> {
  const vacio: EstanteTikTok = { pares: null, contadosDespues: new Set(), sinEstante: new Set() };
  try {
    const [bodega, externos] = await Promise.all([
      conCacheApp(db, accountId, "tiktok-bodega", 15 * 60_000, () => paresEnBodegaTikTok(db, accountId)),
      skusExternos(db, accountId).catch(() => new Map<string, string>()),
    ]);
    if (!bodega?.almacen || !bodega.pares) return vacio;
    const sinEstante = new Set(externos.keys());

    let contadosDespues = new Set<string>();
    if (bodega.fechaFoto) {
      const ajustes = await traerTodo<any>(db, "tiktok_movimientos", "sku, tipo, fecha, id", (q) =>
        q.eq("account_id", accountId).eq("tipo", "ajuste").gt("fecha", bodega.fechaFoto),
      ).catch(() => []);
      contadosDespues = new Set((ajustes ?? []).map((a: any) => String(a.sku)));
    }
    return { pares: bodega.pares, contadosDespues, sinEstante };
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
    apartadasBodega: 0,
    entradas: 0,
    retiros: 0,
    sinAmarre: 0,
    detenidas: [],
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

  const [skus, corridasRaw, mapeoRaw, movsRaw, ttSkus, invRaw, externos] = await Promise.all([
    traerTodo<any>(db, "skus", "sku", (q) => eq(q).eq("activo", true)),
    traerTodo<any>(db, "corridas", "pedido, modelo, color, tallas, total", eq),
    traerTodo<any>(db, "mapeo_sku", "sku_construido, sku_meli", eq),
    traerTodo<any>(db, "tiktok_movimientos", "sku, tipo, cantidad, fecha, referencia, id", eq),
    traerTodo<any>(db, "tiktok_skus", "seller_sku, sku_interno", (q) => eq(q).eq("activo", true)),
    // Lo apartado por SKU: un SKU que desaparece del estante con pares
    // vendidos sin despachar no se da de baja, se detiene y se avisa.
    // (Lo apartado por la tienda en línea cuenta igual: también se vendió.)
    traerTodo<any>(db, "tiktok_inventario", "sku, apartado, apartado_web", (q) =>
      eq(q).or("apartado.gt.0,apartado_web.gt.0"),
    ).catch(() => []),
    // Los SKUs de vendedores externos (David) NO están en Industher: su
    // kardex se compara contra nada, ni entrada ni merma.
    skusExternos(db, accountId).catch(() => new Map<string, string>()),
  ]);
  const esExterno = (sku: unknown) => externos.has(String(sku));
  const apartados = new Map<string, number>(
    (invRaw ?? [])
      .filter((r: any) => !esExterno(r.sku))
      .map((r: any) => [String(r.sku), (Number(r.apartado) || 0) + (Number(r.apartado_web) || 0)]),
  );
  const alias = aliasDesdeTikTok((ttSkus ?? []).map((t: any) => ({ sellerSku: t.seller_sku, skuInterno: t.sku_interno })));

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

  // Solo las cajas DISPONIBLES entran al kardex: las APARTADAS por Industher
  // son salidas que el ERP ya descontó (o pares que el 3PL reservó) y
  // contarlas los volvía a meter como «entrada» (GT114-LT BROWN-28-MX,
  // 29-sep-2026). Lo apartado solo sirve para explicar la baja.
  const pares = paresDisponiblesPorSkuDesdeCajas(resultado.cajas, alias);
  const apartadasBodega = paresApartadosPorSkuDesdeCajas(resultado.cajas, alias);
  for (const sku of [...pares.keys()]) if (esExterno(sku)) pares.delete(sku);
  for (const sku of [...apartadasBodega.keys()]) if (esExterno(sku)) apartadasBodega.delete(sku);
  const movimientos: Movimiento[] = (movsRaw ?? []).filter((m: any) => !esExterno(m.sku)).map((m: any) => ({
    sku: m.sku,
    tipo: m.tipo,
    cantidad: m.cantidad,
    fecha: m.fecha,
    referencia: m.referencia ?? null,
  }));

  // Lo que el 3PL ya descontó por nuestra cuenta no es merma ni entrada.
  const salidas = await estadoSalidas3pl(db, accountId);
  const { movimientos: nuevos, atribuidas, detenidas } = conciliarAcumulado(pares, movimientos, fechaFoto, salidas, apartados, apartadasBodega);
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
    apartadasBodega: [...apartadasBodega.values()].reduce((a, b) => a + b, 0),
    entradas: nuevos.filter((m) => m.tipo === "entrada").length,
    retiros: nuevos.filter((m) => m.tipo === "merma").length,
    sinAmarre: resultado.sinAmarre.length,
    detenidas,
  };
}
