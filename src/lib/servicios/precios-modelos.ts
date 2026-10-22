/**
 * Lleva los precios de Números a MELI (relámpago, Buen Fin, oferta de todos
 * los días) y a Amazon (PVP deal). Motor en `precios/promociones.ts`.
 *
 * Primero se REVISA (se lee en vivo lo que cada publicación tiene hoy y se
 * enseña contra lo nuevo) y solo con la confirmación del dueño se APLICA,
 * en el orden que pidió: relámpago, Buen Fin, todos los días y al final
 * Amazon. Cada renglón regresa con el mensaje real de MELI o Amazon.
 */
import type { DB } from "../datos/repos";
import { traerTodo } from "../datos/repos";
import { calcularNumeros } from "../finanzas/numeros";
import { enLotes, type MeliClient } from "../meli/client";
import { Cliente, ErrorAmazon, cuentasAmazon } from "../amazon/spapi";
import {
  modeloDeSku,
  ordenarPlan,
  planDePromo,
  redondear99,
  claveRenglon,
  ofertaAmazon,
  precioMinimoAmazon,
  stockParaRelampago,
  estaInscrita,
  type Asignaciones,
  type Objetivos,
  type PromoMeli,
  type RenglonPromo,
} from "../precios/promociones";
import { mensajeMeli } from "./listados";
import { listarNumeros } from "./numeros";
import { leerCacheAppGuardado } from "./cache-app";
import { CLAVE_TARIFAS, type TarifasGuardadas } from "./tarifas-reales";
import { cuentaAmazon } from "./amazon";

export interface RenglonAmazon {
  sku: string;
  estado: string | null;
  actual: number | null;
  nuevo: number | null;
  accion: "cambiar" | "igual" | "sin_precio";
}

export interface RevisionPrecios {
  objetivos: Objetivos[];
  meli: RenglonPromo[];
  amazon: RenglonAmazon[];
  avisos: string[];
}

export interface ResultadoPrecio {
  donde: string;
  detalle: string;
  ok: boolean;
}

const PLAZO_MS = 240_000;

export function normalizarModelos(x: unknown): string[] {
  const lista = Array.isArray(x) ? x : String(x ?? "").split(/[\s,;]+/);
  return [...new Set(lista.map((m) => String(m).trim().toUpperCase()).filter((m) => /^[A-Z]{1,4}\d{2,5}[A-Z]?$/.test(m)))];
}

async function objetivosDe(db: DB, accountId: string, modelos: string[]): Promise<Objetivos[]> {
  const tarifas = await leerCacheAppGuardado<TarifasGuardadas>(db, accountId, CLAVE_TARIFAS).catch(() => null);
  const porModelo = tarifas && tarifas.estado === "encontrado" ? tarifas.valor.datos.porModelo : {};
  const { renglones } = await listarNumeros(db, accountId, porModelo);
  return modelos.map((modelo) => {
    const r = renglones.find((x) => x.entrada.modelo === modelo);
    if (!r) return { modelo, relampago: null, normal: null, pvpDeal: null };
    const c = calcularNumeros(r.entrada, r.costo, r.reales);
    return {
      modelo,
      relampago: r.entrada.precioRelampago,
      normal: redondear99(c.pvNormal),
      pvpDeal: redondear99(c.pvpDeal),
    };
  });
}

async function itemsDeModelos(db: DB, accountId: string, modelos: string[]): Promise<Map<string, string>> {
  const filas = await traerTodo<{ item_id: string | null; modelo: string | null }>(db, "skus", "item_id, modelo, sku", (q) =>
    q.eq("account_id", accountId).eq("activo", true).in("modelo", modelos).not("item_id", "is", null),
  );
  const items = new Map<string, string>();
  for (const f of filas) if (f.item_id && f.modelo) items.set(f.item_id, f.modelo.toUpperCase());
  return items;
}

async function promosDe(cliente: MeliClient, itemId: string): Promise<PromoMeli[]> {
  const r = await cliente.get<PromoMeli[] | { results?: PromoMeli[] }>(`/seller-promotions/items/${itemId}`, { app_version: "v2" });
  return Array.isArray(r) ? r : r?.results ?? [];
}

interface PublicacionAmazon {
  sku: string;
  estado: string | null;
  precio: number | null;
  modelo: string;
}

async function publicacionesAmazon(admin: DB, modelos: string[]): Promise<{ cuentaId: string | null; filas: PublicacionAmazon[] }> {
  const cuenta = await cuentaAmazon(admin).catch(() => null);
  if (!cuenta) return { cuentaId: null, filas: [] };
  const filas: PublicacionAmazon[] = [];
  for (const modelo of modelos) {
    const datos = await traerTodo<{ seller_sku: string; estado: string | null; precio: unknown }>(
      admin,
      "amazon_listings",
      "seller_sku, estado, precio",
      (q) => q.eq("account_id", (cuenta as { id: string }).id).ilike("seller_sku", `${modelo}-%`),
    );
    for (const d of datos) {
      if (modeloDeSku(d.seller_sku) !== modelo) continue;
      const p = Number(d.precio);
      filas.push({ sku: d.seller_sku, estado: d.estado, precio: d.precio == null || !Number.isFinite(p) ? null : p, modelo });
    }
  }
  return { cuentaId: (cuenta as { id: string }).id, filas };
}

export async function revisarPrecios(
  db: DB,
  admin: DB,
  cliente: MeliClient,
  accountId: string,
  modelos: string[],
  asignadas: Asignaciones = {},
  opciones: { soloMeli?: boolean } = {},
): Promise<RevisionPrecios> {
  const avisos: string[] = [];
  const objetivos = await objetivosDe(db, accountId, modelos);
  const porModelo = new Map(objetivos.map((o) => [o.modelo, o]));
  for (const o of objetivos) {
    if (o.relampago == null) avisos.push(`${o.modelo}: no tiene precio relámpago en Números.`);
  }

  const items = await itemsDeModelos(db, accountId, modelos);
  const meli: RenglonPromo[] = [];
  // De cinco en cinco: con todo el catálogo (el cron diario) son cientos de
  // publicaciones y en serie no cabían en la función.
  const leidas = await enLotes([...items], 5, async ([itemId, modelo]) => {
    try {
      return { itemId, modelo, promos: await promosDe(cliente, itemId), error: null as string | null };
    } catch (err) {
      return { itemId, modelo, promos: [] as PromoMeli[], error: mensajeMeli(err) };
    }
  });
  for (const { itemId, modelo, promos, error } of leidas) {
    const o = porModelo.get(modelo);
    if (!o) continue;
    if (error) avisos.push(`${itemId} (${modelo}): MELI no contestó sus promociones — ${error}`);
    for (const p of promos) meli.push({ ...planDePromo(itemId, p, o, asignadas), nombre: `${modelo} · ${p.name || "(sin nombre)"}` });
  }

  if (opciones.soloMeli) return { objetivos, meli: ordenarPlan(meli), amazon: [], avisos };

  const { filas } = await publicacionesAmazon(admin, modelos);
  const amazon: RenglonAmazon[] = filas.map((f) => {
    const nuevo = porModelo.get(f.modelo)?.pvpDeal ?? null;
    const igual = nuevo != null && f.precio != null && Math.round(f.precio * 100) === Math.round(nuevo * 100);
    return { sku: f.sku, estado: f.estado, actual: f.precio, nuevo, accion: nuevo == null ? "sin_precio" : igual ? "igual" : "cambiar" };
  });
  if (!filas.length) avisos.push("No encontré publicaciones de Amazon de estos modelos.");

  return { objetivos, meli: ordenarPlan(meli), amazon, avisos };
}

export async function aplicarPrecios(
  db: DB,
  admin: DB,
  cliente: MeliClient,
  accountId: string,
  modelos: string[],
  asignadas: Asignaciones = {},
  stocks: Record<string, number> = {},
): Promise<{ revision: RevisionPrecios; resultados: ResultadoPrecio[] }> {
  // Se relee justo antes: lo que se aplica es lo que MELI y Amazon tienen ahora.
  const revision = await revisarPrecios(db, admin, cliente, accountId, modelos, asignadas);
  const resultados: ResultadoPrecio[] = [];

  for (const r of revision.meli) {
    if ((r.accion !== "cambiar" && r.accion !== "inscribir") || r.nuevo == null) continue;
    const donde = `${r.itemId} · ${r.nombre}`;
    const cuerpo: Record<string, unknown> = { promotion_type: r.tipo, deal_price: r.nuevo };
    if (r.promoId) cuerpo.promotion_id = r.promoId;
    // Inscribir en un relámpago (las que programa el asesor, con fecha) pide
    // reservar pares; modificar una ya inscrita no.
    if (r.accion === "inscribir" && r.tipo.toUpperCase() === "LIGHTNING") {
      const s = stockParaRelampago(r, stocks[claveRenglon(r)]);
      if ("error" in s) {
        resultados.push({ donde, ok: false, detalle: s.error });
      } else {
        const hecho = await inscribirRelampago(cliente, r, s.intentos);
        resultados.push({ donde, ok: hecho.ok, detalle: hecho.detalle });
      }
      continue;
    }
    try {
      const ruta = `/seller-promotions/items/${r.itemId}?app_version=v2`;
      if (r.accion === "cambiar") await cliente.put(ruta, cuerpo, { reintentos: 1 });
      else await cliente.post(ruta, cuerpo);
      resultados.push({ donde, ok: true, detalle: `${r.accion === "cambiar" ? "cambiado" : "inscrito"} a $${r.nuevo.toFixed(2)}` });
    } catch (err) {
      resultados.push({ donde, ok: false, detalle: mensajeMeli(err) });
    }
  }

  const porCambiar = revision.amazon.filter((a) => a.accion === "cambiar" && a.nuevo != null);
  if (porCambiar.length) {
    const cuentaId = (await publicacionesAmazon(admin, [])).cuentaId;
    const credenciales = (await cuentasAmazon(admin)).find((c) => c.accountId === cuentaId);
    if (!credenciales?.sellingPartnerId) {
      resultados.push({ donde: "Amazon", ok: false, detalle: "La cuenta de Amazon no tiene credenciales o Seller ID guardado." });
    } else {
      const amz = new Cliente(credenciales, Date.now() + PLAZO_MS);
      const base = `/listings/2021-08-01/items/${encodeURIComponent(credenciales.sellingPartnerId)}`;
      for (const a of porCambiar) {
        const donde = `Amazon ${a.sku}`;
        try {
          const ruta = `${base}/${encodeURIComponent(a.sku)}`;
          const actual = await amz.llamar<{
            summaries?: { productType?: string }[];
            attributes?: { purchasable_offer?: Record<string, unknown>[] };
          }>("GET", ruta, "getListingsItem", {
            params: { marketplaceIds: credenciales.marketplaceId, includedData: "summaries,attributes" },
          });
          const productType = actual?.summaries?.[0]?.productType;
          if (!productType) {
            resultados.push({ donde, ok: false, detalle: "Amazon no dijo el tipo de producto de la publicación." });
            continue;
          }
          const r = await amz.llamar<{ status?: string; issues?: { message?: string; severity?: string }[] }>("PATCH", ruta, "patchListingsItem", {
            params: { marketplaceIds: credenciales.marketplaceId },
            cuerpo: {
              productType,
              patches: [
                {
                  op: "replace",
                  path: "/attributes/purchasable_offer",
                  value: ofertaAmazon(actual?.attributes?.purchasable_offer, credenciales.marketplaceId, a.nuevo as number),
                },
              ],
            },
          });
          const errores = (r?.issues ?? []).filter((i) => (i.severity ?? "").toUpperCase() === "ERROR");
          if (!r) resultados.push({ donde, ok: false, detalle: "Amazon no contestó a tiempo." });
          else if (r.status !== "ACCEPTED" || errores.length)
            resultados.push({ donde, ok: false, detalle: errores.map((e) => e.message).join("; ") || `Amazon contestó ${r.status}` });
          else
            resultados.push({
              donde,
              ok: true,
              detalle: `precio a $${(a.nuevo as number).toFixed(2)} y mínimo a $${precioMinimoAmazon(a.nuevo as number).toFixed(2)} (Amazon lo aplica en unos minutos)`,
            });
        } catch (err) {
          resultados.push({ donde, ok: false, detalle: err instanceof ErrorAmazon ? err.detalle.slice(0, 300) : (err as Error).message });
        }
      }
    }
  }

  return { revision, resultados };
}

/**
 * Inscribe un relámpago probando los pares en orden (`stockParaRelampago`):
 * si MELI rechaza un número, se prueba el siguiente; regresa el mensaje del
 * último rechazo si ninguno entra.
 */
async function inscribirRelampago(
  cliente: MeliClient,
  r: RenglonPromo,
  intentos: number[],
): Promise<{ ok: boolean; detalle: string }> {
  let ultimo = "";
  for (const stock of intentos) {
    try {
      // Todas las relámpago de una publicación comparten `promotion_id`
      // (LGH-MLM1000): sin el folio de la propuesta MELI inscribe UNA fecha y
      // contesta «sí» a las demás (GT183, 17 al 19-oct-2026: dos «inscritas»
      // por día y la del 20-oct siguió como propuesta).
      await cliente.post(`/seller-promotions/items/${r.itemId}?app_version=v2`, {
        promotion_id: r.promoId,
        promotion_type: r.tipo,
        deal_price: r.nuevo,
        stock,
        ...(r.offerId ? { offer_id: r.offerId } : {}),
      });
      return { ok: true, detalle: `inscrita a $${(r.nuevo as number).toFixed(2)} con ${stock} pares` };
    } catch (err) {
      ultimo = mensajeMeli(err);
      // Si MELI no acepta el folio, se intenta como antes (sin él).
      if (r.offerId && /offer/i.test(ultimo)) {
        try {
          await cliente.post(`/seller-promotions/items/${r.itemId}?app_version=v2`, {
            promotion_id: r.promoId,
            promotion_type: r.tipo,
            deal_price: r.nuevo,
            stock,
          });
          return { ok: true, detalle: `inscrita a $${(r.nuevo as number).toFixed(2)} con ${stock} pares (MELI no aceptó el folio: ${ultimo})` };
        } catch (err2) {
          ultimo = mensajeMeli(err2);
        }
      }
    }
  }
  return { ok: false, detalle: ultimo };
}

export const TAREA_RELAMPAGOS = "relampagos-auto";
export const TAREA_BUEN_FIN = "buen-fin-auto";

export interface RevisionDeNumeros {
  modelos: string[];
  revision: RevisionPrecios;
}

/** Las promociones de MELI de TODOS los modelos de Números (lo comparten relámpagos y Buen Fin). */
export async function revisarTodoNumeros(admin: DB, cliente: MeliClient, accountId: string): Promise<RevisionDeNumeros> {
  const filas = await traerTodo<{ modelo: string }>(admin, "numeros_modelos", "modelo", (q) => q.eq("account_id", accountId));
  const modelos = normalizarModelos(filas.map((f) => f.modelo));
  return { modelos, revision: await revisarPrecios(admin, admin, cliente, accountId, modelos, {}, { soloMeli: true }) };
}

/**
 * Cron de las 10:00 de México (dueño, 14-oct-2026: «un cron que todos los
 * días a las 10 am revise los precios y, si ve alguna relámpago que no se
 * aplicó y que cumple con el precio mínimo, la confirme»): en TODOS los
 * modelos con precio relámpago en Números, cada relámpago CANDIDATA (las
 * que programa el asesor, con fecha) cuyo precio relámpago cabe en el rango
 * de MELI se inscribe reservando el MÍNIMO de pares que pide MELI. Nada más
 * se toca: ni Buen Fin, ni todos los días, ni Amazon, ni una relámpago ya
 * inscrita. Lo hecho queda en `sync_log` (tarea `relampagos-auto`).
 * El botón «Confirmar relámpagos» de Números corre esto mismo a mano
 * (`origen: "manual"`; dueño, 16-oct-2026: «cuando mi asesor me carga
 * ofertas, que solo confirme las que pasan los precios de relámpago»).
 */
export async function confirmarRelampagosPendientes(
  admin: DB,
  cliente: MeliClient,
  accountId: string,
  origen: "cron" | "manual" = "cron",
  previa?: RevisionDeNumeros,
): Promise<{ modelos: number; inscritas: ResultadoPrecio[]; fallidas: ResultadoPrecio[]; omitidas: string[]; avisos: string[] }> {
  const { modelos, revision } = previa ?? (await revisarTodoNumeros(admin, cliente, accountId));

  const inscritas: ResultadoPrecio[] = [];
  const fallidas: ResultadoPrecio[] = [];
  const omitidas: string[] = [];
  const porItem = new Map<string, ResultadoPrecio[]>();
  // Por el API, MELI deja UNA relámpago programada por publicación: con una
  // ya «pending», el POST de otra fecha le contesta «sí» y solo le cambia el
  // precio a la programada (prueba del 20-oct-2026, GT130: las seis formas
  // devolvieron la misma OFFER del 21-oct y la del 23-oct siguió candidata).
  // Esas publicaciones esperan a que pase su relámpago, y de las que no
  // tienen ninguna se inscribe solo una fecha por corrida.
  const conProgramada = new Set(
    revision.meli
      .filter((r) => r.tipo.toUpperCase() === "LIGHTNING" && ["pending", "started", "active", "programmed"].includes(r.estado.toLowerCase()))
      .map((r) => r.itemId),
  );
  // Las propuestas de `/seller-promotions/items` no traen fecha: se leen del
  // listado de la promoción para inscribir PRIMERO la más próxima (así la
  // corrida de las 00:30 encadena la del día en cuanto termina la de ayer).
  const candidatas = revision.meli.filter(
    (r) => r.tipo.toUpperCase() === "LIGHTNING" && r.estado.toLowerCase() === "candidate" && r.accion === "inscribir" && r.nuevo != null,
  );
  const fechaDe = new Map<string, string>();
  const itemsSinFecha = [...new Set(candidatas.filter((r) => !conProgramada.has(r.itemId)).map((r) => r.itemId))];
  await enLotes(itemsSinFecha, 5, async (itemId) => {
    const promo = candidatas.find((r) => r.itemId === itemId)?.promoId ?? "LGH-MLM1000";
    try {
      const lista = await cliente.get<{ results?: { id?: string; ref_id?: string; status?: string; start_date?: string }[] }>(
        `/seller-promotions/promotions/${promo}/items`,
        { app_version: "v2", promotion_type: "LIGHTNING", item_id: itemId, limit: 50 },
        { reintentos: 1 },
      );
      for (const x of lista?.results ?? []) {
        if (x.id && x.id !== itemId) continue;
        const estado = (x.status ?? "").toLowerCase();
        if (["pending", "started", "active", "programmed"].includes(estado)) conProgramada.add(itemId);
        if (x.ref_id && x.start_date) fechaDe.set(`${itemId}|${x.ref_id}`, x.start_date);
      }
    } catch {
      // sin fechas se queda el orden de MELI
    }
  });
  const fecha = (r: RenglonPromo) => r.inicio ?? (r.offerId ? fechaDe.get(`${r.itemId}|${r.offerId}`) : undefined) ?? "9999";
  const enOrden = [...revision.meli].sort((a, b) => a.itemId.localeCompare(b.itemId) || fecha(a).localeCompare(fecha(b)));

  const yaAvisadas = new Set<string>();
  const intentadas = new Set<string>();
  for (const r of enOrden) {
    if (r.tipo.toUpperCase() !== "LIGHTNING" || r.estado.toLowerCase() !== "candidate") continue;
    const dia = fecha(r) === "9999" ? null : fecha(r).slice(0, 10);
    const donde = `${r.itemId} · ${r.nombre}${dia ? ` · ${dia}` : ""}`;
    if (r.accion !== "inscribir" || r.nuevo == null) continue;
    if (conProgramada.has(r.itemId) || intentadas.has(r.itemId)) {
      if (!yaAvisadas.has(r.itemId)) {
        yaAvisadas.add(r.itemId);
        omitidas.push(`${donde}: ya tiene una relámpago programada; MELI solo deja una por el API y la siguiente entra cuando pase esa`);
      }
      continue;
    }
    intentadas.add(r.itemId);
    const s = stockParaRelampago(r, undefined);
    if ("error" in s) {
      omitidas.push(`${donde}: ${s.error}`);
      continue;
    }
    const hecho = await inscribirRelampago(cliente, r, s.intentos);
    (hecho.ok ? inscritas : fallidas).push({ donde, ok: hecho.ok, detalle: hecho.detalle });
    if (hecho.ok) porItem.set(r.itemId, [...(porItem.get(r.itemId) ?? []), inscritas[inscritas.length - 1]]);
  }

  // MELI contesta «sí» aunque no inscriba la fecha (ver `inscribirRelampago`):
  // se relee cada publicación y, si le quedan más propuestas de relámpago de
  // las que debían quedar, las «inscritas» de más pasan a fallidas.
  const muestra: unknown[] = [];
  await enLotes([...porItem], 5, async ([itemId, hechas]) => {
    const antes = revision.meli.filter(
      (r) => r.itemId === itemId && r.tipo.toUpperCase() === "LIGHTNING" && r.estado.toLowerCase() === "candidate",
    ).length;
    let despues: PromoMeli[];
    try {
      despues = (await promosDe(cliente, itemId)).filter(
        (p) => (p.type ?? "").toUpperCase() === "LIGHTNING" && (p.status ?? "").toLowerCase() === "candidate",
      );
    } catch {
      return;
    }
    if (despues.length && muestra.length < 5) muestra.push(...despues.slice(0, 2));
    const sinEntrar = Math.min(hechas.length, despues.length - (antes - hechas.length));
    for (const h of hechas.slice(hechas.length - Math.max(0, sinEntrar))) {
      inscritas.splice(inscritas.indexOf(h), 1);
      fallidas.push({ ...h, ok: false, detalle: `MELI contestó que sí pero la relámpago sigue como propuesta (${h.detalle})` });
    }
  });

  await admin.from("sync_log").insert({
    account_id: accountId,
    tarea: TAREA_RELAMPAGOS,
    estado: fallidas.length ? "error" : "ok",
    fin: new Date().toISOString(),
    detalle: { origen, modelos: modelos.length, inscritas, fallidas, omitidas, avisos: revision.avisos.slice(0, 50), muestra },
  });
  return { modelos: modelos.length, inscritas, fallidas, omitidas, avisos: revision.avisos };
}

export interface ConteoRelampagos {
  publicaciones: number;
  propuestas: number;
  programadas: number;
  conProgramada: number;
  /** propuestas por día de inicio (México) */
  porFecha: Record<string, number>;
  /** propuestas que empiezan antes de que termine la programada: el API no las alcanza */
  sePierden: { itemId: string; nombre: string; inicio: string; programadaHasta: string }[];
  sinFecha: number;
}

/**
 * Cuántas relámpago propuestas siguen sin confirmar (dueño, 21-oct-2026:
 * «creo que no está funcionando, ¿cuántas tenemos con opción pendiente de
 * confirmar?»). Solo lee: de cada publicación con relámpago, el listado de
 * la promoción da las fechas de las propuestas y de la programada, y una
 * propuesta que empieza antes de que termine la programada no la alcanza
 * el cron (MELI deja una por el API).
 */
export async function contarRelampagosPendientes(admin: DB, cliente: MeliClient, accountId: string): Promise<ConteoRelampagos> {
  const filas = await traerTodo<{ modelo: string; precio_relampago: unknown }>(admin, "numeros_modelos", "modelo, precio_relampago", (q) =>
    q.eq("account_id", accountId).not("precio_relampago", "is", null),
  );
  const revision = await revisarPrecios(admin, admin, cliente, accountId, normalizarModelos(filas.map((f) => f.modelo)), {}, { soloMeli: true });
  const relampagos = revision.meli.filter((r) => r.tipo.toUpperCase() === "LIGHTNING");
  const nombres = new Map(relampagos.map((r) => [r.itemId, r.nombre]));
  const items = [...new Set(relampagos.map((r) => r.itemId))];
  const dia = (x: string) => new Date(new Date(x).getTime() - 6 * 3600_000).toISOString().slice(0, 10);
  const conteo: ConteoRelampagos = { publicaciones: items.length, propuestas: 0, programadas: 0, conProgramada: 0, porFecha: {}, sePierden: [], sinFecha: 0 };
  await enLotes(items, 5, async (itemId) => {
    const promo = relampagos.find((r) => r.itemId === itemId)?.promoId ?? "LGH-MLM1000";
    let lista: { id?: string; status?: string; start_date?: string; finish_date?: string }[] = [];
    try {
      const r = await cliente.get<{ results?: typeof lista }>(
        `/seller-promotions/promotions/${promo}/items`,
        { app_version: "v2", promotion_type: "LIGHTNING", item_id: itemId, limit: 50 },
        { reintentos: 1 },
      );
      lista = (r?.results ?? []).filter((x) => !x.id || x.id === itemId);
    } catch {
      const n = relampagos.filter((r) => r.itemId === itemId && r.estado.toLowerCase() === "candidate").length;
      conteo.propuestas += n;
      conteo.sinFecha += n;
      return;
    }
    const programadas = lista.filter((x) => ["pending", "started", "active", "programmed"].includes((x.status ?? "").toLowerCase()));
    const propuestas = lista.filter((x) => (x.status ?? "").toLowerCase() === "candidate");
    conteo.programadas += programadas.length;
    conteo.propuestas += propuestas.length;
    if (programadas.length) conteo.conProgramada++;
    const hasta = programadas.map((x) => x.finish_date ?? "").sort().pop() ?? "";
    for (const p of propuestas) {
      if (!p.start_date) {
        conteo.sinFecha++;
        continue;
      }
      const d = dia(p.start_date);
      conteo.porFecha[d] = (conteo.porFecha[d] ?? 0) + 1;
      if (hasta && p.start_date < hasta)
        conteo.sePierden.push({ itemId, nombre: nombres.get(itemId) ?? "", inicio: p.start_date, programadaHasta: hasta });
    }
  });
  conteo.porFecha = Object.fromEntries(Object.entries(conteo.porFecha).sort());
  return conteo;
}

/**
 * Buen Fin de golpe (dueño, 22-oct-2026: «quiero activar todo lo de Buen Fin
 * de golpe, que el sistema revise todo lo que tengo de Buen Fin y lo active
 * si cumple con los criterios, igual que con las relámpago»): en TODOS los
 * modelos de Números, cada promoción reconocida como Buen Fin
 * (`clasificarPromo`) se inscribe o se corrige al PV NORMAL a .99, con las
 * mismas reglas de «Llevar precios»: lo que ya está a ese precio no se toca,
 * ni la que con el aporte de MELI cruza los $299 (`pagarias_envio`), ni un
 * modelo sin precio en Números. Luego se relee cada publicación: la que MELI
 * dijo que sí pero sigue como propuesta, o con otro precio, pasa a fallida.
 * Corre en el cron de relámpagos y con el botón; bitácora `buen-fin-auto`.
 */
export async function confirmarBuenFinPendientes(
  admin: DB,
  cliente: MeliClient,
  accountId: string,
  origen: "cron" | "manual" = "cron",
  previa?: RevisionDeNumeros,
): Promise<{ modelos: number; inscritas: ResultadoPrecio[]; fallidas: ResultadoPrecio[]; omitidas: string[]; avisos: string[] }> {
  const { modelos, revision } = previa ?? (await revisarTodoNumeros(admin, cliente, accountId));
  const inscritas: ResultadoPrecio[] = [];
  const fallidas: ResultadoPrecio[] = [];
  const omitidas: string[] = [];
  const hechas: { r: RenglonPromo; res: ResultadoPrecio }[] = [];
  const buenFin = revision.meli.filter((r) => r.clase === "buen_fin");
  const porMandar: RenglonPromo[] = [];
  for (const r of buenFin) {
    const donde = `${r.itemId} · ${r.nombre}`;
    if (r.accion === "igual") continue;
    if (r.accion === "pagarias_envio") omitidas.push(`${donde}: con el aporte de MELI se cobra como ≥ $299 y pagarías el envío`);
    else if (r.accion === "sin_precio" || r.nuevo == null) omitidas.push(`${donde}: el modelo no tiene PV normal en Números`);
    else if (r.accion === "inscribir" || r.accion === "cambiar") porMandar.push(r);
  }
  // De cinco en cinco, como la lectura: en serie no cabe con las relámpago en el cron.
  await enLotes(porMandar, 5, async (r) => {
    const donde = `${r.itemId} · ${r.nombre}`;
    const nuevo = r.nuevo as number;
    const ruta = `/seller-promotions/items/${r.itemId}?app_version=v2`;
    const cuerpo: Record<string, unknown> = { promotion_type: r.tipo, deal_price: nuevo };
    if (r.promoId) cuerpo.promotion_id = r.promoId;
    try {
      if (r.accion === "cambiar") await cliente.put(ruta, cuerpo, { reintentos: 1 });
      else {
        try {
          await cliente.post(ruta, r.offerId ? { ...cuerpo, offer_id: r.offerId } : cuerpo);
        } catch (err) {
          // Si MELI no acepta el folio, como «Llevar precios»: sin él.
          if (!r.offerId || !/offer/i.test(mensajeMeli(err))) throw err;
          await cliente.post(ruta, cuerpo);
        }
      }
      const res = { donde, ok: true, detalle: `${r.accion === "cambiar" ? "cambiado" : "inscrito"} a $${nuevo.toFixed(2)}` };
      inscritas.push(res);
      hechas.push({ r, res });
    } catch (err) {
      fallidas.push({ donde, ok: false, detalle: mensajeMeli(err) });
    }
  });

  // MELI a veces contesta «sí» sin hacerlo: se relee y lo que no quedó, falla.
  const porItem = new Map<string, { r: RenglonPromo; res: ResultadoPrecio }[]>();
  for (const h of hechas) porItem.set(h.r.itemId, [...(porItem.get(h.r.itemId) ?? []), h]);
  await enLotes([...porItem], 5, async ([itemId, lista]) => {
    let promos: PromoMeli[];
    try {
      promos = await promosDe(cliente, itemId);
    } catch {
      return;
    }
    for (const { r, res } of lista) {
      const p = promos.find((x) => (x.id ?? null) === r.promoId && (x.type ?? "") === r.tipo);
      if (!p) continue;
      const quedo = estaInscrita(p) && p.price != null && Math.round(p.price * 100) === Math.round((r.nuevo as number) * 100);
      if (quedo) continue;
      inscritas.splice(inscritas.indexOf(res), 1);
      fallidas.push({
        ...res,
        ok: false,
        detalle: `MELI contestó que sí pero quedó ${estaInscrita(p) ? `a $${p.price ?? "?"}` : "como propuesta"} (${res.detalle})`,
      });
    }
  });

  await admin.from("sync_log").insert({
    account_id: accountId,
    tarea: TAREA_BUEN_FIN,
    estado: fallidas.length ? "error" : "ok",
    fin: new Date().toISOString(),
    detalle: { origen, modelos: modelos.length, buenFin: buenFin.length, inscritas, fallidas, omitidas, avisos: revision.avisos.slice(0, 50) },
  });
  return { modelos: modelos.length, inscritas, fallidas, omitidas, avisos: revision.avisos };
}
