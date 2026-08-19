import { NextResponse, after, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { registrarSync, cerrarSync, upsertEnTandas } from "@/lib/datos/repos";
import { MeliClient } from "@/lib/meli/client";
import { extraerSku, obtenerStockFull } from "@/lib/meli/sync";
import { desglosarSku } from "@/lib/servicios/sync";
import { invalidar } from "@/lib/servicios/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Resuelve los SKUs pendientes contra MELI, con el dato real.
 *
 * En las publicaciones de Full el SKU vive en /user-products/{id}, y MELI
 * limita esa consulta a más o menos una por segundo: no cabe dentro de la
 * sincronización. Este proceso toma la tabla `skus_pendientes`, consulta
 * cada producto UNA vez, guarda el SKU tal cual lo contesta MELI, y si se
 * acaba el tiempo se vuelve a lanzar solo hasta vaciar la tabla.
 *
 * Nada se deduce ni se completa por parecido: lo que MELI no conteste se
 * queda como pendiente, contado y visible.
 */
export async function POST(req: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const esCron = Boolean(secreto) && auth === `Bearer ${secreto}`;

  if (!esCron) {
    // También puede dispararlo alguien con sesión, desde la app.
    const supabase = await clienteServidor();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const origen = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;

  // Se contesta de inmediato y el trabajo corre después de responder.
  // El que dispara no puede quedarse esperando los ~4 minutos que esto puede
  // tardar, y abortar la petición antes de tiempo mataba la función en frío:
  // así fue como este proceso estuvo semanas sin correr ni una vez.
  after(() => procesar(origen));

  return NextResponse.json({ ok: true, encolado: true }, { status: 202 });
}

/**
 * Con sesión, abrir la URL en el navegador también lo enciende. Y el cron de
 * Vercel entra por aquí (los cron mandan GET con el bearer de CRON_SECRET):
 * es la red de seguridad por si el eslabón después de la sincronización no
 * prendió ese día.
 */
export async function GET(req: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const esCron = Boolean(secreto) && auth === `Bearer ${secreto}`;

  if (!esCron) {
    const supabase = await clienteServidor();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  }

  const origen = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  after(() => procesar(origen));

  const admin = clienteAdmin();
  const { count } = await admin
    .from("skus_pendientes")
    .select("*", { count: "exact", head: true });

  return NextResponse.json(
    { ok: true, encolado: true, pendientes: count ?? 0 },
    { status: 202 },
  );
}

async function procesar(origen: string): Promise<void> {
  const admin = clienteAdmin();
  const t0 = Date.now();
  const PRESUPUESTO_MS = 230_000; // deja margen dentro de los 300 s de Vercel

  const { data: cuentasPend } = await admin
    .from("skus_pendientes")
    .select("account_id")
    .limit(1000);
  const cuentas = [...new Set((cuentasPend ?? []).map((c) => c.account_id as string))];

  let resueltos = 0;
  let fallidos = 0;

  for (const accountId of cuentas) {
    // Candado: si ya hay un proceso vivo para esta cuenta, no se enciman.
    const { data: vivo } = await admin
      .from("sync_log")
      .select("id")
      .eq("account_id", accountId)
      .eq("tarea", "skus_pendientes")
      .eq("estado", "corriendo")
      .gte("inicio", new Date(Date.now() - 5 * 60_000).toISOString())
      .limit(1);
    if (vivo?.length) continue;

    const logId = await registrarSync(admin, accountId, "skus_pendientes");

    try {
      const { data: tok } = await admin
        .from("meli_tokens")
        .select("access_token, refresh_token, expira_en")
        .eq("account_id", accountId)
        .single();
      if (!tok) throw new Error("Cuenta sin tokens.");

      const { data: cuenta } = await admin
        .from("meli_accounts")
        .select("meli_user_id")
        .eq("id", accountId)
        .single();
      if (!cuenta) throw new Error("Cuenta no encontrada.");

      const cliente = new MeliClient({
        clientId: process.env.MELI_CLIENT_ID!,
        clientSecret: process.env.MELI_CLIENT_SECRET!,
        credenciales: {
          accessToken: tok.access_token,
          refreshToken: tok.refresh_token,
          expiraEn: new Date(tok.expira_en).getTime(),
        },
        alRenovar: async (c) => {
          await admin
            .from("meli_tokens")
            .update({
              access_token: c.accessToken,
              refresh_token: c.refreshToken,
              expira_en: new Date(c.expiraEn).toISOString(),
              actualizado_en: new Date().toISOString(),
            })
            .eq("account_id", accountId);
        },
      });

      const { data: pendientes } = await admin
        .from("skus_pendientes")
        .select("*")
        .eq("account_id", accountId)
        .order("intentos", { ascending: true })
        .limit(500);

      if (!pendientes?.length) {
        await cerrarSync(admin, logId, "ok", { resueltos: 0, restantes: 0 });
        continue;
      }

      // Un user product puede cubrir varias filas: se consulta una sola vez.
      const skuPorUp = new Map<string, string | null>();
      for (const fila of pendientes) {
        if (Date.now() - t0 > PRESUPUESTO_MS) break;
        const up = fila.user_product_id as string;
        if (skuPorUp.has(up)) continue;
        try {
          const cuerpo = await cliente.get<{ attributes?: unknown[] }>(`/user-products/${up}`);
          skuPorUp.set(up, extraerSku(cuerpo as never));
        } catch (err) {
          skuPorUp.set(up, null);
          await admin
            .from("skus_pendientes")
            .update({
              intentos: (fila.intentos ?? 0) + 1,
              ultimo_error: (err as Error).message.slice(0, 300),
            })
            .eq("account_id", accountId)
            .eq("item_id", fila.item_id)
            .eq("variation_id", fila.variation_id);
        }
      }

      const filasSku: Record<string, unknown>[] = [];
      const resueltas: { item_id: string; variation_id: string }[] = [];

      for (const fila of pendientes) {
        const sku = skuPorUp.get(fila.user_product_id as string);
        if (!sku) continue;
        const d = desglosarSku(sku);
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
          modelo: d.modelo,
          color: d.color,
          talla: d.talla,
          activo: true,
          actualizado_en: new Date().toISOString(),
        });
        resueltas.push({ item_id: fila.item_id, variation_id: fila.variation_id });
      }

      if (filasSku.length) {
        await upsertEnTandas(admin, "skus", filasSku, "account_id,sku");
        for (const r of resueltas) {
          await admin
            .from("skus_pendientes")
            .delete()
            .eq("account_id", accountId)
            .eq("item_id", r.item_id)
            .eq("variation_id", r.variation_id);
        }

        // El SKU sin su stock deja al producto en cero hasta la siguiente
        // sincronización: un día entero de ceguera justo en las tallas que
        // más lo necesitan. Aquí mismo se baja el stock de lo recién amarrado.
        const conInventario = filasSku
          .filter((f) => f.inventory_id)
          .map((f) => ({ sku: f.sku as string, inventoryId: f.inventory_id as string }));
        if (conInventario.length) {
          const { stock } = await obtenerStockFull(
            cliente,
            cuenta.meli_user_id,
            conInventario,
          );
          const ahora = new Date().toISOString();
          const hoy = ahora.slice(0, 10);
          await upsertEnTandas(
            admin,
            "stock_full",
            stock.map((s) => ({
              account_id: accountId,
              sku: s.sku,
              disponible: s.disponible,
              en_transferencia: s.enTransferencia,
              no_disponible: s.noDisponible,
              total: s.total,
              actualizado_en: ahora,
            })),
            "account_id,sku",
          );
          await upsertEnTandas(
            admin,
            "stock_snapshots",
            stock.map((s) => ({
              account_id: accountId,
              sku: s.sku,
              fecha: hoy,
              disponible: s.disponible,
              en_transferencia: s.enTransferencia,
              origen: "snapshot",
            })),
            "account_id,sku,fecha",
          );
        }

        await invalidar(admin, accountId, "Llegaron SKUs nuevos de Mercado Libre.");
      }

      const { count } = await admin
        .from("skus_pendientes")
        .select("*", { count: "exact", head: true })
        .eq("account_id", accountId);

      resueltos += filasSku.length;
      fallidos += [...skuPorUp.values()].filter((v) => v === null).length;

      await cerrarSync(admin, logId, "ok", {
        resueltos: filasSku.length,
        restantes: count ?? 0,
      });
    } catch (err) {
      await cerrarSync(admin, logId, "error", { mensaje: (err as Error).message });
    }
  }

  // ¿Queda trabajo? Este mismo proceso se vuelve a lanzar y sigue. La nueva
  // invocación contesta 202 al instante, así que aquí no se espera casi nada.
  const { count: restantes } = await admin
    .from("skus_pendientes")
    .select("*", { count: "exact", head: true });

  const secreto = process.env.CRON_SECRET;
  if ((restantes ?? 0) > 0 && resueltos + fallidos > 0 && secreto) {
    try {
      await fetch(`${origen}/api/meli/skus-pendientes`, {
        method: "POST",
        headers: { authorization: `Bearer ${secreto}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Si el eslabón no prende, el siguiente sync o el cron lo relanzan.
    }
  }
}
