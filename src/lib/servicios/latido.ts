import type { DB } from "../datos/repos";
import { registrarSync, cerrarSync } from "../datos/repos";
import { procesarPendientes, repararVentasHistoricas } from "./webhooks";
import { recargarCargosHistoricos, revisarPendientes } from "./devoluciones";
import { continuarCargosPendientes } from "./cargos-meli";
import { recalcular } from "./cache";
import { latidoAmazon } from "./latido-amazon";
import { configuracionIndusther, sincronizarInventarioIndusther } from "./industher";
import { sincronizarPublicidadDiaria } from "./publicidad-sync";

/** Cuánto puede tener el plan de viejo antes de recalcularse solo. */
export const EDAD_MAX_PLAN_MS = 3 * 60_000;

/**
 * El latido del sistema: drena los avisos de MELI y deja el plan recalculado.
 *
 * Lo disparan tres caminos, y por eso vive aparte:
 *  - /api/estado cada 30 s mientras alguien tiene la app abierta,
 *  - el webhook de MELI cuando detecta que lleva más de una hora sin correr
 *    (los avisos llegan a toda hora, así que esto sustituye a un cron),
 *  - /api/cron/plan si algún día se programa desde fuera.
 *
 * El candado vive en sync_log: si ya hay una corrida viva para la cuenta,
 * el que llega se retira sin hacer nada. Así dos pestañas, un webhook y un
 * cron pueden empujar a la vez sin duplicar trabajo ni quemar cuota de MELI.
 */
export async function latido(
  admin: DB,
  accountId: string,
  opts?: { limiteMs?: number },
): Promise<{ corrio: boolean; procesados: number; msPlan: number | null }> {
  const limite = Date.now() + (opts?.limiteMs ?? 240_000);

  // Un latido cada DOS minutos basta: con ~40 mil avisos al día la condición
  // "hay avisos" es verdadera casi siempre, así que el candado es lo único
  // que decide la cadencia. A 60 s el latido corría 620 veces al día (6
  // horas de función diarias, medidas en sync_log); a 120 s cuesta la mitad
  // y las ventas siguen entrando con 2 minutos de retraso como mucho.
  //
  // Si la lectura del candado FALLA (Supabase caído: el 9-sep-2026 contestó
  // 520/521 un minuto y tres latidos arrancaron a la vez, cada uno releyendo
  // los mismos pagos de Mercado Pago), no se puede saber si hay otro vivo:
  // el que llega se retira. Un `data` nulo por error NO es "no hay nadie".
  const vivo = await admin
    .from("sync_log")
    .select("id, estado")
    .eq("account_id", accountId)
    .eq("tarea", "en_vivo")
    .gte("inicio", new Date(Date.now() - 120_000).toISOString())
    .limit(1);
  if (vivo.error || vivo.data?.length) return { corrio: false, procesados: 0, msPlan: null };

  const corriendo = await admin
    .from("sync_log")
    .select("id")
    .eq("account_id", accountId)
    .eq("tarea", "en_vivo")
    .eq("estado", "corriendo")
    .gte("inicio", new Date(Date.now() - 4 * 60_000).toISOString())
    .limit(1);
  if (corriendo.error || corriendo.data?.length) return { corrio: false, procesados: 0, msPlan: null };

  const logId = await registrarSync(admin, accountId, "en_vivo");

  try {
    // Los avisos anteriores a la última sincronización completa ya no dicen
    // nada nuevo: esa corrida volvió a bajar ventas, stock y catálogo
    // enteros. La limpieza corre DENTRO de Postgres, por tandas acotadas
    // (limpiar_webhooks, migración 0023): la versión anterior era un solo
    // UPDATE de cientos de miles de renglones que moría por tiempo y cuyo
    // error nadie revisaba — el atasco creció a 192 mil avisos y la tabla a
    // 382 MB antes de que se notara. De paso borra los procesados con más
    // de 3 días, que solo son bitácora.
    const { data: ultimaCompleta } = await admin
      .from("sync_log")
      .select("inicio")
      .eq("account_id", accountId)
      .eq("tarea", "completa")
      .eq("estado", "ok")
      .order("inicio", { ascending: false })
      .limit(1)
      .maybeSingle();
    const limpieza = await admin.rpc("limpiar_webhooks", {
      p_account: accountId,
      p_corte: ultimaCompleta?.inicio ?? null,
    });
    if (limpieza.error) console.error("limpiar_webhooks:", limpieza.error.message);
    // Drenar la bandeja en tandas hasta vaciarla o quedarse sin tiempo. El
    // drenado NO puede comerse todo el plazo: se le reserva medio minuto al
    // recálculo del plan, que es lo que el usuario ve. Si MELI truena a media
    // tanda (cuota, red), el plan se recalcula igual: los avisos que falten
    // los recoge el siguiente latido.
    const finDrenado = limite - 30_000;
    let procesados = 0;
    let errorAvisos: string | null = null;
    try {
      while (Date.now() < finDrenado) {
        const r = await procesarPendientes(admin, accountId, 500);
        procesados += r.procesados;
        if (r.quedanPendientes === 0 || r.procesados === 0) break;
      }
    } catch (err) {
      errorAvisos = (err as Error).message.slice(0, 300);
    }

    // Reparación del historial de ventas (una sola vez, en abonos): solo si
    // después del drenado sobra tiempo de sobra. Un tropiezo aquí no debe
    // tumbar el latido: el siguiente retoma donde se quedó.
    let diasReparados = 0;
    if (Date.now() < finDrenado - 60_000) {
      try {
        const rep = await repararVentasHistoricas(admin, accountId, finDrenado - 15_000);
        diasReparados = rep.dias;
        // Con el historial ya completo, el mismo espacio del latido se usa
        // para recargar el desglose con el pago REAL de Mercado Pago, orden
        // por orden, de lo reciente hacia atrás (junio en adelante).
        if (rep.completo && Date.now() < finDrenado - 60_000) {
          await recargarCargosHistoricos(admin, accountId, finDrenado - 15_000);
        }
      } catch (err) {
        console.error("repararVentasHistoricas:", (err as Error).message);
      }
    }

    // Revisión de devoluciones y cancelaciones: unas órdenes por latido, a
    // los 10 y a los 40 días de vendidas, para que el corte del mes sea
    // exacto. Un tropiezo aquí tampoco tumba el latido.
    if (Date.now() < finDrenado - 45_000) {
      try {
        await revisarPendientes(admin, accountId, finDrenado - 15_000);
      } catch (err) {
        console.error("revisarPendientes:", (err as Error).message);
      }
    }

    // La facturación de MELI que quedó a medias (5 páginas por minuto)
    // avanza unas páginas por latido hasta completarse.
    if (Date.now() < finDrenado - 40_000) {
      try {
        await continuarCargosPendientes(admin, accountId, finDrenado - 15_000);
      } catch (err) {
        console.error("continuarCargosPendientes:", (err as Error).message);
      }
    }

    // Product Ads se sincroniza a la base (`publicidad_diaria`) cada hora,
    // montado en el latido: así /ventas, /publicidad y los cortes suman de
    // la base en vez de pedirle a MELI el barrido de anuncios en cada
    // render. Un fallo queda en sync_log (tarea ads_auto) y se reintenta a
    // la hora; mientras la base no cubra un rango, esas pantallas siguen
    // preguntando en vivo, así que nunca faltan datos.
    if (Date.now() < finDrenado - 30_000) {
      const { data: ultimaAds } = await admin
        .from("sync_log")
        .select("id")
        .eq("account_id", accountId)
        .eq("tarea", "ads_auto")
        .gte("inicio", new Date(Date.now() - 3_600_000).toISOString())
        .limit(1);
      if (!ultimaAds?.length) {
        const idAds = await registrarSync(admin, accountId, "ads_auto");
        try {
          const r = await sincronizarPublicidadDiaria(admin, accountId, {
            limiteMs: Math.min(90_000, finDrenado - Date.now() - 15_000),
          });
          await cerrarSync(admin, idAds, "ok", r);
        } catch (err) {
          await cerrarSync(admin, idAds, "error", {
            mensaje: (err as Error).message.slice(0, 300),
          });
        }
      }
    }

    // El inventario de bodega (API de Industher) se refresca solo cada 3
    // horas montado en el latido: con solo el cron diario, las cajas que el
    // almacén movía a media mañana no se veían hasta el día siguiente. Un
    // fallo queda registrado en sync_log (tarea industher_auto) y se
    // reintenta a las 3 horas, sin tumbar el resto del latido.
    if (configuracionIndusther() && Date.now() < finDrenado - 30_000) {
      const { data: ultimaInd } = await admin
        .from("sync_log")
        .select("id")
        .eq("account_id", accountId)
        .eq("tarea", "industher_auto")
        .gte("inicio", new Date(Date.now() - 3 * 3_600_000).toISOString())
        .limit(1);
      if (!ultimaInd?.length) {
        const idInd = await registrarSync(admin, accountId, "industher_auto");
        try {
          const inv = await sincronizarInventarioIndusther(admin, accountId);
          await cerrarSync(admin, idInd, "ok", {
            renglones: inv.renglones,
            cajasDisponibles: inv.cajasDisponibles,
          });
        } catch (err) {
          await cerrarSync(admin, idInd, "error", {
            mensaje: (err as Error).message.slice(0, 300),
          });
        }
      }
    }

    // Dejar el plan servido si quedó obsoleto y ya no está fresquito.
    let msPlan: number | null = null;
    const { data: plan } = await admin
      .from("plan_cache")
      .select("generado_en, vigente")
      .eq("account_id", accountId)
      .maybeSingle();
    // Sin condición de tiempo: recalcular toma segundos y es justo lo que el
    // usuario está esperando ver. El margen ya se reservó arriba.
    const obsoleto =
      plan?.vigente === false &&
      (!plan?.generado_en ||
        Date.now() - new Date(plan.generado_en).getTime() > EDAD_MAX_PLAN_MS);
    if (obsoleto) {
      const r = await recalcular(admin, accountId);
      msPlan = r.msCalculo;
    }

    // La vista de inventario (bodega + Full) también se deja precalculada
    // cuando quedó obsoleta O envejeció (la pantalla la sirve aunque esté
    // invalidada, así que este es el único lugar que refresca), para que
    // Bodega y Planificación China lean un renglón masticado en vez de
    // armar las cajas en cada visita.
    if (Date.now() < limite - 15_000) {
      try {
        const { data: inv } = await admin
          .from("inventario_cache")
          .select("vigente, generado_en")
          .eq("account_id", accountId)
          .maybeSingle();
        const viejo = inv?.generado_en ? Date.now() - Date.parse(inv.generado_en) > 4 * 3_600_000 : true;
        if (!inv || inv.vigente === false || viejo) {
          const { recalcularInventario } = await import("./inventario");
          await recalcularInventario(admin, accountId);
        }
      } catch (err) {
        console.error("recalcularInventario:", (err as Error).message);
      }
    }

    await cerrarSync(admin, logId, "ok", { procesados, msPlan, errorAvisos, diasReparados });

    // Estas corridas son latidos, no historia: no vale la pena acumularlas.
    await admin
      .from("sync_log")
      .delete()
      .eq("account_id", accountId)
      .in("tarea", ["en_vivo", "barrido_dia"])
      .lt("inicio", new Date(Date.now() - 24 * 3600 * 1000).toISOString());

    // Amazon avanza montado en este mismo latido, con su propio espaciado.
    // Un tropiezo de Amazon jamás debe tumbar el latido de MELI.
    try {
      await latidoAmazon(admin, accountId);
    } catch (err) {
      console.error("latidoAmazon:", (err as Error).message);
    }

    return { corrio: true, procesados, msPlan };
  } catch (err) {
    await cerrarSync(admin, logId, "error", {
      mensaje: (err as Error).message.slice(0, 300),
    });
    return { corrio: true, procesados: 0, msPlan: null };
  }
}

/**
 * ¿Hace falta encender el latido desde el webhook? Solo si nadie lo ha
 * corrido en la última hora — con la app abierta corre cada medio minuto,
 * así que esto solo prende cuando la app lleva rato cerrada.
 */
export async function latidoApagado(admin: DB, accountId: string): Promise<boolean> {
  const { data } = await admin
    .from("sync_log")
    .select("id")
    .eq("account_id", accountId)
    .eq("tarea", "en_vivo")
    .gte("inicio", new Date(Date.now() - 55 * 60_000).toISOString())
    .limit(1);
  return !data?.length;
}
