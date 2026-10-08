import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { refrescarCatalogoAmazon } from "@/lib/servicios/catalogo-amazon";
import { origenDeLaApp } from "@/lib/servicios/origen-app";
import { clienteAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Eslabones de una pasada (~5 min cada uno): 12 son una hora, de sobra para unos cientos de ASINs. */
const MAX_ESLABONES_CATALOGO = 12;
const MS_TRABAJO = 270_000;

/**
 * Pasada NOCTURNA del catálogo de Amazon para creadores: a las 2:00 de
 * México (08:00Z, México no cambia de horario) se releen TODOS los ASINs,
 * los más viejos primero, aunque estén frescos. El cron de la tienda de
 * cada hora solo relee lo de más de 7 días, así que una foto cargada en
 * Amazon tardaba hasta una semana en salir en el catálogo (6-oct-2026: los
 * GT211, GT212, GT215, GT216, GT220, GT222 y GT225 del IN10079 no salían
 * porque Amazon no tenía fotos; dueño: «que el catálogo de Amazon se lea
 * cada noche a las 2am»).
 *
 * **Y la pasada se ENCADENA sola hasta terminar** (dueño: «debe volver a
 * pedir la lectura si no alcanzó»): la ruta contesta 202 en el acto,
 * trabaja ~4.5 min en `after()` y, si quedaron ASINs por leer, se vuelve a
 * llamar a sí misma con `?eslabon=n+1&inicio=<ms>` (bearer CRON_SECRET, al
 * origen de producción como los eslabones de etiquetas y publicación).
 * `inicio` es la hora en que arrancó la pasada: cada eslabón relee solo lo
 * leído ANTES de esa hora, así que lo ya leído esta noche no se repite y
 * la pasada termina sola. Tope `MAX_ESLABONES_CATALOGO`. Cada disparo deja
 * constancia en `tiktok_sync_log` (tarea `catalogo-amazon-disparo`) y cada
 * eslabón en la bitácora `catalogo-amazon` (origen `nocturno`).
 *
 * Bearer CRON_SECRET (el cron de Vercel) o TIENDA_SECRET (para lanzarla a
 * mano).
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const validos = [process.env.CRON_SECRET, process.env.TIENDA_SECRET].map((s) => (s ?? "").trim()).filter(Boolean);
  if (!validos.some((s) => auth === `Bearer ${s}`)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const eslabon = Math.max(0, Number(req.nextUrl.searchParams.get("eslabon") ?? "0") || 0);
  const inicioPasada = Number(req.nextUrl.searchParams.get("inicio")) || Date.now();
  const origen = origenDeLaApp(req);
  after(async () => {
    await pasadaNocturna(clienteAdmin(), { inicioPasada, eslabon, origen });
  });
  return NextResponse.json({ ok: true, eslabon, inicio: inicioPasada }, { status: 202 });
}

async function pasadaNocturna(admin: any, p: { inicioPasada: number; eslabon: number; origen: string }) {
  const arranque = Date.now();
  const { data: tiendas } = await admin.from("tiktok_tienda").select("account_id");
  let pendientes = 0;
  const cuentas: string[] = [];
  for (const t of tiendas ?? []) {
    const restante = MS_TRABAJO - (Date.now() - arranque);
    if (restante < 60_000) {
      pendientes += 1;
      continue;
    }
    cuentas.push(t.account_id);
    try {
      const r = await refrescarCatalogoAmazon(admin, t.account_id, restante, { desde: p.inicioPasada });
      pendientes += r.asinsPendientes;
    } catch (err) {
      await admin
        .from("tiktok_sync_log")
        .insert({
          account_id: t.account_id,
          tarea: "catalogo-amazon",
          inicio: new Date(arranque).toISOString(),
          fin: new Date().toISOString(),
          estado: "error",
          detalle: { origen: "nocturno", eslabon: p.eslabon, error: (err as Error).message },
        })
        .then(() => undefined, () => undefined);
      pendientes += 1;
    }
  }
  if (pendientes <= 0 || p.eslabon >= MAX_ESLABONES_CATALOGO) return;
  await dispararSiguienteEslabon(admin, p.origen, cuentas[0] ?? null, p.eslabon + 1, p.inicioPasada, pendientes);
}

/** Prende el siguiente eslabón de la misma pasada y lo anota en la bitácora. */
async function dispararSiguienteEslabon(
  admin: any,
  origen: string,
  accountId: string | null,
  eslabon: number,
  inicioPasada: number,
  pendientes: number,
) {
  const secreto = (process.env.CRON_SECRET ?? "").trim();
  const url = `${origen.replace(/\/+$/, "")}/api/cron/catalogo-amazon?eslabon=${eslabon}&inicio=${inicioPasada}`;
  const inicio = new Date().toISOString();
  let status: number | null = null;
  let error: string | null = null;
  if (!secreto) error = "falta CRON_SECRET";
  else {
    try {
      const r = await fetch(url, { headers: { authorization: `Bearer ${secreto}` }, signal: AbortSignal.timeout(10_000), redirect: "manual" });
      status = r.status;
      if (r.status !== 202) error = (await r.text().catch(() => "")).slice(0, 200);
    } catch (err) {
      error = (err as Error).message;
    }
  }
  if (!accountId) return;
  await admin
    .from("tiktok_sync_log")
    .insert({
      account_id: accountId,
      tarea: "catalogo-amazon-disparo",
      inicio,
      fin: new Date().toISOString(),
      estado: error ? "error" : "ok",
      detalle: { eslabon, inicioPasada, pendientes, status, error, url },
    })
    .then(() => undefined, () => undefined);
}
