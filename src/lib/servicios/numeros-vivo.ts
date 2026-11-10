/**
 * Números EN VIVO para UN modelo (dueño, 8-nov-2026: «tiene que tomar la
 * info en tiempo real de MELI y de Amazon», «considerar la diferencia de
 * envío abajo y arriba de $299 en los dos marketplaces», «si juego con el
 * precio que se recalcule»). Al precio que el dueño escribe se le pregunta:
 *
 *   MELI   comisión (% y cargo fijo de los artículos baratos) a ese precio en
 *          `/sites/MLM/listing_prices` con la categoría y el tipo de la
 *          publicación, y el envío del simulador
 *          `/users/{id}/shipping_options/free` con las medidas que MELI
 *          capturó (consenso de las tallas) y `item_price` = ese precio, solo
 *          el costo CON descuento; pero si hubo ventas en ese tramo de precio,
 *          manda lo que MELI cobró en ellas (`envioMeliPorTramo`).
 *   Amazon comisión y FBA de `getMyFeesEstimateForSKU` al PVP. El PVP
 *          depende de lo que Amazon cobra y lo que cobra depende del precio
 *          (abajo de $299 la tarifa es otra), así que se vuelve a preguntar
 *          al PVP nuevo hasta que deja de moverse (4 vueltas a lo más).
 *
 * Lo que no se pudo leer se declara en `avisos` y la tabla sigue con lo de
 * 30 días para ese canal. No guarda nada: es una consulta del momento.
 */
import type { DB } from "../datos/repos";
import { traerTodo } from "../datos/repos";
import { calcularNumeros, tasasUsadas, type EntradaNumeros, type NumerosVivo } from "../finanzas/numeros";
import type { MeliClient } from "../meli/client";
import { CacheTarifas } from "../meli/pagos-api";
import { Cliente, cuentasAmazon } from "../amazon/spapi";
import { modeloDeSku } from "../precios/promociones";
import { medidaDeConsenso, preguntarTarifa, type Medida, type VarianteEnvio } from "./costos-envio";
import { mensajeMeli } from "./listados";
import { listarNumeros } from "./numeros";
import { leerCacheAppGuardado } from "./cache-app";
import { CLAVE_TARIFAS, type TarifasGuardadas } from "./tarifas-reales";
import { cuentaAmazon } from "./amazon";

const n = (x: unknown): number | null => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
const centavos = (x: number) => Math.round(x * 100) / 100;

interface FilaMedida {
  item_id: string | null;
  alto: unknown;
  ancho: unknown;
  largo: unknown;
  peso: unknown;
  tipo_publicacion: string | null;
}

/**
 * La caja del modelo como la mide MELI (consenso de las tallas), su tipo de
 * publicación y su categoría. La publicación y la categoría salen también
 * del catálogo (`skus`): un modelo sin medidas guardadas (GT074) se quedaba
 * sin categoría y `listing_prices` contestaba la tarifa genérica (18 %)
 * en vez de la de su categoría (15 %, MLM192717).
 */
async function cajaDelModelo(db: DB, accountId: string, modelo: string) {
  const filas = await traerTodo<FilaMedida>(db, "medidas_envio", "item_id, alto, ancho, largo, peso, tipo_publicacion, sku", (q) =>
    q.eq("account_id", accountId).eq("modelo", modelo),
  );
  const medidas: Medida[] = [];
  const tipos = new Map<string, number>();
  let itemId: string | null = null;
  for (const f of filas) {
    const [alto, ancho, largo, peso] = [n(f.alto), n(f.ancho), n(f.largo), n(f.peso)];
    if (alto != null && ancho != null && largo != null && peso != null) medidas.push({ alto, ancho, largo, peso });
    if (f.tipo_publicacion) tipos.set(f.tipo_publicacion, (tipos.get(f.tipo_publicacion) ?? 0) + 1);
    itemId ??= f.item_id;
  }
  const catalogo = await traerTodo<{ item_id: string | null; categoria_id: string | null }>(db, "skus", "item_id, categoria_id, sku", (q) =>
    q.eq("account_id", accountId).eq("modelo", modelo).eq("activo", true),
  );
  const categorias = new Map<string, number>();
  for (const f of catalogo) {
    if (f.categoria_id) categorias.set(f.categoria_id, (categorias.get(f.categoria_id) ?? 0) + 1);
    itemId ??= f.item_id;
  }
  const medida = medidaDeConsenso(medidas.map((medida) => ({ medida }) as VarianteEnvio)) ?? medidas[0] ?? null;
  const tipo = [...tipos].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const categoria = [...categorias].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { medida, tipo, itemId, categoria };
}

async function meliEnVivo(
  db: DB,
  cliente: MeliClient,
  accountId: string,
  meliUserId: number,
  modelo: string,
  precios: number[],
  avisos: string[],
): Promise<NumerosVivo["meli"]> {
  const caja = await cajaDelModelo(db, accountId, modelo);
  const { medida, itemId } = caja;
  let categoria: string | null = caja.categoria;
  let tipo: string | null = caja.tipo;
  if (itemId && (!categoria || !tipo)) {
    try {
      const item = await cliente.get<{ category_id?: string; listing_type_id?: string }>(`/items/${itemId}`, {
        attributes: "category_id,listing_type_id",
      });
      categoria ??= item?.category_id ?? null;
      tipo ??= item?.listing_type_id ?? null;
    } catch (err) {
      avisos.push(`MELI no contestó la categoría de ${itemId}: ${mensajeMeli(err)}`);
    }
  }
  tipo ??= "gold_special";
  if (!medida) avisos.push(`${modelo}: MELI no tiene medidas de la caja; el envío sale de lo de 30 días.`);
  if (!categoria) {
    // Sin categoría MELI contesta su tarifa genérica, que no es la del modelo.
    avisos.push(`${modelo}: no hay publicación de MELI con categoría; la comisión sale de lo de 30 días.`);
  }
  const tarifas = new CacheTarifas(cliente);
  const salida: NumerosVivo["meli"] = [];
  for (const precio of precios) {
    if (!categoria) continue;
    const t = await tarifas.tarifa(precio, categoria, tipo);
    if (!t) {
      avisos.push(`MELI no contestó la comisión a $${precio.toFixed(2)}.`);
      continue;
    }
    let envio: number | null = null;
    if (medida) {
      try {
        const r = await preguntarTarifa(cliente, meliUserId, medida, precio, tipo);
        // Solo lo que paga el vendedor con descuento: el costo de LISTA
        // ($139.50 en GT190) no es lo que MELI descuenta ($88.50).
        envio = r.costoConDescuento ?? null;
      } catch (err) {
        avisos.push(`MELI no contestó el envío a $${precio.toFixed(2)}: ${mensajeMeli(err)}`);
      }
    }
    salida.push({ precio, comisionPct: t.porcentaje / 100, fijo: t.fijo, envio });
  }
  return salida;
}

interface FeeDetalle {
  FeeType?: string;
  FinalFee?: { Amount?: number };
}

/** Comisión de Amazon (lo que va en %) y lo fijo por par (FBA y cargos por artículo) a `precio`. */
async function cargosAmazon(amz: Cliente, sku: string, precio: number): Promise<{ comision: number; fijo: number } | null> {
  const r = await amz.llamar<{
    payload?: {
      FeesEstimateResult?: {
        Status?: string;
        FeesEstimate?: { FeeDetailList?: FeeDetalle[] };
        Error?: { Message?: string };
      };
    };
  }>("POST", `/products/fees/v0/listings/${encodeURIComponent(sku)}/feesEstimate`, "getMyFeesEstimateForSKU", {
    cuerpo: {
      FeesEstimateRequest: {
        MarketplaceId: amz.cuenta.marketplaceId,
        IsAmazonFulfilled: true,
        PriceToEstimateFees: { ListingPrice: { CurrencyCode: "MXN", Amount: centavos(precio) } },
        Identifier: `numeros-${sku}-${Date.now()}`,
      },
    },
  });
  const res = r?.payload?.FeesEstimateResult;
  const lista = res?.FeesEstimate?.FeeDetailList;
  if (!res || res.Status !== "Success" || !lista) throw new Error(res?.Error?.Message ?? "Amazon no dio el estimado de comisiones.");
  let comision = 0;
  let fijo = 0;
  for (const f of lista) {
    const monto = Number(f.FinalFee?.Amount ?? 0);
    if (!Number.isFinite(monto)) continue;
    if ((f.FeeType ?? "") === "ReferralFee") comision += monto;
    else fijo += monto;
  }
  return { comision, fijo };
}

async function skuAmazonDe(admin: DB, cuentaId: string, modelo: string): Promise<string | null> {
  const filas = await traerTodo<{ seller_sku: string; estado: string | null }>(admin, "amazon_listings", "seller_sku, estado", (q) =>
    q.eq("account_id", cuentaId).ilike("seller_sku", `${modelo}-%`),
  );
  const delModelo = filas.filter((f) => modeloDeSku(f.seller_sku) === modelo);
  const activa = delModelo.find((f) => (f.estado ?? "").toLowerCase().startsWith("activ"));
  return (activa ?? delModelo[0])?.seller_sku ?? null;
}

export async function numerosEnVivo(
  db: DB,
  admin: DB,
  cliente: MeliClient,
  accountId: string,
  meliUserId: number,
  entrada: EntradaNumeros,
): Promise<NumerosVivo> {
  const modelo = entrada.modelo;
  const avisos: string[] = [];
  const guardadas = await leerCacheAppGuardado<TarifasGuardadas>(db, accountId, CLAVE_TARIFAS).catch(() => null);
  const porModelo = guardadas && guardadas.estado === "encontrado" ? guardadas.valor.datos.porModelo : {};
  const { renglones } = await listarNumeros(db, accountId, porModelo);
  const renglon = renglones.find((r) => r.entrada.modelo === modelo);
  const costo = renglon?.costo ?? null;
  const reales = renglon?.reales ?? null;

  // MELI: al relámpago y al PV normal (cada uno con su tramo de envío).
  const base = calcularNumeros(entrada, costo, reales);
  const precios = [...new Set([entrada.precioRelampago, base.pvNormal].filter((p): p is number => p != null && p > 0).map(centavos))];
  const meli = precios.length ? await meliEnVivo(db, cliente, accountId, meliUserId, modelo, precios, avisos) : [];
  const vivo: NumerosVivo = { leidoEn: new Date().toISOString(), meli, amazon: null, avisos };

  // Amazon: al PVP que deja lo mismo que el relámpago de MELI (ya con MELI en vivo).
  const conMeli = calcularNumeros(entrada, costo, reales, vivo);
  if (conMeli.recibirAmazon == null) return vivo;
  try {
    const cuenta = await cuentaAmazon(admin);
    const credenciales = cuenta ? (await cuentasAmazon(admin)).find((c) => c.accountId === (cuenta as { id: string }).id) : null;
    const sku = cuenta ? await skuAmazonDe(admin, (cuenta as { id: string }).id, modelo) : null;
    if (!credenciales) avisos.push("Amazon: la cuenta no tiene credenciales guardadas.");
    else if (!sku) avisos.push(`Amazon: ${modelo} no tiene publicación; sale con lo de 30 días.`);
    else {
      const amz = new Cliente(credenciales, Date.now() + 50_000);
      // La retención (IVA e ISR) no viene en el estimado: la de 30 días.
      const sinVivo = tasasUsadas(entrada, reales).amazon;
      const a = reales?.amazon;
      const retencion = a?.retencionPct ?? reales?.general?.amazon?.retencionPct ?? 0;
      const recibir = conMeli.recibirAmazon;
      let precio = conMeli.pvpAmazon ?? (sinVivo.pctTotal < 1 ? (recibir + (sinVivo.porPar ?? 0)) / (1 - sinVivo.pctTotal) : recibir * 1.6);
      for (let vuelta = 0; vuelta < 4; vuelta++) {
        const c = await cargosAmazon(amz, sku, precio);
        if (!c) {
          avisos.push("Amazon no contestó a tiempo.");
          break;
        }
        const comisionPct = c.comision / precio;
        vivo.amazon = { precio: centavos(precio), comisionPct, porPar: c.fijo, sku };
        const nuevo = (recibir + c.fijo) / (1 - comisionPct - retencion);
        if (!Number.isFinite(nuevo) || Math.abs(nuevo - precio) < 0.5) break;
        precio = nuevo;
      }
    }
  } catch (err) {
    avisos.push(`Amazon: ${(err as Error).message.slice(0, 300)}`);
  }
  return vivo;
}
