import type { DB } from "../datos/repos";
import { Cliente, cuentasAmazon } from "../amazon/spapi";
import {
  sincronizarEnviosEntrantes,
  sincronizarHistorialInventario,
  sincronizarInventario,
  sincronizarListados,
  sincronizarPagos,
  sincronizarVentas,
} from "../amazon/sync";
import { sincronizarEconomia } from "../amazon/economia";
import { sincronizarFnskus } from "../amazon/fnskus";
import { sincronizarPadres } from "./padres-amazon";

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

    // La historia del inventario (Inventory Ledger): rellena los días que a
    // las fotos diarias les faltan, para que la corrección por agotamiento
    // vea la ventana completa. Cuando la historia ya alcanza, no pide nada.
    await paso(admin, cuenta.accountId, "cron_ledger", 55 * 60_000, async () => {
      const cliente = new Cliente(cuenta, limite);
      return sincronizarHistorialInventario(admin, cliente);
    });

    // El detalle de envíos entrantes a FBA: es lo que permite ignorar los
    // envíos atorados (sin movimiento en semanas) que el reporte de
    // inventario sigue contando como "en camino" para siempre.
    await paso(admin, cuenta.accountId, "cron_envios_fba", 55 * 60_000, async () => {
      const cliente = new Cliente(cuenta, limite);
      return sincronizarEnviosEntrantes(admin, cliente);
    });

    // Los reportes de liquidación salen cada ~2 semanas, pero revisar si hay
    // nuevos cuesta UNA llamada barata: cada 10 minutos, y el cursor evita
    // reprocesar. Así la primera carga entra en minutos, no en horas.
    await paso(admin, cuenta.accountId, "cron_pagos", 10 * 60_000, async () => {
      const cliente = new Cliente(cuenta, limite);
      return sincronizarPagos(admin, cliente);
    });

    // El catálogo de publicaciones (para la sección de contenido): qué SKUs
    // existen, cuáles siguen activos y cuál es su imagen principal. Cambia
    // poco —alguien publica o apaga algo de vez en cuando—, así que con dos
    // veces al día sobra: la frescura la decide la propia función, y aquí solo
    // se le da la oportunidad de avanzar un paso (pedir el reporte o
    // recogerlo), que es lo que hace falta para que los dos tiempos no queden
    // a medio día de distancia.
    await paso(admin, cuenta.accountId, "cron_listados", 55 * 60_000, async () => {
      const cliente = new Cliente(cuenta, limite);
      return sincronizarListados(admin, cliente);
    });

    // El FNSKU de las publicaciones que el reporte de inventario FBA no
    // trae (sin inventario: agotadas o nuevas), preguntado por SKU al API
    // de publicaciones. Solo lo que falta; al día es una consulta y se sale.
    // Cada 10 minutos: la primera carga son miles de SKUs y cada paso
    // cuesta ~7 s del presupuesto; a 600 por paso queda en un par de horas.
    // pg_cron también lo dispara cada 10 min (/api/cron/amazon?tarea=fnskus,
    // migración 0048) para que avance con la app cerrada; el mismo nombre de
    // tarea en amazon_sync_log hace que los dos no se pisen.
    await paso(admin, cuenta.accountId, "cron_fnskus", 10 * 60_000, async () => {
      const cliente = new Cliente(cuenta, limite);
      return sincronizarFnskus(admin, cliente);
    });

    // El ASIN padre de cada publicación, para que la sección de contenido
    // hable de productos y no de tallas sueltas. Resuelve por tandas y solo
    // lo que falta: cuando ya está todo resuelto, es una consulta y se sale.
    await paso(admin, cuenta.accountId, "cron_padres", 55 * 60_000, async () => {
      const cliente = new Cliente(cuenta, limite);
      return sincronizarPadres(admin, cliente);
    });

    // La economía por producto (SKU Economics vía Data Kiosk): cada paso es
    // barato (crear o recoger UNA consulta); el espaciado interno decide
    // cuándo toca refrescar (cada 6 horas).
    await paso(admin, cuenta.accountId, "cron_economia", 10 * 60_000, async () => {
      const cliente = new Cliente(cuenta, limite);
      return sincronizarEconomia(admin, cliente);
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
