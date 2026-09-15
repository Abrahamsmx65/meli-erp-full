/**
 * La pantalla de Bodega de YAPANIZCEL, ya masticada.
 *
 * Antes la página armaba sus ~18 mil renglones en cada visita: catálogo
 * completo (dos veces), stock, ventas agregadas (con la síntesis de un
 * millón de objetos que aquí ni se usa), envíos, mapeos y pedidos en camino.
 * Ahora todo eso se calcula UNA vez, se guarda en `yz_cache` ("inventario")
 * y la página lee un renglón. Lo invalidan los syncs y las escrituras; el
 * cron de netos lo deja precalculado.
 */
import type { DB } from "../datos/repos";
import { mapaCostosUnificado } from "../servicios/costos-unificados";
import { conCacheYz, recalcularCacheYz } from "./cache";
import { cargarTotalesVentas } from "./agregados";
import { cargarPedidosEnCamino } from "./compras";
import { leerParametros } from "./cuenta";
import { hoyMx, restarDias, todo } from "./db";
import { cargarEnvios } from "./envios";
import { cargarInventarioAmarrado, type InventarioAmarrado } from "./inventario";
import { agruparGemelas, principalDe, sumarPorPrincipal } from "./gemelas";
import { construirIndice, desglosar } from "./sku";

export interface RenglonInventarioYz {
  skuMeli: string;
  titulo: string | null;
  diseno: string;
  /**
   * El TIPO del diseño (Fundas / Tabletas / Micas), de la categoría
   * capturada en Productos y costos; null = sin categoría. Con él la
   * pantalla agrupa tipo → diseño → SKU sin volver a leer nada.
   */
  tipo?: string | null;
  enFull: number;
  enTransferencia: number;
  enCamino: number;
  enBodega: number;
  enCaminoChina: number;
  vendidas30: number;
  skusBodega: string[];
}

export interface InventarioPantalla {
  generadoEn: string;
  renglones: RenglonInventarioYz[];
  totalBodega: number;
  skusMeliConBodega: number;
  sinAmarrar: InventarioAmarrado["sinAmarrar"];
  sugeridos: number;
}

export async function calcularInventarioPantalla(db: DB, accountId: string): Promise<InventarioPantalla> {
  const p = await leerParametros(db, accountId);
  const hasta = restarDias(hoyMx(), 1);
  const desde = restarDias(hasta, p.diasVenta - 1);

  const [inv, skus, stock, vend, { enCamino }, mapeos, configUnificada] = await Promise.all([
    cargarInventarioAmarrado(db, accountId),
    todo<{ sku: string; titulo: string | null; estado: string | null }>(db, "yz_skus", "sku, titulo, estado", (q) => q.eq("account_id", accountId)),
    todo<{ sku: string; disponible: number; en_transferencia: number }>(db, "yz_stock_full", "sku, disponible, en_transferencia", (q) =>
      q.eq("account_id", accountId),
    ),
    // Solo los totales: la síntesis de renglones diarios aquí no se usa.
    cargarTotalesVentas(db, accountId, desde, hasta),
    cargarEnvios(db, accountId, p.diasCaducidadEnvio),
    todo<{ sku_bodega: string; sku_meli: string }>(db, "yz_mapeo_skus", "sku_bodega, sku_meli", (q) => q.eq("account_id", accountId)),
    // El TIPO de cada diseño (Fundas / Tabletas / Micas) es su categoría en
    // Productos y costos: se pega aquí, en el precálculo, no en la pantalla.
    mapaCostosUnificado(db, { yzAccountId: accountId }),
  ]);

  const china = await cargarPedidosEnCamino(db, accountId, {
    indice: construirIndice(skus.map((s) => s.sku)),
    manual: new Map(mapeos.map((m) => [m.sku_bodega, m.sku_meli])),
    porBodega: new Map(inv.renglones.map((r) => [r.skuBodega, r.skuMeli])),
  });

  // Las publicaciones gemelas (462-A57 y N-462-A57) salen como UN renglón,
  // el de la principal, con todo sumado. La bodega ya viene atribuida a la
  // principal desde el amarre.
  const gemelas = agruparGemelas(skus);
  const stockPor = new Map<string, { disponible: number; en_transferencia: number }>();
  for (const s of stock) {
    const k = principalDe(gemelas, s.sku);
    const acc = stockPor.get(k) ?? { disponible: 0, en_transferencia: 0 };
    acc.disponible += s.disponible ?? 0;
    acc.en_transferencia += s.en_transferencia ?? 0;
    stockPor.set(k, acc);
  }
  const camino = new Map<string, number>();
  for (const c of enCamino) {
    const k = principalDe(gemelas, c.skuMeli);
    camino.set(k, (camino.get(k) ?? 0) + c.unidades);
  }
  const chinaPor = sumarPorPrincipal(gemelas, china);
  const vendPor = sumarPorPrincipal(gemelas, vend);
  const bodegaPor = sumarPorPrincipal(gemelas, inv.porSkuMeli);
  const bodegaSkus = new Map<string, string[]>();
  for (const r of inv.renglones) if (r.skuMeli) bodegaSkus.set(r.skuMeli, [...(bodegaSkus.get(r.skuMeli) ?? []), r.skuBodega]);

  const renglones: RenglonInventarioYz[] = skus
    .filter((s) => principalDe(gemelas, s.sku) === s.sku)
    .map((s) => {
      const diseno = desglosar(s.sku).diseno;
      return {
      skuMeli: s.sku,
      titulo: s.titulo,
      diseno,
      tipo: configUnificada.get(diseno.toUpperCase())?.categoria ?? null,
      enFull: stockPor.get(s.sku)?.disponible ?? 0,
      enTransferencia: stockPor.get(s.sku)?.en_transferencia ?? 0,
      enCamino: camino.get(s.sku) ?? 0,
      enBodega: bodegaPor.get(s.sku) ?? 0,
      enCaminoChina: chinaPor.get(s.sku) ?? 0,
      vendidas30: vendPor.get(s.sku) ?? 0,
      skusBodega: bodegaSkus.get(s.sku) ?? [],
      };
    })
    // Un SKU con TODO en cero (sin stock en ningún lado, sin venta, sin nada
    // en camino) no dice nada en esta pantalla y son miles: solo engordaban
    // el renglón guardado y el viaje al navegador. Los totales no cambian
    // (los ceros no suman).
    .filter(
      (r) =>
        r.enFull + r.enTransferencia + r.enCamino + r.enBodega + r.enCaminoChina + r.vendidas30 > 0,
    )
    .sort((a, b) => b.vendidas30 - a.vendidas30 || a.skuMeli.localeCompare(b.skuMeli));

  return {
    generadoEn: new Date().toISOString(),
    renglones,
    totalBodega: [...inv.porSkuMeli.values()].reduce((a, b) => a + b, 0),
    skusMeliConBodega: inv.porSkuMeli.size,
    sinAmarrar: inv.sinAmarrar,
    sugeridos: inv.sugeridos,
  };
}

/** La pantalla masticada desde `yz_cache`, aunque esté vieja; solo sin renglón calcula. */
export async function obtenerInventarioPantalla(db: DB, accountId: string): Promise<InventarioPantalla> {
  return conCacheYz(db, accountId, "inventario", () => calcularInventarioPantalla(db, accountId));
}

/** Recalcula y guarda la pantalla de Bodega (lo llama el cron de netos). */
export async function recalcularInventarioPantalla(db: DB, accountId: string): Promise<InventarioPantalla> {
  return recalcularCacheYz(db, accountId, "inventario", () => calcularInventarioPantalla(db, accountId));
}

/** El amarre de bodega masticado, para la pantalla de SKUs. */
export async function obtenerInventarioAmarrado(db: DB, accountId: string): Promise<InventarioAmarrado> {
  return conCacheYz(db, accountId, "amarre", () => cargarInventarioAmarrado(db, accountId));
}

/** Recalcula y guarda el amarre (lo llama el cron de netos). */
export async function recalcularInventarioAmarrado(db: DB, accountId: string): Promise<InventarioAmarrado> {
  return recalcularCacheYz(db, accountId, "amarre", () => cargarInventarioAmarrado(db, accountId));
}
