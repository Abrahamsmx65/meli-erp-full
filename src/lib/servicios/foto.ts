/**
 * La foto diaria del stock de Full.
 *
 * Es el único dato que NO se puede recuperar después: a ayer ya no se le
 * puede tomar la foto. Sin ella, el motor de demanda no MIDE los días que
 * un SKU estuvo agotado — los adivina con el patrón de ventas
 * (`inferirPorVentas`), que es circular: usa la falta de venta como prueba
 * de agotamiento y el agotamiento como razón para pedir más.
 *
 * Por eso la foto vive aparte de la sincronización grande. Antes iba en
 * medio de ella — recorrer el catálogo entero de MELI, guardar SKUs, bajar
 * órdenes, bajar movimientos, recalcular el plan — todo dentro de los 300 s
 * de Vercel. Cualquier tropiezo antes del renglón de la foto se llevaba el
 * día completo:
 *
 *   - 27 y 28 ago 2026: el upsert de `skus` reventó por llave repetida y la
 *     sincronización murió ANTES de la foto. Cero fotos esos días.
 *   - 20, 21 y 22 ago 2026: fotos a medias (491, 16 y 2 SKUs de ~2,400):
 *     se acabó el tiempo a media escritura.
 *
 * Aquí la foto no depende de nada de eso. Los `inventory_id` ya están
 * guardados en `skus`, así que ni siquiera hay que recorrer el catálogo:
 * se leen de nuestra base, se le pregunta el stock a MELI y se escribe.
 * Un puñado de segundos, sin nada que la pueda dejar a medias.
 */
import { aISO } from "../engine/fechas";
import { obtenerStockFull } from "../meli/sync";
import { cerrarSync, registrarSync, traerTodo, upsertEnTandas, type DB } from "../datos/repos";
import { clienteDeCuenta } from "./webhooks";
import type { ISODate } from "../engine/types";

/** Cuántos días para atrás se revisa que la foto no falte. */
export const DIAS_VIGILADOS = 14;

export interface ResultadoFoto {
  fecha: ISODate;
  /** SKUs activos con inventory_id: los que SE PUEDEN fotografiar */
  esperados: number;
  /** SKUs que MELI sí contestó */
  fotografiados: number;
  /** renglones escritos en stock_snapshots */
  guardados: number;
  /** true si faltó una parte: la foto quedó coja y hay que repetirla hoy */
  incompleta: boolean;
  /** días de los últimos DIAS_VIGILADOS que se quedaron sin foto */
  diasSinFoto: ISODate[];
  errores: string[];
  duracionMs: number;
}

/** El día del NEGOCIO (México, UTC-6), igual que el resto del motor. */
export function diaDeNegocio(ahora = new Date()): ISODate {
  return aISO(new Date(ahora.getTime() - 6 * 3_600_000));
}

/**
 * Una foto se da por buena cuando trae al menos esta parte de los SKUs que
 * se esperaban. Por debajo se marca incompleta: guardar 16 de 2,400 y
 * apuntarlo como "el stock del día" es peor que no tener nada, porque el
 * motor la creería.
 */
export const FRACCION_MINIMA = 0.9;

export async function tomarFotoStock(db: DB, accountId: string): Promise<ResultadoFoto> {
  const t0 = Date.now();
  const fecha = diaDeNegocio();
  const logId = await registrarSync(db, accountId, "foto");
  const errores: string[] = [];

  try {
    const cliente = await clienteDeCuenta(db, accountId);
    if (!cliente) throw new Error("Esta cuenta no tiene tokens guardados.");

    // Los inventory_id ya están en nuestra base: no hace falta recorrer el
    // catálogo de MELI, que es justo la parte lenta y frágil.
    const skus = await traerTodo<{ sku: string; inventory_id: string | null }>(
      db,
      "skus",
      "sku, inventory_id",
      (q) => q.eq("account_id", accountId).eq("activo", true).not("inventory_id", "is", null),
    );
    const esperados = skus.length;
    if (!esperados) throw new Error("No hay SKUs activos con inventory_id que fotografiar.");

    const { data: cuenta } = await db
      .from("meli_accounts")
      .select("meli_user_id")
      .eq("id", accountId)
      .single();
    if (!cuenta?.meli_user_id) throw new Error("La cuenta no tiene meli_user_id.");

    const { stock, errores: errStock } = await obtenerStockFull(
      cliente,
      cuenta.meli_user_id,
      skus.map((s) => ({ sku: s.sku, inventoryId: s.inventory_id })),
    );
    errores.push(...errStock.slice(0, 20));

    const guardados = await upsertEnTandas(
      db,
      "stock_snapshots",
      stock.map((s) => ({
        account_id: accountId,
        sku: s.sku,
        fecha,
        disponible: s.disponible,
        en_transferencia: s.enTransferencia,
        origen: "snapshot",
      })),
      "account_id,sku,fecha",
    );

    const incompleta = stock.length < esperados * FRACCION_MINIMA;
    const diasSinFoto = await diasSinFotoRecientes(db, accountId);

    const r: ResultadoFoto = {
      fecha,
      esperados,
      fotografiados: stock.length,
      guardados,
      incompleta,
      diasSinFoto,
      errores,
      duracionMs: Date.now() - t0,
    };
    await cerrarSync(db, logId, incompleta ? "error" : "ok", r as never);
    return r;
  } catch (err) {
    const mensaje = (err as Error).message;
    await cerrarSync(db, logId, "error", { mensaje, errores, fecha });
    throw err;
  }
}

/**
 * Qué días de la ventana vigilada se quedaron sin foto. Se reporta para que
 * el hueco se vea: un día perdido no se recupera, pero enterarse a tiempo
 * evita perder el siguiente.
 */
export async function diasSinFotoRecientes(db: DB, accountId: string): Promise<ISODate[]> {
  const hoy = diaDeNegocio();
  const desde = aISO(new Date(Date.now() - (DIAS_VIGILADOS + 1) * 86_400_000));

  const filas = await traerTodo<{ fecha: string }>(db, "stock_snapshots", "fecha", (q) =>
    q.eq("account_id", accountId).gte("fecha", desde).lte("fecha", hoy),
  );
  const conFoto = new Set(filas.map((f) => String(f.fecha).slice(0, 10)));

  const faltantes: ISODate[] = [];
  for (let i = 1; i <= DIAS_VIGILADOS; i++) {
    const d = aISO(new Date(Date.now() - i * 86_400_000));
    if (!conFoto.has(d)) faltantes.push(d);
  }
  return faltantes;
}
