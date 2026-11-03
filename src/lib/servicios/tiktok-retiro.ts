/**
 * Retirar SKU del almacén de TikTok (dueño, 20-oct-2026): lo disponible sale
 * del kardex como SALIDA, se le manda a Industher por el mismo endpoint de
 * salidas de los cortes (referencia `RETIRO-…`, sin corte) para que descuente
 * la caja de la bodega TikTok, y a TikTok se le publica el cero pasando por
 * `sincronizarTikTok` con `soloPedidos` (regla de oro: nunca se le escribe
 * sin leer sus pedidos). Lo apartado en pedidos no se toca.
 */
import { traerTodo, type DB } from "../datos/repos";
import { planRetiro, type PlanRetiro } from "../tiktok/retiro";
import { registrarMovimientos, sincronizarTikTok } from "./tiktok";
import { empujarSalidasAl3pl } from "./tiktok-3pl";
import { skusExternos } from "./tiktok-externos";

export interface ResultadoRetiro {
  referencia: string;
  detalle: PlanRetiro["detalle"];
  sinDisponible: string[];
  paresRetirados: number;
  avisos: string[];
}

/**
 * `cantidades` (sku → pares) descuenta solo esos pares, topados a lo
 * disponible; un SKU sin cantidad en el mapa se retira completo.
 */
export async function retirarDelAlmacenTikTok(
  admin: DB,
  accountId: string,
  skusPedidos: string[],
  usuario: string | null,
  cantidades: Record<string, number> = {},
): Promise<ResultadoRetiro> {
  const skus = [...new Set(skusPedidos.map((s) => String(s ?? "").trim()).filter(Boolean))].slice(0, 500);
  if (!skus.length) throw new Error("No se eligió ningún SKU.");

  const externos = await skusExternos(admin, accountId).catch(() => new Map<string, string>());
  const deDavid = skus.filter((s) => externos.has(s));
  if (deDavid.length) throw new Error(`Lo de David se captura en su propia pantalla: ${deDavid.join(", ")}.`);

  // El saldo y el apartado de AHORA, no los que la pantalla cargó hace un rato.
  const filas = await traerTodo<any>(admin, "tiktok_inventario", "sku, saldo, apartado, apartado_web", (q) =>
    q.eq("account_id", accountId).in("sku", skus),
  );
  const porSku = new Map((filas ?? []).map((f: any) => [String(f.sku), f]));
  const desconocidos = skus.filter((s) => !porSku.has(s));
  if (desconocidos.length) throw new Error(`Estos SKU no están en el almacén de TikTok: ${desconocidos.join(", ")}.`);

  const fecha = new Date().toISOString();
  const plan = planRetiro(
    skus.map((sku) => {
      const f = porSku.get(sku) as any;
      const cantidad = Object.prototype.hasOwnProperty.call(cantidades, sku) ? Number(cantidades[sku]) : null;
      return { sku, saldo: Number(f.saldo ?? 0), apartado: Number(f.apartado ?? 0) + Number(f.apartado_web ?? 0), cantidad };
    }),
    fecha,
  );

  const avisos: string[] = [];
  if (!plan.movimientos.length) {
    return { referencia: plan.referencia, detalle: [], sinDisponible: plan.sinDisponible, paresRetirados: 0, avisos: ["Ningún SKU tenía pares disponibles que descontar."] };
  }

  // 1. El kardex: la salida baja el saldo (lo apartado se queda).
  await registrarMovimientos(admin, accountId, plan.movimientos, usuario);

  // 2. Industher: la misma salida que la de un corte, con la referencia del
  //    retiro como «pedido». Si el endpoint falla, queda pendiente y el cron
  //    la reintenta; mientras, la conciliación la cuenta como pendiente.
  const { error: errorSalidas } = await admin.from("tiktok_salidas_3pl").upsert(
    plan.salidas3pl.map((s) => ({ account_id: accountId, corte_id: null, order_id: s.orderId, sku: s.sku, pares: s.pares })),
    { onConflict: "account_id,order_id,sku", ignoreDuplicates: true },
  );
  if (errorSalidas) throw new Error(`tiktok_salidas_3pl: ${errorSalidas.message}`);
  try {
    const r = await empujarSalidasAl3pl(admin, accountId);
    if (r.sinEndpoint) avisos.push("Industher todavía no tiene el endpoint de salidas: el retiro quedó anotado y se le manda cuando exista.");
    else if (r.error) avisos.push(`Industher: ${r.error} (el cron lo reintenta)`);
  } catch (err) {
    avisos.push(`Industher: ${(err as Error).message} (el cron lo reintenta)`);
  }

  // 3. TikTok: el disponible nuevo (cero), leyendo antes sus pedidos.
  try {
    const r = await sincronizarTikTok(admin, accountId, { soloPedidos: true, limiteMs: 120_000 });
    avisos.push(...r.avisos);
  } catch (err) {
    avisos.push(`TikTok: ${(err as Error).message} (el cron lo publica)`);
  }

  return {
    referencia: plan.referencia,
    detalle: plan.detalle,
    sinDisponible: plan.sinDisponible,
    paresRetirados: plan.detalle.reduce((a, d) => a + d.retirados, 0),
    avisos,
  };
}
