/**
 * La vista de Bodega, ya masticada.
 *
 * Regla del dueño: la pantalla no calcula, solo presenta. Aquí se junta todo
 * lo que /inventario necesita —cifras de cabecera, inversión por categoría,
 * familias y los renglones de la tabla— en UN objeto, y la página se limita a
 * acomodarlo. Si algún día otra pantalla quiere las mismas cifras, pide esta
 * misma función y no hay dos versiones del mismo número.
 *
 * El inventario viene de `inventario_cache` (masticado por el latido). El
 * costo se cruza AQUÍ y no se guarda en esa fila a propósito: los costos se
 * editan a mano en Productos y costos, y una copia guardada quedaría vieja al
 * primer cambio sin que nadie se entere.
 */
import { cargarInventario, inversionPorCategoria, type RenglonParaCostear } from "./inventario";
import { configPorProducto } from "./productos";
import { cuentaAmazon } from "./amazon";
import { modeloUnificado } from "./costos-unificados";
import { servirConCacheApp } from "./cache-app";
import { CLAVE_TARIFAS, EDAD_TARIFAS_MS, calcularTarifasReales, type TarifasGuardadas } from "./tarifas-reales";
import { esModeloDeCalzado } from "../tiktok/publicar";
import type { InversionEnBodega } from "./inventario";
import { traerTodo, type DB } from "../datos/repos";
import type { Cronometro } from "./cronometro";

/** Lo único que la tabla de Bodega pinta: 7 campos, no los 13 del motor. */
export interface RenglonBodega {
  sku: string;
  modelo: string;
  color: string;
  talla: string;
  enBodega: number;
  enCamino: number;
  pedidos: { pedido: string; almacen: string; cajas: number; pares: number }[];
}

export interface VistaBodega {
  fichas: {
    skus: number;
    cajas: number;
    paresEnBodega: number;
    paresEnCamino: number;
    valorEnBodega: number;
    valorEnCamino: number;
    /** Pares en Full (incluye lo que va en transferencia a Full). */
    paresEnFull: number;
    /** Pares en FBA (disponible, reservado, en camino a FBA ya enviado). */
    paresEnFba: number;
    valorEnFull: number;
    valorEnFba: number;
    /** Bodega + camino + Full + FBA, a costo. */
    inversionTotal: number;
    /** Pares que no entran en el valor por no tener costo capturado. */
    paresSinCosto: number;
  };
  inversion: InversionEnBodega;
  /** Avisos de lo que no se pudo leer (FBA, depósitos de MELI). */
  avisos: string[];
  /** Desde cuándo son los depósitos de MELI usados para la ganancia. */
  depositosEn: string | null;
  /**
   * Cajas por modelo (contadas una vez) para el total por familia, que el
   * navegador arma con `familiasMexico` desde `renglones`: antes viajaba
   * aquí ya armado, con una SEGUNDA copia de cada SKU en su detalle.
   */
  cajasPorModelo: Record<string, number>;
  renglones: RenglonBodega[];
  almacenes: string[];
}

export async function vistaBodega(
  db: DB,
  accountId: string,
  reloj?: Cronometro,
): Promise<VistaBodega> {
  const medir = <T>(nombre: string, p: Promise<T>) => (reloj ? reloj.medir(nombre, p) : p);

  // sinCrudos: la fila de inventario_cache guarda también los SKUs y las
  // corridas completos (los usa Planificación China); esta vista no, y
  // bajarlos era su costo dominante.
  const avisos: string[] = [];
  const [inv, config, fba, tarifas] = await Promise.all([
    medir("inventario", cargarInventario(db, accountId, { sinCrudos: true })),
    medir("config", configPorProducto(db, accountId)),
    medir(
      "fba",
      leerFba(db).catch((err) => {
        avisos.push(`No se pudo leer el inventario de FBA: ${(err as Error).message}`);
        return [] as RenglonParaCostear[];
      }),
    ),
    medir(
      "tarifas",
      servirConCacheApp<TarifasGuardadas>(db, accountId, CLAVE_TARIFAS, EDAD_TARIFAS_MS, () =>
        calcularTarifasReales(db, accountId),
      ).catch((err) => {
        avisos.push(`No se pudo leer lo que deposita MELI por par: ${(err as Error).message}`);
        return null;
      }),
    ),
  ]);

  // Lo que MELI depositó DE VERDAD por par en 30 días (reventa incluida),
  // el mismo número de Números. Con pocas ventas el promedio no dice nada.
  const netoPorModelo = new Map<string, number>();
  for (const [modelo, t] of Object.entries(tarifas?.datos.porModelo ?? {})) {
    const m = t.meli;
    if (m?.netoPar != null && m.pares >= PARES_MINIMOS_GANANCIA) netoPorModelo.set(modelo.toUpperCase(), m.netoPar);
  }

  const paraCostear: RenglonParaCostear[] = [
    ...inv.renglones.map((r) => ({
      modelo: r.modelo,
      enBodega: r.enBodega,
      enCamino: r.enCamino,
      enFull: r.enFull + r.enTransferencia,
    })),
    ...fba,
  ];
  const inversion = inversionPorCategoria(paraCostear, config, netoPorModelo);

  return {
    fichas: {
      skus: inv.renglones.filter((r) => r.enBodega + r.enCamino > 0).length,
      cajas: inv.porAlmacen.reduce((a, x) => a + x.cajas, 0),
      paresEnBodega: inv.totales.enBodega,
      paresEnCamino: inv.totales.enCamino,
      valorEnBodega: inversion.total.enBodega,
      valorEnCamino: inversion.total.enCamino,
      paresEnFull: inv.renglones.reduce((a, r) => a + r.enFull + r.enTransferencia, 0),
      paresEnFba: fba.reduce((a, r) => a + (r.enFba ?? 0), 0),
      valorEnFull: inversion.total.enFull,
      valorEnFba: inversion.total.enFba,
      inversionTotal: inversion.total.total,
      paresSinCosto: inversion.sinCosto.pares,
    },
    inversion,
    avisos,
    depositosEn: tarifas?.generadoEn ?? null,
    cajasPorModelo: inv.cajasPorModelo,
    renglones: inv.renglones.map((r) => ({
      sku: r.sku,
      modelo: r.modelo,
      color: r.color,
      talla: r.talla,
      enBodega: r.enBodega,
      enCamino: r.enCamino,
      pedidos: r.pedidos,
    })),
    almacenes: inv.porAlmacen.map((a) => a.almacen),
  };
}

/** Con menos pares vendidos en 30 días, el depósito por par no se usa. */
export const PARES_MINIMOS_GANANCIA = 10;

/**
 * Pares de CALZADO en FBA por SKU. Cuenta lo que Amazon ya tiene (disponible,
 * reservado, no disponible, investigando, en transferencia) y lo enviado o
 * recibiéndose; NO lo «trabajando», que es un envío dado de alta cuyas cajas
 * pueden seguir en la bodega (se contaría dos veces). Las fundas y lo que no
 * es calzado de la misma cuenta se quedan fuera: esta pantalla es de calzado.
 */
async function leerFba(db: DB): Promise<RenglonParaCostear[]> {
  const cuenta = await cuentaAmazon(db);
  if (!cuenta) return [];
  const filas = await traerTodo<any>(
    db,
    "amazon_inventario",
    "seller_sku, disponible, reservado, entrante_enviado, entrante_recibiendo, en_transferencia, no_disponible, investigando",
    (q) => q.eq("account_id", cuenta.id),
  );
  const r: RenglonParaCostear[] = [];
  for (const f of filas) {
    const modelo = modeloUnificado(f.seller_sku);
    if (!esModeloDeCalzado(modelo)) continue;
    const pares =
      Number(f.disponible ?? 0) +
      Number(f.reservado ?? 0) +
      Number(f.entrante_enviado ?? 0) +
      Number(f.entrante_recibiendo ?? 0) +
      Number(f.en_transferencia ?? 0) +
      Number(f.no_disponible ?? 0) +
      Number(f.investigando ?? 0);
    if (pares > 0) r.push({ modelo, enBodega: 0, enCamino: 0, enFba: pares });
  }
  return r;
}
