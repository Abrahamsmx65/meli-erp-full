/**
 * Inventario de bodega amarrado a Mercado Libre.
 *
 * Junta tres cosas: lo que dice el sheet (`yz_inventario`), el catálogo de
 * MELI (`yz_skus`) y lo que el usuario ya resolvió a mano (`yz_mapeo_skus`,
 * `yz_skus_ignorados`). El resultado es, por cada SKU de bodega, a qué SKU
 * de MELI corresponde y cómo se supo — o qué candidatos hay si no se supo.
 */
import type { DB } from "../datos/repos";
import { upsertEnTandas } from "../datos/repos";
import { todo } from "./db";
import { amarrar, construirIndice, esAutomatico, type Amarre, type NivelAmarre } from "./sku";
import { descargarSheet, leerInventario, leerLibro, type ResultadoInventario } from "./sheets";

export interface RenglonBodega extends Amarre {
  hoja: string | null;
  diseno: string | null;
  modelo: string | null;
  color: string | null;
  cantidad: number;
  ignorado: boolean;
}

export interface InventarioAmarrado {
  renglones: RenglonBodega[];
  /** Unidades en bodega por SKU de MELI (solo lo amarrado). */
  porSkuMeli: Map<string, number>;
  /** Cuántos renglones (y unidades) quedaron sin amarrar, sin contar ignorados. */
  sinAmarrar: { renglones: number; unidades: number };
  /** Con sugerencia pendiente de confirmar. */
  sugeridos: number;
  niveles: Record<NivelAmarre, number>;
}

export async function cargarInventarioAmarrado(db: DB, accountId: string): Promise<InventarioAmarrado> {
  const [inventario, skus, mapeos, ignorados] = await Promise.all([
    todo<{ sku_bodega: string; hoja: string | null; diseno: string | null; modelo: string | null; color: string | null; cantidad: number }>(
      db, "yz_inventario", "sku_bodega, hoja, diseno, modelo, color, cantidad", (q) => q.eq("account_id", accountId).order("sku_bodega"),
    ),
    todo<{ sku: string }>(db, "yz_skus", "sku", (q) => q.eq("account_id", accountId)),
    todo<{ sku_bodega: string; sku_meli: string }>(db, "yz_mapeo_skus", "sku_bodega, sku_meli", (q) => q.eq("account_id", accountId)),
    todo<{ sku_bodega: string }>(db, "yz_skus_ignorados", "sku_bodega", (q) => q.eq("account_id", accountId)),
  ]);

  const indice = construirIndice(skus.map((s) => s.sku));
  const manual = new Map(mapeos.map((m) => [m.sku_bodega, m.sku_meli]));
  const setIgnorados = new Set(ignorados.map((i) => i.sku_bodega));

  const renglones: RenglonBodega[] = [];
  const porSkuMeli = new Map<string, number>();
  const niveles: Record<NivelAmarre, number> = {
    manual: 0, exacto: 0, canonico: 0, aplastado: 0, nucleo: 0, ordenado: 0, sin_amarre: 0,
  };
  let sinRenglones = 0;
  let sinUnidades = 0;
  let sugeridos = 0;

  for (const f of inventario) {
    const a = amarrar(f.sku_bodega, indice, manual);
    const ignorado = setIgnorados.has(f.sku_bodega);
    renglones.push({ ...a, hoja: f.hoja, diseno: f.diseno, modelo: f.modelo, color: f.color, cantidad: f.cantidad, ignorado });
    niveles[a.nivel]++;

    if (a.skuMeli) {
      porSkuMeli.set(a.skuMeli, (porSkuMeli.get(a.skuMeli) ?? 0) + f.cantidad);
    } else if (!ignorado) {
      sinRenglones++;
      sinUnidades += f.cantidad;
      if (!esAutomatico(a.nivel) && a.candidatos.length) sugeridos++;
      else if (a.ambiguo) sugeridos++;
    }
  }

  return { renglones, porSkuMeli, sinAmarrar: { renglones: sinRenglones, unidades: sinUnidades }, sugeridos, niveles };
}

export interface ResumenSheets {
  hojas: ResultadoInventario["hojas"];
  renglones: number;
  unidades: number;
  avisos: string[];
}

/**
 * Baja el sheet, lo lee y REEMPLAZA el inventario completo. Si el sheet se
 * leyó pero no traía nada, no se toca: un sheet vacío casi siempre es un
 * error de formato, no una bodega vacía.
 */
export async function sincronizarInventarioDesdeSheets(db: DB, accountId: string): Promise<ResumenSheets> {
  const buf = await descargarSheet();
  const hojas = await leerLibro(buf);
  const r = leerInventario(hojas);

  if (!r.filas.length) {
    throw new Error(
      "El sheet se leyó pero no se reconoció ningún renglón de inventario; no se tocó nada. " +
        r.avisos.map((a) => `${a.hoja}: ${a.mensaje}`).join(" · "),
    );
  }

  const ahora = new Date().toISOString();
  const filas = r.filas.map((f) => ({
    account_id: accountId,
    sku_bodega: f.skuBodega,
    hoja: f.hoja,
    diseno: f.diseno || null,
    modelo: f.modelo || null,
    color: f.color || null,
    cantidad: f.cantidad,
    actualizado_en: ahora,
  }));

  // Primero se escribe lo nuevo y luego se borra lo que no venga: así un
  // fallo a medio camino nunca deja la bodega en cero.
  await upsertEnTandas(db, "yz_inventario", filas, "account_id,sku_bodega");
  const { error } = await db
    .from("yz_inventario")
    .delete()
    .eq("account_id", accountId)
    .lt("actualizado_en", ahora);
  if (error) throw new Error(`No se pudo limpiar el inventario viejo: ${error.message}`);

  const avisos = r.avisos.map((a) => (a.fila ? `${a.hoja} · fila ${a.fila}: ${a.mensaje}` : `${a.hoja}: ${a.mensaje}`));
  const unidades = r.filas.reduce((a, f) => a + f.cantidad, 0);

  await db.from("yz_inventario_sync").upsert(
    { account_id: accountId, corrido_en: ahora, hojas: r.hojas.length, renglones: r.filas.length, unidades, avisos },
    { onConflict: "account_id" },
  );

  return { hojas: r.hojas, renglones: r.filas.length, unidades, avisos };
}
