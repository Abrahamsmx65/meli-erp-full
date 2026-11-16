/**
 * Guardia de ofertas de MELI (calzado): recorre TODAS las publicaciones de
 * los modelos de Números, una por una (la lista por campaña de MELI viene
 * incompleta), y quita la oferta activa o programada que no cumple el precio
 * (`incumplePrecio`). Bitácora `sync_log` tarea `guardia-ofertas`.
 */
import type { DB } from "../datos/repos";
import { traerTodo } from "../datos/repos";
import { enLotes, type MeliClient } from "../meli/client";
import { folioDeOferta, incumplePrecio, type Objetivos, type PromoMeli } from "../precios/promociones";
import { bitacoraCalzado } from "./bitacora-ofertas";
import { mensajeMeli } from "./listados";
import { normalizarModelos, objetivosDe, promosDe } from "./precios-modelos";
import { leerCacheAppGuardado } from "./cache-app";

/**
 * Modelos que la guardia NO toca (`app_cache` clave `guardia-ofertas:config`,
 * `{ modelosLibres: ["GT134", …] }`): el dueño los quiere en relámpago abajo
 * del precio de Números a propósito (16-nov-2026: GT134, GT161, MY2307,
 * GT130, GT215 y GT154, «al precio bajo que tenían»).
 */
export const CLAVE_GUARDIA = "guardia-ofertas:config";

async function modelosLibres(admin: DB, accountId: string): Promise<Set<string>> {
  const r = await leerCacheAppGuardado<{ modelosLibres?: unknown }>(admin, accountId, CLAVE_GUARDIA).catch(() => null);
  const lista = r && r.estado === "encontrado" ? r.valor.datos.modelosLibres : null;
  return new Set(Array.isArray(lista) ? lista.map((m) => String(m).trim().toUpperCase()).filter(Boolean) : []);
}

export const TAREA_GUARDIA = "guardia-ofertas";

export interface OfertaQuitada {
  itemId: string;
  modelo: string;
  tipo: string;
  nombre: string;
  estado: string;
  motivo: string;
  ok: boolean;
  error: string | null;
}

export interface ResultadoGuardia {
  publicaciones: number;
  sinLeer: number;
  quitadas: OfertaQuitada[];
  fallidas: OfertaQuitada[];
}

export async function guardiaDeOfertas(
  admin: DB,
  cliente: MeliClient,
  accountId: string,
  origen: "cron" | "manual" = "cron",
  limiteMs = 700_000,
): Promise<ResultadoGuardia> {
  const inicio = Date.now();
  const filas = await traerTodo<{ modelo: string }>(admin, "numeros_modelos", "modelo", (q) => q.eq("account_id", accountId));
  const modelos = normalizarModelos(filas.map((f) => f.modelo));
  const objetivos = new Map<string, Objetivos>((await objetivosDe(admin, accountId, modelos)).map((o) => [o.modelo, o]));
  // Todas las publicaciones, también las pausadas: una oferta programada en
  // una publicación pausada arranca en cuanto se reactiva.
  const skus = await traerTodo<{ item_id: string | null; modelo: string | null }>(admin, "skus", "item_id, modelo, sku", (q) =>
    q.eq("account_id", accountId).not("item_id", "is", null),
  );
  const libres = await modelosLibres(admin, accountId);
  const items = new Map<string, string>();
  for (const f of skus) {
    const modelo = (f.modelo ?? "").toUpperCase();
    if (f.item_id && objetivos.has(modelo) && !libres.has(modelo)) items.set(f.item_id, modelo);
  }
  const quitadas: OfertaQuitada[] = [];
  const fallidas: OfertaQuitada[] = [];
  let sinLeer = 0;
  let revisadas = 0;
  await enLotes([...items], 5, async ([itemId, modelo]) => {
    if (Date.now() - inicio > limiteMs) {
      sinLeer++;
      return;
    }
    let promos: PromoMeli[];
    try {
      promos = await promosDe(cliente, itemId);
    } catch {
      sinLeer++;
      return;
    }
    revisadas++;
    const o = objetivos.get(modelo) as Objetivos;
    for (const p of promos) {
      const mal = incumplePrecio(p, o);
      if (!mal) continue;
      const base: OfertaQuitada = {
        itemId,
        modelo,
        tipo: p.type ?? "",
        nombre: p.name || p.type || "",
        estado: p.status ?? "",
        motivo: mal.motivo,
        ok: true,
        error: null,
      };
      const q = new URLSearchParams({
        app_version: "v2",
        promotion_type: p.type ?? "",
        promotion_id: p.id ?? "",
        offer_id: folioDeOferta(p) ?? "",
      });
      try {
        await cliente.borrar(`/seller-promotions/items/${itemId}?${q.toString()}`);
        quitadas.push(base);
      } catch (err) {
        fallidas.push({ ...base, ok: false, error: mensajeMeli(err) });
      }
    }
  });
  await bitacoraCalzado(admin, accountId).anotar(TAREA_GUARDIA, fallidas.length ? "error" : "ok", {
    origen,
    modelosLibres: [...libres],
    publicaciones: revisadas,
    sinLeer,
    quitadas,
    fallidas,
  });
  return { publicaciones: revisadas, sinLeer, quitadas, fallidas };
}
