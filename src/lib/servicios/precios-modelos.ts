/**
 * Lleva los precios de Números a MELI (relámpago, Buen Fin, oferta de todos
 * los días) y a Amazon (PVP deal). Motor en `precios/promociones.ts`.
 *
 * Primero se REVISA (se lee en vivo lo que cada publicación tiene hoy y se
 * enseña contra lo nuevo) y solo con la confirmación del dueño se APLICA,
 * en el orden que pidió: relámpago, Buen Fin, todos los días y al final
 * Amazon. Cada renglón regresa con el mensaje real de MELI o Amazon.
 */
import type { DB } from "../datos/repos";
import { traerTodo } from "../datos/repos";
import { calcularNumeros } from "../finanzas/numeros";
import type { MeliClient } from "../meli/client";
import { Cliente, ErrorAmazon, cuentasAmazon } from "../amazon/spapi";
import {
  modeloDeSku,
  ordenarPlan,
  planDePromo,
  redondear99,
  type Objetivos,
  type PromoMeli,
  type RenglonPromo,
} from "../precios/promociones";
import { mensajeMeli } from "./listados";
import { listarNumeros } from "./numeros";
import { leerCacheAppGuardado } from "./cache-app";
import { CLAVE_TARIFAS, type TarifasGuardadas } from "./tarifas-reales";
import { cuentaAmazon } from "./amazon";

export interface RenglonAmazon {
  sku: string;
  estado: string | null;
  actual: number | null;
  nuevo: number | null;
  accion: "cambiar" | "igual" | "sin_precio";
}

export interface RevisionPrecios {
  objetivos: Objetivos[];
  meli: RenglonPromo[];
  amazon: RenglonAmazon[];
  avisos: string[];
}

export interface ResultadoPrecio {
  donde: string;
  detalle: string;
  ok: boolean;
}

const PLAZO_MS = 240_000;

export function normalizarModelos(x: unknown): string[] {
  const lista = Array.isArray(x) ? x : String(x ?? "").split(/[\s,;]+/);
  return [...new Set(lista.map((m) => String(m).trim().toUpperCase()).filter((m) => /^[A-Z]{1,4}\d{2,5}[A-Z]?$/.test(m)))];
}

async function objetivosDe(db: DB, accountId: string, modelos: string[]): Promise<Objetivos[]> {
  const tarifas = await leerCacheAppGuardado<TarifasGuardadas>(db, accountId, CLAVE_TARIFAS).catch(() => null);
  const porModelo = tarifas && tarifas.estado === "encontrado" ? tarifas.valor.datos.porModelo : {};
  const { renglones } = await listarNumeros(db, accountId, porModelo);
  return modelos.map((modelo) => {
    const r = renglones.find((x) => x.entrada.modelo === modelo);
    if (!r) return { modelo, relampago: null, normal: null, pvpDeal: null };
    const c = calcularNumeros(r.entrada, r.costo, r.reales);
    return {
      modelo,
      relampago: r.entrada.precioRelampago,
      normal: redondear99(c.pvNormal),
      pvpDeal: redondear99(c.pvpDeal),
    };
  });
}

async function itemsDeModelos(db: DB, accountId: string, modelos: string[]): Promise<Map<string, string>> {
  const filas = await traerTodo<{ item_id: string | null; modelo: string | null }>(db, "skus", "item_id, modelo, sku", (q) =>
    q.eq("account_id", accountId).eq("activo", true).in("modelo", modelos).not("item_id", "is", null),
  );
  const items = new Map<string, string>();
  for (const f of filas) if (f.item_id && f.modelo) items.set(f.item_id, f.modelo.toUpperCase());
  return items;
}

async function promosDe(cliente: MeliClient, itemId: string): Promise<PromoMeli[]> {
  const r = await cliente.get<PromoMeli[] | { results?: PromoMeli[] }>(`/seller-promotions/items/${itemId}`, { app_version: "v2" });
  return Array.isArray(r) ? r : r?.results ?? [];
}

interface PublicacionAmazon {
  sku: string;
  estado: string | null;
  precio: number | null;
  modelo: string;
}

async function publicacionesAmazon(admin: DB, modelos: string[]): Promise<{ cuentaId: string | null; filas: PublicacionAmazon[] }> {
  const cuenta = await cuentaAmazon(admin).catch(() => null);
  if (!cuenta) return { cuentaId: null, filas: [] };
  const filas: PublicacionAmazon[] = [];
  for (const modelo of modelos) {
    const datos = await traerTodo<{ seller_sku: string; estado: string | null; precio: unknown }>(
      admin,
      "amazon_listings",
      "seller_sku, estado, precio",
      (q) => q.eq("account_id", (cuenta as { id: string }).id).ilike("seller_sku", `${modelo}-%`),
    );
    for (const d of datos) {
      if (modeloDeSku(d.seller_sku) !== modelo) continue;
      const p = Number(d.precio);
      filas.push({ sku: d.seller_sku, estado: d.estado, precio: d.precio == null || !Number.isFinite(p) ? null : p, modelo });
    }
  }
  return { cuentaId: (cuenta as { id: string }).id, filas };
}

export async function revisarPrecios(
  db: DB,
  admin: DB,
  cliente: MeliClient,
  accountId: string,
  modelos: string[],
): Promise<RevisionPrecios> {
  const avisos: string[] = [];
  const objetivos = await objetivosDe(db, accountId, modelos);
  const porModelo = new Map(objetivos.map((o) => [o.modelo, o]));
  for (const o of objetivos) {
    if (o.relampago == null) avisos.push(`${o.modelo}: no tiene precio relámpago en Números.`);
  }

  const items = await itemsDeModelos(db, accountId, modelos);
  const meli: RenglonPromo[] = [];
  for (const [itemId, modelo] of items) {
    const o = porModelo.get(modelo);
    if (!o) continue;
    try {
      for (const p of await promosDe(cliente, itemId)) meli.push({ ...planDePromo(itemId, p, o), nombre: `${modelo} · ${p.name ?? p.type ?? ""}` });
    } catch (err) {
      avisos.push(`${itemId} (${modelo}): MELI no contestó sus promociones — ${mensajeMeli(err)}`);
    }
  }

  const { filas } = await publicacionesAmazon(admin, modelos);
  const amazon: RenglonAmazon[] = filas.map((f) => {
    const nuevo = porModelo.get(f.modelo)?.pvpDeal ?? null;
    const igual = nuevo != null && f.precio != null && Math.round(f.precio * 100) === Math.round(nuevo * 100);
    return { sku: f.sku, estado: f.estado, actual: f.precio, nuevo, accion: nuevo == null ? "sin_precio" : igual ? "igual" : "cambiar" };
  });
  if (!filas.length) avisos.push("No encontré publicaciones de Amazon de estos modelos.");

  return { objetivos, meli: ordenarPlan(meli), amazon, avisos };
}

export async function aplicarPrecios(
  db: DB,
  admin: DB,
  cliente: MeliClient,
  accountId: string,
  modelos: string[],
): Promise<{ revision: RevisionPrecios; resultados: ResultadoPrecio[] }> {
  // Se relee justo antes: lo que se aplica es lo que MELI y Amazon tienen ahora.
  const revision = await revisarPrecios(db, admin, cliente, accountId, modelos);
  const resultados: ResultadoPrecio[] = [];

  for (const r of revision.meli) {
    if ((r.accion !== "cambiar" && r.accion !== "inscribir") || r.nuevo == null) continue;
    const donde = `${r.itemId} · ${r.nombre}`;
    const cuerpo: Record<string, unknown> = { promotion_type: r.tipo, deal_price: r.nuevo };
    if (r.promoId) cuerpo.promotion_id = r.promoId;
    try {
      const ruta = `/seller-promotions/items/${r.itemId}?app_version=v2`;
      if (r.accion === "cambiar") await cliente.put(ruta, cuerpo, { reintentos: 1 });
      else await cliente.post(ruta, cuerpo);
      resultados.push({ donde, ok: true, detalle: `${r.accion === "cambiar" ? "cambiado" : "inscrito"} a $${r.nuevo.toFixed(2)}` });
    } catch (err) {
      resultados.push({ donde, ok: false, detalle: mensajeMeli(err) });
    }
  }

  const porCambiar = revision.amazon.filter((a) => a.accion === "cambiar" && a.nuevo != null);
  if (porCambiar.length) {
    const cuentaId = (await publicacionesAmazon(admin, [])).cuentaId;
    const credenciales = (await cuentasAmazon(admin)).find((c) => c.accountId === cuentaId);
    if (!credenciales?.sellingPartnerId) {
      resultados.push({ donde: "Amazon", ok: false, detalle: "La cuenta de Amazon no tiene credenciales o Seller ID guardado." });
    } else {
      const amz = new Cliente(credenciales, Date.now() + PLAZO_MS);
      const base = `/listings/2021-08-01/items/${encodeURIComponent(credenciales.sellingPartnerId)}`;
      for (const a of porCambiar) {
        const donde = `Amazon ${a.sku}`;
        try {
          const ruta = `${base}/${encodeURIComponent(a.sku)}`;
          const actual = await amz.llamar<{ summaries?: { productType?: string }[] }>("GET", ruta, "getListingsItem", {
            params: { marketplaceIds: credenciales.marketplaceId, includedData: "summaries" },
          });
          const productType = actual?.summaries?.[0]?.productType;
          if (!productType) {
            resultados.push({ donde, ok: false, detalle: "Amazon no dijo el tipo de producto de la publicación." });
            continue;
          }
          const r = await amz.llamar<{ status?: string; issues?: { message?: string; severity?: string }[] }>("PATCH", ruta, "patchListingsItem", {
            params: { marketplaceIds: credenciales.marketplaceId },
            cuerpo: {
              productType,
              patches: [
                {
                  op: "replace",
                  path: "/attributes/purchasable_offer",
                  value: [
                    {
                      marketplace_id: credenciales.marketplaceId,
                      currency: "MXN",
                      our_price: [{ schedule: [{ value_with_tax: a.nuevo }] }],
                    },
                  ],
                },
              ],
            },
          });
          const errores = (r?.issues ?? []).filter((i) => (i.severity ?? "").toUpperCase() === "ERROR");
          if (!r) resultados.push({ donde, ok: false, detalle: "Amazon no contestó a tiempo." });
          else if (r.status !== "ACCEPTED" || errores.length)
            resultados.push({ donde, ok: false, detalle: errores.map((e) => e.message).join("; ") || `Amazon contestó ${r.status}` });
          else resultados.push({ donde, ok: true, detalle: `precio a $${(a.nuevo as number).toFixed(2)} (Amazon lo aplica en unos minutos)` });
        } catch (err) {
          resultados.push({ donde, ok: false, detalle: err instanceof ErrorAmazon ? err.detalle.slice(0, 300) : (err as Error).message });
        }
      }
    }
  }

  return { revision, resultados };
}
