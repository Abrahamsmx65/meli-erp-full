import type { DB } from "../datos/repos";
import { Cliente, cuentasAmazon } from "../amazon/spapi";
import { sincronizarInventario, sincronizarPagos, sincronizarVentas } from "../amazon/sync";

/**
 * Amazon montado en el latido de MELI.
 *
 * La programación de pg_cron que dispararía /api/cron/amazon vive fuera del
 * repositorio y desde aquí no hay forma de garantizar que exista o siga viva.
 * El latido corre de sobra (cada 30 s con la app abierta, cada hora por el
 * webhook con la app cerrada), así que Amazon avanza montado en él con su
 * propio espaciado: ventas cada ~10 minutos, inventario cada hora. Si el
 * pg_cron sí existe, el espaciado evita que se pisen — pedir un reporte que
 * ya se pidió no duplica nada, pero sí gasta cuota.
 */
export async function latidoAmazon(admin: DB): Promise<void> {
  const cuentas = await cuentasAmazon(admin);
  if (!cuentas.length) return;

  // Vercel corta a los 300 s y el latido de MELI ya gastó parte del plazo:
  // Amazon trabaja con un presupuesto corto. Sus pasos son baratos (pedir un
  // folio, preguntar por él, descargar un archivo), así que alcanza.
  const limite = Date.now() + 45_000;

  for (const cuenta of cuentas) {
    await paso(admin, cuenta.accountId, "cron_ventas", 10 * 60_000, async () => {
      const cliente = new Cliente(cuenta, limite);
      return sincronizarVentas(admin, cliente);
    });

    await paso(admin, cuenta.accountId, "cron_inventario", 55 * 60_000, async () => {
      const cliente = new Cliente(cuenta, limite);
      return sincronizarInventario(admin, cliente);
    });

    // Los reportes de liquidación salen cada ~2 semanas: revisarlos cada 6 h
    // sobra y no gasta nada cuando no hay nuevos.
    await paso(admin, cuenta.accountId, "cron_pagos", 6 * 3_600_000, async () => {
      const cliente = new Cliente(cuenta, limite);
      return sincronizarPagos(admin, cliente);
    });
  }
}

/** Corre una tarea si no ha corrido en los últimos `cadaMs`. */
async function paso(
  admin: DB,
  accountId: string,
  tarea: string,
  cadaMs: number,
  correr: () => Promise<object>,
): Promise<void> {
  const { data: reciente } = await admin
    .from("amazon_sync_log")
    .select("id")
    .eq("account_id", accountId)
    .eq("tarea", tarea)
    .gte("inicio", new Date(Date.now() - cadaMs).toISOString())
    .limit(1);
  if (reciente?.length) return;

  const inicio = Date.now();
  const { data: corrida } = await admin
    .from("amazon_sync_log")
    .insert({ account_id: accountId, tarea, estado: "corriendo" })
    .select("id")
    .maybeSingle();

  try {
    const r = await correr();
    if (corrida?.id) {
      await admin
        .from("amazon_sync_log")
        .update({
          fin: new Date().toISOString(),
          estado: "ok",
          detalle: { ...r, ms: Date.now() - inicio, origen: "latido" },
        })
        .eq("id", corrida.id);
    }
  } catch (err) {
    if (corrida?.id) {
      await admin
        .from("amazon_sync_log")
        .update({
          fin: new Date().toISOString(),
          estado: "error",
          detalle: { error: (err as Error).message.slice(0, 1000), origen: "latido" },
        })
        .eq("id", corrida.id);
    }
  }
}
