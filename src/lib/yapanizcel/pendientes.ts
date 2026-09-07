/**
 * Resolutor de SKUs pendientes de YAPANIZCEL.
 *
 * En las publicaciones de Full el SKU vive en /user-products/{id}, y MELI
 * limita esa consulta a más o menos una por segundo: no cabe dentro de la
 * sincronización. Esto toma la tabla `yz_skus_pendientes`, consulta cada
 * user product UNA vez, guarda el SKU tal cual lo contesta MELI, y deja
 * bitácora en `yz_sync_log`. Lo que MELI no conteste se queda pendiente,
 * contado y visible. Nada se deduce.
 *
 * Se llama desde tres lugares: `after()` de la sincronización (en el mismo
 * proceso, sin depender de un fetch a sí mismo), el cron de cada hora, y a
 * mano con sesión.
 */
import { extraerSku } from "../meli/sync";
import { enLotes } from "../meli/client";
import type { DB } from "../datos/repos";
import { clienteDeCuenta } from "./cuenta";
import { clienteAdmin } from "../supabase/server";
import { desglosar } from "./sku";

export interface ResumenPendientes {
  cuentas: number;
  resueltos: number;
  fallidos: number;
  limpiados: number;
  restantes: number;
  ms: number;
}

/**
 * Quita de pendientes lo que la sincronización ya resolvió por otro camino
 * (el catálogo también consulta user products con su presupuesto). Sin esto
 * el contador nunca baja aunque el catálogo avance.
 */
export async function limpiarResueltos(admin: DB, accountId: string): Promise<number> {
  const { data } = await admin
    .from("yz_skus")
    .select("item_id, variation_id")
    .eq("account_id", accountId)
    .not("item_id", "is", null);
  const resueltos = data ?? [];
  let limpiados = 0;
  for (let i = 0; i < resueltos.length; i += 300) {
    const trozo = resueltos.slice(i, i + 300);
    const items = [...new Set(trozo.map((r) => r.item_id as string))];
    const { data: pend } = await admin
      .from("yz_skus_pendientes")
      .select("item_id, variation_id")
      .eq("account_id", accountId)
      .in("item_id", items);
    const claves = new Set(trozo.map((r) => `${r.item_id}#${r.variation_id ?? ""}`));
    for (const p of pend ?? []) {
      if (!claves.has(`${p.item_id}#${p.variation_id}`)) continue;
      const { error } = await admin
        .from("yz_skus_pendientes")
        .delete()
        .eq("account_id", accountId)
        .eq("item_id", p.item_id)
        .eq("variation_id", p.variation_id);
      if (!error) limpiados++;
    }
  }
  return limpiados;
}

export async function resolverPendientes(admin: DB, opts?: { presupuestoMs?: number }): Promise<ResumenPendientes> {
  const t0 = Date.now();
  const presupuesto = opts?.presupuestoMs ?? 230_000;
  const resumen: ResumenPendientes = { cuentas: 0, resueltos: 0, fallidos: 0, limpiados: 0, restantes: 0, ms: 0 };

  const { data: cuentasPend } = await admin.from("yz_skus_pendientes").select("account_id").limit(1000);
  const cuentas = [...new Set((cuentasPend ?? []).map((c) => c.account_id as string))];

  for (const accountId of cuentas) {
    resumen.cuentas++;
    try {
      resumen.limpiados += await limpiarResueltos(admin, accountId);

      const cliente = await clienteDeCuenta(admin, accountId);
      // Primero las publicaciones ACTIVAS: son las que venden y las que el
      // inventario de bodega necesita para amarrar. Las pausadas después.
      const { data: pendientes } = await admin
        .from("yz_skus_pendientes")
        .select("*")
        .eq("account_id", accountId)
        .order("estado", { ascending: true })
        .order("intentos", { ascending: true })
        .limit(2000);
      if (!pendientes?.length) continue;

      // Un user product por consulta, DOS en vuelo. Con tres MELI ya
      // contesta 429 en una de cada diez; el cliente reintenta con pausa
      // (backoff), así que un 429 suelto no tumba la consulta.
      const ups = [...new Set(pendientes.map((f) => f.user_product_id as string))];
      const skuPorUp = new Map<string, string | null>();
      await enLotes(ups, 2, async (up) => {
        if (Date.now() - t0 > presupuesto) return;
        try {
          const cuerpo = await cliente.get<{ attributes?: unknown[] }>(`/user-products/${up}`);
          skuPorUp.set(up, extraerSku(cuerpo as never));
        } catch (err) {
          skuPorUp.set(up, null);
          resumen.fallidos++;
          await admin
            .from("yz_skus_pendientes")
            .update({ intentos: 1, ultimo_error: (err as Error).message.slice(0, 300) })
            .eq("account_id", accountId)
            .eq("user_product_id", up);
        }
      });

      const filasSku: Record<string, unknown>[] = [];
      const resueltas: { item_id: string; variation_id: string }[] = [];
      const ahora = new Date().toISOString();
      for (const fila of pendientes) {
        const sku = skuPorUp.get(fila.user_product_id as string);
        if (!sku) {
          // MELI contestó pero el user product NO trae SKU: no hay nada que
          // resolver y no vale la pena volver a preguntar cada hora.
          if (skuPorUp.has(fila.user_product_id as string)) {
            await admin
              .from("yz_skus_pendientes")
              .update({ intentos: (fila.intentos ?? 0) + 1, ultimo_error: "El user product no trae SELLER_SKU." })
              .eq("account_id", accountId)
              .eq("item_id", fila.item_id)
              .eq("variation_id", fila.variation_id);
          }
          continue;
        }
        const d = desglosar(sku);
        filasSku.push({
          account_id: accountId,
          sku,
          item_id: fila.item_id,
          variation_id: fila.variation_id || null,
          inventory_id: fila.inventory_id,
          user_product_id: fila.user_product_id,
          titulo: fila.titulo ?? "",
          logistica: fila.logistica,
          estado: fila.estado,
          precio: fila.precio,
          diseno: d.diseno || null,
          modelo: d.modelo || null,
          color: d.color || null,
          publicado_en: fila.publicado_en ?? null,
          actualizado_en: ahora,
        });
        resueltas.push({ item_id: fila.item_id, variation_id: fila.variation_id });
      }

      // Dos variantes pueden traer el MISMO SKU (capturado de más en la
      // publicación). Postgres rechaza un upsert que toque dos veces el mismo
      // renglón, y un lote rechazado tiraba toda la pasada. Se deja UNA por
      // SKU (la que tenga inventory_id, luego la activa) y, si el SKU ya
      // existe de otra variante, se conserva el que ya estaba.
      const puntaje = (f: Record<string, unknown>) =>
        (f.inventory_id ? 2 : 0) + (f.estado === "active" ? 1 : 0);
      const porSku = new Map<string, Record<string, unknown>>();
      for (const f of filasSku) {
        const previa = porSku.get(f.sku as string);
        if (!previa || puntaje(f) > puntaje(previa)) porSku.set(f.sku as string, f);
      }
      const unicas = [...porSku.values()];
      for (let i = 0; i < unicas.length; i += 500) {
        const { error } = await admin
          .from("yz_skus")
          .upsert(unicas.slice(i, i + 500), { onConflict: "account_id,sku", ignoreDuplicates: true });
        if (error) throw new Error(`yz_skus: ${error.message}`);
      }
      for (const r of resueltas) {
        await admin
          .from("yz_skus_pendientes")
          .delete()
          .eq("account_id", accountId)
          .eq("item_id", r.item_id)
          .eq("variation_id", r.variation_id);
      }
      resumen.resueltos += resueltas.length;
    } catch (err) {
      await admin.from("yz_sync_log").insert({
        account_id: accountId,
        ok: false,
        detalle: { tarea: "skus_pendientes", error: (err as Error).message },
      });
    }
  }

  const { count } = await admin.from("yz_skus_pendientes").select("*", { count: "exact", head: true });
  resumen.restantes = count ?? 0;
  resumen.ms = Date.now() - t0;

  for (const accountId of cuentas) {
    await admin.from("yz_sync_log").insert({ account_id: accountId, ok: true, detalle: { tarea: "skus_pendientes", ...resumen } });
  }
  return resumen;
}

/**
 * Una pasada completa con service_role y relanzamiento: es lo que corre
 * después de contestar en la sincronización, el cron y la ruta manual.
 */
export async function correrPendientes(origen: string): Promise<void> {
  const admin = clienteAdmin();
  const r = await resolverPendientes(admin);

  // Se relanza solo mientras quede trabajo Y esté avanzando; si MELI no
  // contesta nada, mejor esperar al cron de la siguiente hora.
  const secreto = process.env.CRON_SECRET;
  if (r.restantes > 0 && r.resueltos > 0 && secreto) {
    try {
      await fetch(`${origen}/api/yapanizcel/skus-pendientes`, {
        method: "POST",
        headers: { authorization: `Bearer ${secreto}` },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      // Lo recoge el cron de la siguiente hora.
    }
  }
}
