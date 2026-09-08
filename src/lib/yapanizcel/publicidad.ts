/**
 * Product Ads de la cuenta de fundas, por DISEÑO.
 *
 * Mismo API que el calzado (servicios/publicidad.ts): el advertiser de la
 * cuenta y sus anuncios con gasto en el periodo. Los anuncios son por
 * publicación; cada publicación amarra a los diseños de sus variantes
 * (yz_skus.diseno) y el gasto se reparte parejo entre ellos. Lo que no
 * amarra se reporta aparte, nunca se tira.
 */
import type { DB } from "../datos/repos";
import { MeliError } from "../meli/client";
import { resolverAdvertiser, traerAnunciosAds } from "../servicios/publicidad";
import { clienteAdmin } from "../supabase/server";
import { clienteDeCuenta, type CuentaYz } from "./cuenta";
import { todo } from "./db";
import { desglosar } from "./sku";

export interface AdsPorDiseno {
  porDiseno: Map<string, number>;
  sinAmarre: number;
  error: string | null;
}

export async function adsPorDiseno(db: DB, cuenta: CuentaYz, rango: { desde: string; hasta: string }): Promise<AdsPorDiseno> {
  const salida: AdsPorDiseno = { porDiseno: new Map(), sinAmarre: 0, error: null };
  let cliente;
  try {
    // Los tokens viven en yz_tokens, con RLS y cero políticas: SOLO el
    // service role los lee. Con el cliente de la sesión la cuenta "no
    // estaba conectada" aunque sí lo estuviera.
    cliente = await clienteDeCuenta(clienteAdmin(), cuenta.id);
  } catch (err) {
    salida.error = (err as Error).message;
    return salida;
  }
  const skus = await todo<{ sku: string; item_id: string | null; diseno: string | null }>(db, "yz_skus", "sku, item_id, diseno", (q) =>
    q.eq("account_id", cuenta.id).not("item_id", "is", null),
  );
  const disenosDeItem = new Map<string, Set<string>>();
  for (const s of skus) {
    if (!s.item_id) continue;
    const d = (s.diseno ?? desglosar(s.sku).diseno).toUpperCase();
    if (!d) continue;
    const set = disenosDeItem.get(s.item_id) ?? new Set<string>();
    set.add(d);
    disenosDeItem.set(s.item_id, set);
  }
  try {
    const adv = await resolverAdvertiser(cliente, cuenta.site_id);
    const anuncios = await traerAnunciosAds(cliente, adv, rango);
    for (const a of anuncios) {
      if (!(a.gasto > 0)) continue;
      const disenos = [...(disenosDeItem.get(a.itemId) ?? [])];
      if (!disenos.length) {
        salida.sinAmarre += a.gasto;
        continue;
      }
      for (const d of disenos) salida.porDiseno.set(d, (salida.porDiseno.get(d) ?? 0) + a.gasto / disenos.length);
    }
  } catch (err) {
    salida.error =
      err instanceof MeliError && err.status === 403
        ? "MELI negó el acceso a Product Ads (403): reconecta la cuenta de fundas en Ajustes para otorgar el permiso de publicidad."
        : (err as Error).message;
  }
  return salida;
}
