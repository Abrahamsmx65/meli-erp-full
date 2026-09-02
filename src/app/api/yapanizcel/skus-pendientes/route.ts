import { NextResponse, after, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { extraerSku } from "@/lib/meli/sync";
import { enLotes } from "@/lib/meli/client";
import { upsertEnTandas } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/yapanizcel/cuenta";
import { esCron } from "@/lib/yapanizcel/api";
import { desglosar } from "@/lib/yapanizcel/sku";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Resuelve los SKUs pendientes de YAPANIZCEL contra /user-products, uno por
 * uno (MELI lo limita a ~1/s). Nada se deduce: lo que MELI no conteste se
 * queda pendiente y contado. Se relanza solo hasta vaciar la tabla.
 */
async function autorizado(req: NextRequest): Promise<boolean> {
  if (esCron(req)) return true;
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return Boolean(user);
}

export async function POST(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const origen = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  after(() => procesar(origen));
  return NextResponse.json({ ok: true, encolado: true }, { status: 202 });
}

export async function GET(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const origen = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  after(() => procesar(origen));
  const admin = clienteAdmin();
  const { count } = await admin.from("yz_skus_pendientes").select("*", { count: "exact", head: true });
  return NextResponse.json({ ok: true, encolado: true, pendientes: count ?? 0 }, { status: 202 });
}

async function procesar(origen: string): Promise<void> {
  const admin = clienteAdmin();
  const t0 = Date.now();
  const PRESUPUESTO_MS = 230_000;

  const { data: cuentasPend } = await admin.from("yz_skus_pendientes").select("account_id").limit(1000);
  const cuentas = [...new Set((cuentasPend ?? []).map((c) => c.account_id as string))];
  let restantes = 0;

  for (const accountId of cuentas) {
    try {
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

      // Un user product por consulta, tres en vuelo: MELI tolera eso sin
      // contestar 429 y rinde el triple que ir de uno en uno.
      const ups = [...new Set(pendientes.map((f) => f.user_product_id as string))];
      const skuPorUp = new Map<string, string | null>();
      await enLotes(ups, 3, async (up) => {
        if (Date.now() - t0 > PRESUPUESTO_MS) return;
        try {
          const cuerpo = await cliente.get<{ attributes?: unknown[] }>(`/user-products/${up}`, undefined, { reintentos: 1 });
          skuPorUp.set(up, extraerSku(cuerpo as never));
        } catch (err) {
          skuPorUp.set(up, null);
          await admin
            .from("yz_skus_pendientes")
            .update({ intentos: 1, ultimo_error: (err as Error).message.slice(0, 300) })
            .eq("account_id", accountId)
            .eq("user_product_id", up);
        }
      });

      const filasSku: Record<string, unknown>[] = [];
      const resueltas: { item_id: string; variation_id: string }[] = [];
      for (const fila of pendientes) {
        const sku = skuPorUp.get(fila.user_product_id as string);
        if (!sku) continue;
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
          actualizado_en: new Date().toISOString(),
        });
        resueltas.push({ item_id: fila.item_id, variation_id: fila.variation_id });
      }

      if (filasSku.length) await upsertEnTandas(admin, "yz_skus", filasSku, "account_id,sku");
      for (const r of resueltas) {
        await admin
          .from("yz_skus_pendientes")
          .delete()
          .eq("account_id", accountId)
          .eq("item_id", r.item_id)
          .eq("variation_id", r.variation_id);
      }
    } catch {
      // La cuenta sin tokens o con MELI caído se reintenta en la próxima.
    }
  }

  const { count } = await admin.from("yz_skus_pendientes").select("*", { count: "exact", head: true });
  restantes = count ?? 0;

  // Se relanza solo mientras quede trabajo y haya cómo autenticarse.
  const secreto = process.env.CRON_SECRET;
  if (restantes > 0 && secreto && Date.now() - t0 > 5_000) {
    try {
      await fetch(`${origen}/api/yapanizcel/skus-pendientes`, {
        method: "POST",
        headers: { authorization: `Bearer ${secreto}` },
      });
    } catch {
      // Lo recoge el cron de mañana.
    }
  }
}
