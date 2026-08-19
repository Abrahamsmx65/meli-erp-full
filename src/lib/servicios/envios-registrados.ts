/**
 * Envíos a Full dados de alta en Mercado Libre.
 *
 * MELI no expone la Gestión de envíos por API, así que el sistema no tiene
 * forma de enterarse solo de que un envío ya se despachó — y ese hueco es
 * caro: miles de pares "confirmados" que ni descuentan bodega ni cuentan
 * como en camino, con el plan sugiriendo mandar las mismas cajas otra vez.
 *
 * La salida es un clic: la app ya sabe exactamente qué cajas trae cada envío
 * (ella los arma), así que "ya lo di de alta en MELI" registra el envío
 * completo en `envios_full`/`envio_cajas`. Desde ese momento:
 *   - sus cajas se descuentan de la disponibilidad de bodega, y
 *   - sus pares cuentan como "en camino" en la posición del plan,
 * hasta que se marque recibido (o se cierre solo a los 21 días, cuando el
 * stock de Full y el reporte de bodega ya lo reflejan por sí mismos).
 */
import type { DB } from "../datos/repos";
import type { FilaExistencia } from "../importar/excel";
import type { StockFull } from "../engine/types";
import type { EnvioSeparado } from "./envios";

/** A los cuántos días un envío en camino se da por llegado solo. */
const DIAS_AUTOCIERRE = 21;

export interface EnvioRegistrado {
  id: string;
  folio: string | null;
  bodegas: string[];
  cajas: number;
  pares: number;
  enviadoEn: string;
  detalleCajas: {
    cajaCodigo: string;
    almacen: string | null;
    skuCaja: string | null;
    pedido: string | null;
    cantidad: number;
    pares: number;
    /** aporte por SKU: [{ sku, talla, paresTotales }] */
    detalle: { sku: string; talla: string; paresTotales: number }[];
  }[];
}

export async function registrarEnvio(
  db: DB,
  accountId: string,
  envio: EnvioSeparado,
): Promise<string> {
  const { data: cabecera, error } = await db
    .from("envios_full")
    .insert({
      account_id: accountId,
      folio: null,
      bodegas: envio.almacenes,
      estado: "enviado",
      cajas: envio.totalCajas,
      pares: envio.totalPares,
      notas: `Registrado desde el plan (${envio.nombre})`,
      enviado_en: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !cabecera) {
    throw new Error(`No se pudo registrar el envío: ${error?.message ?? "sin id"}`);
  }

  const filas = envio.cajas.map((c) => ({
    envio_id: cabecera.id,
    caja_codigo: c.codigo,
    almacen: c.almacen,
    sku_caja: c.skuCaja,
    pedido: c.pedido,
    modelo: c.modelo,
    color: c.color,
    talla: c.talla,
    cantidad: c.cantidad,
    pares: c.paresTotales,
    detalle: c.aporta,
  }));
  const { error: errCajas } = await db.from("envio_cajas").insert(filas);
  if (errCajas) {
    // Sin cajas el registro no sirve: se limpia para poder reintentar.
    await db.from("envios_full").delete().eq("id", cabecera.id);
    throw new Error(`No se pudieron registrar las cajas: ${errCajas.message}`);
  }

  return cabecera.id as string;
}

export async function marcarRecibido(db: DB, envioId: string): Promise<void> {
  const { error } = await db
    .from("envios_full")
    .update({ estado: "recibido", notas: "Marcado como recibido" })
    .eq("id", envioId);
  if (error) throw new Error(error.message);
}

/**
 * Envíos que siguen en camino. De paso cierra solos los que ya pasaron del
 * plazo: para entonces el stock de Full y el reporte de bodega ya reflejan
 * la llegada, y seguirlos contando duplicaría.
 */
export async function enviosActivos(db: DB, accountId: string): Promise<EnvioRegistrado[]> {
  const corte = new Date(Date.now() - DIAS_AUTOCIERRE * 86_400_000).toISOString();
  await db
    .from("envios_full")
    .update({ estado: "recibido", notas: `Cerrado solo a los ${DIAS_AUTOCIERRE} días` })
    .eq("account_id", accountId)
    .eq("estado", "enviado")
    .lt("enviado_en", corte);

  const { data } = await db
    .from("envios_full")
    .select("id, folio, bodegas, cajas, pares, enviado_en, envio_cajas(caja_codigo, almacen, sku_caja, pedido, cantidad, pares, detalle)")
    .eq("account_id", accountId)
    .eq("estado", "enviado")
    .order("enviado_en", { ascending: false });

  return (data ?? []).map((e: any) => ({
    id: e.id,
    folio: e.folio,
    bodegas: e.bodegas ?? [],
    cajas: e.cajas ?? 0,
    pares: e.pares ?? 0,
    enviadoEn: e.enviado_en,
    detalleCajas: (e.envio_cajas ?? []).map((c: any) => ({
      cajaCodigo: c.caja_codigo,
      almacen: c.almacen,
      skuCaja: c.sku_caja,
      pedido: c.pedido,
      cantidad: c.cantidad ?? 0,
      pares: c.pares ?? 0,
      detalle: Array.isArray(c.detalle) ? c.detalle : [],
    })),
  }));
}

/**
 * Descuenta de las existencias las cajas de los envíos en camino.
 *
 * Piso en cero a propósito: si el reporte de bodega ya se volvió a importar
 * después del despacho, esas cajas ya no aparecen y no hay nada que
 * descontar. Preferimos quedarnos cortos (no sugerir) que sugerir de más.
 */
export function descontarEnviado(
  existencias: FilaExistencia[],
  envios: EnvioRegistrado[],
): void {
  for (const e of envios) {
    for (const c of e.detalleCajas) {
      let porDescontar = c.cantidad;
      for (const fila of existencias) {
        if (porDescontar <= 0) break;
        if (
          fila.almacen !== (c.almacen ?? "") ||
          fila.skuCaja !== (c.skuCaja ?? "") ||
          (fila.pedido ?? "") !== (c.pedido ?? "")
        ) {
          continue;
        }
        const quita = Math.min(porDescontar, fila.cajasDisponibles);
        fila.cajasDisponibles -= quita;
        porDescontar -= quita;
      }
    }
  }
}

/**
 * Suma a la posición del plan los pares que van en camino por envíos
 * registrados. Se toma el MÁXIMO entre lo que MELI ya reporta en tránsito y
 * lo registrado: cuando MELI recolecta, su "transfer" ES este envío — sumar
 * ambos contaría el mismo par dos veces.
 */
export function sumarEnCamino(
  stockActual: StockFull[],
  envios: EnvioRegistrado[],
): StockFull[] {
  const manual = new Map<string, number>();
  for (const e of envios) {
    for (const c of e.detalleCajas) {
      for (const d of c.detalle) {
        manual.set(d.sku, (manual.get(d.sku) ?? 0) + (d.paresTotales ?? 0));
      }
    }
  }
  if (!manual.size) return stockActual;

  const porSku = new Map(stockActual.map((s) => [s.sku, s]));
  for (const [sku, pares] of manual) {
    const s = porSku.get(sku);
    if (s) {
      s.enTransferencia = Math.max(s.enTransferencia, pares);
      s.total = s.disponible + s.enTransferencia + s.noDisponible;
    } else {
      const nuevo: StockFull = {
        sku,
        disponible: 0,
        enTransferencia: pares,
        noDisponible: 0,
        total: pares,
      };
      stockActual.push(nuevo);
      porSku.set(sku, nuevo);
    }
  }
  return stockActual;
}
