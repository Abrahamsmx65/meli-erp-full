/**
 * Las FUNDAS en Existencias (dueño, 16-oct-2026: «una sección de fundas, lo
 * que hay en stock y en MELI y Amazon y lo que se gana, y sumar todo junto»).
 *
 * Mismo motor que el calzado (`inversionPorCategoria`), por DISEÑO:
 * - bodega = el sheet ya amarrado a cada SKU de MELI (pantalla de Existencias
 *   de fundas, masticada en `yz_cache`); lo que no amarra no se costea y se
 *   declara;
 * - camino = pedidos a China de fundas que aún no llegan;
 * - Full = `yz_stock_full` (disponible + en transferencia);
 * - FBA = las fundas de la cuenta de Amazon (SKU cuyo diseño empieza con
 *   número; lo demás de esa cuenta, calzado o bocinas, no entra);
 * - los envíos registrados a Full NO se suman: el sheet todavía los puede
 *   traer y se contarían dos veces.
 * El costo es el de Productos y costos (`mapaCostosUnificado`) y la ganancia
 * sale de lo que Mercado Pago depositó por pieza de cada diseño en 30 días
 * (`yz_ventas_resumen`, solo lo ya depositado); un diseño con menos de
 * `PIEZAS_MINIMAS` vendidas usa el promedio de los que sí venden.
 *
 * Se guarda masticado en `app_cache` (`CLAVE_FUNDAS`) y la pantalla lo lee.
 */
import type { DB } from "../datos/repos";
import { traerTodo } from "../datos/repos";
import { inversionPorCategoria, type InversionEnBodega, type RenglonParaCostear } from "./inventario";
import { mapaCostosUnificado, modeloUnificado } from "./costos-unificados";
import { cuentaAmazon } from "./amazon";
import { cuentaActiva as cuentaFundas } from "../yapanizcel/cuenta";
import { obtenerInventarioPantalla } from "../yapanizcel/inventario-pantalla";
import { hoyMx, restarDias, rpcTodo } from "../yapanizcel/db";
import { desglosar } from "../yapanizcel/sku";

export const CLAVE_FUNDAS = "existencias:fundas:v2";
export const EDAD_FUNDAS_MS = 15 * 60_000;
/** Con menos piezas vendidas en 30 días, el depósito por pieza no se usa. */
export const PIEZAS_MINIMAS = 10;

export interface ExistenciasFundas {
  hayCuenta: boolean;
  /** enCamino = solo pedidos marcados «en camino»; enFabrica = los «creado», que no cuentan en dinero. */
  piezas: { enBodega: number; enCamino: number; enFabrica: number; enFull: number; enFba: number };
  inversion: InversionEnBodega;
  /** Piezas del sheet que no amarran con ningún SKU de MELI: no se costean. */
  sinAmarrar: { unidades: number; renglones: number };
  avisos: string[];
}

const vacio = (): InversionEnBodega => inversionPorCategoria([], new Map());

/** Diseño de un SKU de fundas, en mayúsculas ("N-462-A57" → "462"). */
function disenoDe(sku: string): string {
  return (desglosar(sku).diseno || modeloUnificado(sku)).toUpperCase();
}

export async function calcularExistenciasFundas(db: DB): Promise<ExistenciasFundas> {
  const avisos: string[] = [];
  const cuenta = await cuentaFundas(db);
  if (!cuenta) {
    return {
      hayCuenta: false,
      piezas: { enBodega: 0, enCamino: 0, enFabrica: 0, enFull: 0, enFba: 0 },
      inversion: vacio(),
      sinAmarrar: { unidades: 0, renglones: 0 },
      avisos: [],
    };
  }

  const hasta = restarDias(hoyMx(), 1);
  const desde = restarDias(hasta, 29);
  const [pantalla, costos, ventas, fba] = await Promise.all([
    obtenerInventarioPantalla(db, cuenta.id),
    mapaCostosUnificado(db, { yzAccountId: cuenta.id }),
    rpcTodo<{ sku: string; unidades: number; neto: number; unidades_sin_neto: number }>(
      db,
      "yz_ventas_resumen",
      { p_account: cuenta.id, p_desde: desde, p_hasta: hasta },
      ["sku"],
    ).catch((err) => {
      avisos.push(`No se pudo leer lo que deposita MELI por funda: ${(err as Error).message}`);
      return [];
    }),
    leerFbaFundas(db).catch((err) => {
      avisos.push(`No se pudo leer el inventario de FBA: ${(err as Error).message}`);
      return [] as RenglonParaCostear[];
    }),
  ]);

  // Depósito real por pieza y diseño (solo lo ya depositado).
  const porDiseno = new Map<string, { piezas: number; neto: number }>();
  for (const v of ventas) {
    const conNeto = Number(v.unidades ?? 0) - Number(v.unidades_sin_neto ?? 0);
    if (conNeto <= 0) continue;
    const d = disenoDe(v.sku);
    const acc = porDiseno.get(d) ?? { piezas: 0, neto: 0 };
    acc.piezas += conNeto;
    acc.neto += Number(v.neto ?? 0);
    porDiseno.set(d, acc);
  }
  const netoPorDiseno = new Map<string, number>();
  for (const [d, x] of porDiseno) if (x.piezas >= PIEZAS_MINIMAS) netoPorDiseno.set(d, x.neto / x.piezas);

  const renglones: RenglonParaCostear[] = [
    ...pantalla.renglones.map((r) => ({
      modelo: (r.diseno || disenoDe(r.skuMeli)).toUpperCase(),
      enBodega: r.enBodega,
      // Solo lo que ya salió de la fábrica es dinero (dueño, 18-oct-2026).
      enCamino: r.enCaminoChinaEmbarcado ?? 0,
      enFull: r.enFull + r.enTransferencia,
    })),
    ...fba,
  ];
  const inversion = inversionPorCategoria(renglones, costos, netoPorDiseno);

  return {
    hayCuenta: true,
    piezas: {
      enBodega: pantalla.renglones.reduce((a, r) => a + r.enBodega, 0),
      enCamino: pantalla.renglones.reduce((a, r) => a + (r.enCaminoChinaEmbarcado ?? 0), 0),
      enFabrica: pantalla.renglones.reduce(
        (a, r) => a + Math.max(0, r.enCaminoChina - (r.enCaminoChinaEmbarcado ?? 0)),
        0,
      ),
      enFull: pantalla.renglones.reduce((a, r) => a + r.enFull + r.enTransferencia, 0),
      enFba: fba.reduce((a, r) => a + (r.enFba ?? 0), 0),
    },
    inversion,
    sinAmarrar: { unidades: pantalla.sinAmarrar.unidades, renglones: pantalla.sinAmarrar.renglones },
    avisos,
  };
}

/** Fundas en FBA: SKU de la cuenta de Amazon cuyo diseño empieza con número. */
async function leerFbaFundas(db: DB): Promise<RenglonParaCostear[]> {
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
    if (!/^\d/.test(modelo)) continue;
    const piezas =
      Number(f.disponible ?? 0) +
      Number(f.reservado ?? 0) +
      Number(f.entrante_enviado ?? 0) +
      Number(f.entrante_recibiendo ?? 0) +
      Number(f.en_transferencia ?? 0) +
      Number(f.no_disponible ?? 0) +
      Number(f.investigando ?? 0);
    if (piezas > 0) r.push({ modelo: modelo.toUpperCase(), enBodega: 0, enCamino: 0, enFba: piezas });
  }
  return r;
}
