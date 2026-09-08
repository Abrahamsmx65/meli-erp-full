/**
 * Sincronización de Product Ads a la base (`publicidad_diaria`).
 *
 * Hasta ahora cada render de /ventas, /publicidad y /ventas/cortes le pedía
 * a MELI el barrido completo de anuncios (paginado de 50 en 50): la llamada
 * externa más cara del sistema, repetida en la pantalla que más se abre.
 * Aquí el latido baja las métricas UNA vez por día-anuncio y las guarda; la
 * pantalla suma en Postgres (`publicidad_resumen_items`).
 *
 * Reglas:
 *  - La cobertura es CONTINUA: `publicidad_sync` dice [desde, hasta] sin
 *    huecos. La pantalla solo usa la base cuando su rango cabe completo;
 *    si no, pregunta en vivo como siempre. Nunca datos a medias sin avisar.
 *  - Los últimos DIAS_RESYNC_ADS días se releen en cada corrida: MELI sigue
 *    atribuyendo ventas a un clic varios días después, y el gasto de HOY
 *    crece durante el día.
 *  - Hacia atrás se rellena en abonos (backfill) hasta DIAS_HISTORIA_ADS,
 *    con presupuesto de tiempo: la primera carga tarda varias corridas y no
 *    pasa nada.
 */
import type { DB } from "../datos/repos";
import { clienteDeCuenta } from "./webhooks";
import { fechaMx } from "./ventas-monitor";
import { resolverAdvertiser, traerAnunciosAds, type AnuncioAds } from "./publicidad";

/** Los últimos días se releen siempre: la atribución de MELI se mueve. */
export const DIAS_RESYNC_ADS = 3;
/** Hasta dónde se rellena la historia (cubre un año de cortes con margen). */
export const DIAS_HISTORIA_ADS = 400;
/** Tope de días por corrida, para no comerse el latido completo. */
const MAX_DIAS_POR_CORRIDA = 14;

function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(fecha) + dias * 86_400_000).toISOString().slice(0, 10);
}

interface EstadoAds {
  desde: string;
  hasta: string;
}

async function guardarDia(
  admin: DB,
  accountId: string,
  fecha: string,
  anuncios: AnuncioAds[],
): Promise<void> {
  const filas = anuncios.map((a) => ({
    account_id: accountId,
    fecha,
    item_id: a.itemId,
    gasto: a.gasto,
    clicks: a.clicks,
    impresiones: a.impresiones,
    unidades_ads: a.unidadesAds,
    venta_ads: a.ventaAds,
    estado: a.estado,
    campana_id: a.campanaId,
    titulo: a.titulo,
    actualizado_en: new Date().toISOString(),
  }));
  // Por tandas: un día trae tantos renglones como anuncios tiene la cuenta.
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await admin
      .from("publicidad_diaria")
      .upsert(filas.slice(i, i + 500), { onConflict: "account_id,fecha,item_id" });
    if (error) throw new Error(`publicidad_diaria: ${error.message}`);
  }
}

async function guardarEstado(admin: DB, accountId: string, est: EstadoAds): Promise<void> {
  const { error } = await admin.from("publicidad_sync").upsert(
    {
      account_id: accountId,
      desde: est.desde,
      hasta: est.hasta,
      actualizado_en: new Date().toISOString(),
      error: null,
    },
    { onConflict: "account_id" },
  );
  if (error) throw new Error(`publicidad_sync: ${error.message}`);
}

/**
 * Avanza la sincronización de Product Ads todo lo que el presupuesto de
 * tiempo permita. Idempotente: cada día se guarda con upsert y la cobertura
 * solo crece cuando el día quedó completo.
 */
export async function sincronizarPublicidadDiaria(
  admin: DB,
  accountId: string,
  opts?: { limiteMs?: number },
): Promise<{ dias: number; desde: string | null; hasta: string | null; completo: boolean }> {
  const fin = Date.now() + (opts?.limiteMs ?? 60_000);

  const { data: cuenta } = await admin
    .from("meli_accounts")
    .select("id, site_id")
    .eq("id", accountId)
    .maybeSingle();
  if (!cuenta) throw new Error("La cuenta de MELI no existe.");

  const cliente = await clienteDeCuenta(admin, accountId);
  if (!cliente) throw new Error("No se pudieron leer los tokens de MELI.");
  const adv = await resolverAdvertiser(cliente, cuenta.site_id ?? "MLM");

  const { data: estRaw } = await admin
    .from("publicidad_sync")
    .select("desde, hasta")
    .eq("account_id", accountId)
    .maybeSingle();

  const hoy = fechaMx(0);
  const limiteHistoria = sumarDias(hoy, -(DIAS_HISTORIA_ADS - 1));
  let est: EstadoAds | null = estRaw ? { desde: estRaw.desde, hasta: estRaw.hasta } : null;

  let sincronizados = 0;
  const hayTiempo = () => Date.now() < fin && sincronizados < MAX_DIAS_POR_CORRIDA;

  const bajarDia = async (fecha: string) => {
    const anuncios = await traerAnunciosAds(cliente, adv, { desde: fecha, hasta: fecha });
    await guardarDia(admin, accountId, fecha, anuncios);
    sincronizados += 1;
  };

  // 1. Primera corrida: hoy queda dentro y de ahí se crece en ambos sentidos.
  if (!est) {
    await bajarDia(hoy);
    est = { desde: hoy, hasta: hoy };
    await guardarEstado(admin, accountId, est);
  }

  // 2. Los días nuevos desde la última corrida, en orden: la cobertura solo
  //    avanza con días contiguos completos.
  while (est.hasta < hoy && hayTiempo()) {
    const dia = sumarDias(est.hasta, 1);
    await bajarDia(dia);
    est = { ...est, hasta: dia };
    await guardarEstado(admin, accountId, est);
  }

  // 3. Relectura de los días recientes ya cubiertos (atribución en movimiento
  //    y el gasto de hoy, que crece durante el día).
  if (est.hasta >= hoy) {
    for (let i = 0; i < DIAS_RESYNC_ADS && hayTiempo(); i++) {
      const dia = fechaMx(i);
      if (dia < est.desde) break;
      await bajarDia(dia);
    }
    await guardarEstado(admin, accountId, est);
  }

  // 4. Rellenar la historia hacia atrás, un día por vez.
  while (est.desde > limiteHistoria && hayTiempo()) {
    const dia = sumarDias(est.desde, -1);
    await bajarDia(dia);
    est = { ...est, desde: dia };
    await guardarEstado(admin, accountId, est);
  }

  return {
    dias: sincronizados,
    desde: est.desde,
    hasta: est.hasta,
    completo: est.hasta >= hoy && est.desde <= limiteHistoria,
  };
}
