/**
 * Ingesta de la Finances API de Amazon a la base: los eventos financieros
 * uno por uno y crudos, por GRUPO DE LIQUIDACIÓN (settlement).
 *
 * Por qué por grupo y no por fecha: un grupo cerrado ya no cambia y trae su
 * total (`OriginalTotal`). Es el número de control: cuando la suma de los
 * eventos leídos da ese total, el grupo está completo y cuadra; si no,
 * falta o sobra algo y queda declarado en `amazon_finanzas_grupos.cuadra`.
 * Leer por fecha (`PostedAfter`) no tiene ese control.
 *
 * Presupuesto: la cuota es 0.5 llamadas/s (ráfaga 30) y cada página trae
 * 100 eventos, así que una corrida de ~4 minutos avanza ~100 páginas. Un
 * grupo a medio leer guarda su `token_siguiente` y la siguiente corrida
 * sigue donde se quedó; si Amazon rechaza el token viejo, el grupo se
 * reinicia (releer es idempotente: la clave es la huella del evento).
 *
 * El grupo ABIERTO (el de la quincena en curso) se relee completo cada
 * `RELEER_ABIERTO_MS`: sus eventos crecen y no tiene total todavía.
 */
import type { Cliente } from "./spapi";
import { ErrorAmazon } from "./spapi";
import { clasificarEventos, gruposFinancieros, paginaDeEventosDeGrupo, type EventoClasificadoAmazon, type GrupoFinancieroAmazon } from "./finanzas";
import { guardarEnLotes } from "./sync";

/** Desde cuándo se leen grupos la primera vez (mayo 2026: el primer mes con Amazon en el ERP). */
export const FINANZAS_DESDE = "2026-04-01T00:00:00Z";
/** Cada cuánto se relee el grupo abierto. */
export const RELEER_ABIERTO_MS = 60 * 60_000;
/** Cada cuánto se vuelve a pedir la lista de grupos (para ver cerrarse el abierto). */
export const REFRESCAR_GRUPOS_MS = 30 * 60_000;
/** Tolerancia del cuadre contra el total del grupo. */
const TOLERANCIA = 0.011;

export interface ResultadoFinanzas {
  estado: "al_dia" | "avanzando" | "sin_plazo";
  gruposNuevos: number;
  gruposLeidos: string[];
  paginas: number;
  eventos: number;
  /** grupos cerrados que aún no se han leído completos */
  pendientes: number;
  /** grupos cerrados cuya suma NO da su total */
  descuadrados: string[];
  aviso?: string;
}

interface FilaGrupo {
  grupo_id: string;
  inicio: string | null;
  fin: string | null;
  estado: string | null;
  transferencia: string | null;
  total_original: number | null;
  moneda: string | null;
  paginas: number;
  eventos: number;
  sin_clasificar: number;
  suma_eventos: number | null;
  completo: boolean;
  cuadra: boolean | null;
  token_siguiente: string | null;
  leido_en: string | null;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

function filaDeGrupo(accountId: string, g: GrupoFinancieroAmazon) {
  return {
    account_id: accountId,
    grupo_id: g.FinancialEventGroupId!,
    inicio: g.FinancialEventGroupStart ?? null,
    fin: g.FinancialEventGroupEnd ?? null,
    estado: g.ProcessingStatus ?? null,
    transferencia: g.FundTransferStatus ?? null,
    transferido_en: g.FundTransferDate ?? null,
    total_original: g.OriginalTotal?.CurrencyAmount ?? null,
    moneda: g.OriginalTotal?.CurrencyCode ?? null,
    saldo_inicial: g.BeginningBalance?.CurrencyAmount ?? null,
    crudo: g,
    actualizado_en: new Date().toISOString(),
  };
}

function filaDeEvento(accountId: string, grupoId: string, e: EventoClasificadoAmazon) {
  const c = e.cascada;
  return {
    account_id: accountId,
    clave: e.clave,
    grupo_id: grupoId,
    lista: e.lista,
    amazon_order_id: e.amazonOrderId,
    posted_en: e.postedEn,
    monto: e.monto,
    base: e.base,
    impuesto: e.impuesto,
    descripcion: e.descripcion,
    principal: c?.principal ?? null,
    impuesto_cobrado: c?.impuestoCobrado ?? null,
    otros_cargos: c?.otrosCargos ?? null,
    comision: c?.comision ?? null,
    fba: c?.fba ?? null,
    otras_tarifas: c?.otrasTarifas ?? null,
    retenido: c?.retenido ?? null,
    promociones: c?.promociones ?? null,
    unidades: c?.unidades ?? null,
    renglones: c?.renglones ?? null,
    clasificado: e.clasificado,
    crudo: e.crudo,
    leido_en: new Date().toISOString(),
  };
}

/**
 * Refresca la lista de grupos si toca y devuelve los grupos guardados de la
 * cuenta (solo los de la moneda del marketplace: los grupos en USD/CAD de
 * otros sitios no son de aquí).
 */
async function gruposDeLaCuenta(admin: any, cliente: Cliente, opts: { forzarLista?: boolean }): Promise<{ grupos: FilaGrupo[]; nuevos: number }> {
  const accountId = cliente.cuenta.accountId;
  const { data: guardados, error } = await admin
    .from("amazon_finanzas_grupos")
    .select("grupo_id, inicio, fin, estado, transferencia, total_original, moneda, paginas, eventos, sin_clasificar, suma_eventos, completo, cuadra, token_siguiente, leido_en, actualizado_en")
    .eq("account_id", accountId)
    .order("inicio", { ascending: false });
  if (error) throw new Error(`amazon_finanzas_grupos: ${error.message}`);
  const lista = (guardados ?? []) as (FilaGrupo & { actualizado_en: string })[];

  const masReciente = lista.reduce((m, g) => Math.max(m, Date.parse(g.actualizado_en) || 0), 0);
  const toca = opts.forzarLista || !lista.length || Date.now() - masReciente > REFRESCAR_GRUPOS_MS;
  let nuevos = 0;
  if (toca) {
    // Los grupos recientes bastan para ver cerrarse el abierto; la primera
    // vez se piden desde el fondo.
    const desde = lista.length ? new Date(Date.now() - 45 * 86_400_000).toISOString() : FINANZAS_DESDE;
    const remotos = (await gruposFinancieros(cliente, desde)).filter((g) => g.FinancialEventGroupId);
    if (remotos.length) {
      const conocidos = new Set(lista.map((g) => g.grupo_id));
      nuevos = remotos.filter((g) => !conocidos.has(g.FinancialEventGroupId!)).length;
      // El upsert conserva el avance de lectura: solo se mandan las columnas de Amazon.
      const { error: e2 } = await admin.from("amazon_finanzas_grupos").upsert(remotos.map((g) => filaDeGrupo(accountId, g)), { onConflict: "account_id,grupo_id" });
      if (e2) throw new Error(`amazon_finanzas_grupos: ${e2.message}`);
      // Un grupo que acaba de cerrarse cambia de estado: hay que releerlo
      // completo para tener su cierre (el total ya no cambia).
      for (const g of remotos) {
        const previo = lista.find((x) => x.grupo_id === g.FinancialEventGroupId);
        if (previo && previo.completo && previo.estado === "Open" && g.ProcessingStatus === "Closed") {
          await admin
            .from("amazon_finanzas_grupos")
            .update({ completo: false, cuadra: null, token_siguiente: null, paginas: 0 })
            .eq("account_id", accountId)
            .eq("grupo_id", g.FinancialEventGroupId);
        }
      }
      return gruposDeLaCuenta(admin, cliente, { forzarLista: false });
    }
  }
  return { grupos: lista, nuevos };
}

/** Qué grupo leer ahora: el abierto si le toca releerse; si no, el cerrado más reciente sin terminar. */
export function elegirGrupo(grupos: FilaGrupo[], ahoraMs: number): FilaGrupo | null {
  const moneda = (g: FilaGrupo) => !g.moneda || g.moneda === "MXN";
  const aMedias = grupos.find((g) => moneda(g) && !g.completo && g.token_siguiente);
  if (aMedias) return aMedias;
  const cerradoPendiente = grupos.filter((g) => moneda(g) && g.estado === "Closed" && !g.completo).sort((a, b) => (b.inicio ?? "").localeCompare(a.inicio ?? ""))[0];
  if (cerradoPendiente) return cerradoPendiente;
  const abierto = grupos.find((g) => moneda(g) && g.estado === "Open" && g.inicio);
  if (abierto && (!abierto.leido_en || ahoraMs - Date.parse(abierto.leido_en) > RELEER_ABIERTO_MS)) return abierto;
  return null;
}

/** Suma y cuadre del grupo desde lo guardado (no desde memoria: una releída puede haber reescrito). */
async function cerrarGrupo(admin: any, accountId: string, g: FilaGrupo): Promise<{ suma: number; eventos: number; sinClasificar: number; cuadra: boolean | null }> {
  const { data, error } = await admin.rpc("amazon_finanzas_suma_grupo", { p_account: accountId, p_grupo: g.grupo_id });
  if (error) throw new Error(`amazon_finanzas_suma_grupo: ${error.message}`);
  const fila = (Array.isArray(data) ? data[0] : data) ?? {};
  const suma = r2(Number(fila.suma ?? 0));
  const eventos = Number(fila.eventos ?? 0);
  const sinClasificar = Number(fila.sin_clasificar ?? 0);
  const cuadra = g.estado === "Closed" && g.total_original != null ? Math.abs(suma - Number(g.total_original)) < TOLERANCIA && sinClasificar === 0 : null;
  const { error: e2 } = await admin
    .from("amazon_finanzas_grupos")
    .update({ suma_eventos: suma, eventos, sin_clasificar: sinClasificar, completo: true, cuadra, token_siguiente: null, leido_en: new Date().toISOString() })
    .eq("account_id", accountId)
    .eq("grupo_id", g.grupo_id);
  if (e2) throw new Error(`amazon_finanzas_grupos: ${e2.message}`);
  return { suma, eventos, sinClasificar, cuadra };
}

/**
 * Avanza la ingesta lo que dé el plazo del cliente. Idempotente: releer un
 * grupo reescribe los mismos eventos (misma clave).
 */
export async function sincronizarFinanzas(admin: any, cliente: Cliente): Promise<ResultadoFinanzas> {
  const accountId = cliente.cuenta.accountId;
  const salida: ResultadoFinanzas = { estado: "al_dia", gruposNuevos: 0, gruposLeidos: [], paginas: 0, eventos: 0, pendientes: 0, descuadrados: [] };

  let { grupos, nuevos } = await gruposDeLaCuenta(admin, cliente, {});
  salida.gruposNuevos = nuevos;

  while (cliente.msRestantes() > 25_000) {
    const g = elegirGrupo(grupos, Date.now());
    if (!g) break;

    // Un grupo abierto que se relee desde el principio: sus eventos viejos
    // siguen valiendo (misma clave); el cierre recalcula la suma.
    let token: string | null | undefined = g.token_siguiente;
    let paginasDelGrupo = g.token_siguiente ? g.paginas : 0;
    let terminado = false;

    while (cliente.msRestantes() > 25_000) {
      let pagina: Awaited<ReturnType<typeof paginaDeEventosDeGrupo>>;
      try {
        pagina = await paginaDeEventosDeGrupo(cliente, g.grupo_id, token);
      } catch (err) {
        // Un token viejo que Amazon ya no acepta: se reinicia el grupo.
        if (err instanceof ErrorAmazon && err.status === 400 && token) {
          await admin.from("amazon_finanzas_grupos").update({ token_siguiente: null, paginas: 0 }).eq("account_id", accountId).eq("grupo_id", g.grupo_id);
          token = null;
          paginasDelGrupo = 0;
          continue;
        }
        throw err;
      }
      if (!pagina) break; // sin plazo

      const eventos = clasificarEventos(pagina.eventos);
      if (eventos.length) await guardarEnLotes(admin, "amazon_finanzas_eventos", eventos.map((e) => filaDeEvento(accountId, g.grupo_id, e)));
      paginasDelGrupo++;
      salida.paginas++;
      salida.eventos += eventos.length;
      token = pagina.siguiente ?? null;

      if (!token) {
        terminado = true;
        break;
      }
      // Avance guardado por página: si Vercel corta, se retoma aquí.
      await admin.from("amazon_finanzas_grupos").update({ token_siguiente: token, paginas: paginasDelGrupo, leido_en: new Date().toISOString() }).eq("account_id", accountId).eq("grupo_id", g.grupo_id);
    }

    if (terminado) {
      const cierre = await cerrarGrupo(admin, accountId, g);
      await admin.from("amazon_finanzas_grupos").update({ paginas: paginasDelGrupo }).eq("account_id", accountId).eq("grupo_id", g.grupo_id);
      salida.gruposLeidos.push(g.grupo_id);
      if (cierre.cuadra === false) salida.descuadrados.push(g.grupo_id);
      // Refrescar el estado en memoria para elegir el siguiente.
      g.completo = true;
      g.cuadra = cierre.cuadra;
      g.token_siguiente = null;
      g.leido_en = new Date().toISOString();
    } else {
      salida.estado = "sin_plazo";
      break;
    }
  }

  const relectura = await gruposDeLaCuenta(admin, cliente, { forzarLista: false });
  grupos = relectura.grupos;
  salida.pendientes = grupos.filter((g) => (!g.moneda || g.moneda === "MXN") && g.estado === "Closed" && !g.completo).length;
  for (const g of grupos) if (g.cuadra === false && !salida.descuadrados.includes(g.grupo_id)) salida.descuadrados.push(g.grupo_id);
  if (salida.estado !== "sin_plazo") salida.estado = salida.pendientes ? "avanzando" : "al_dia";
  if (salida.descuadrados.length) salida.aviso = `${salida.descuadrados.length} liquidación(es) cuya suma de eventos no da el total de Amazon.`;
  return salida;
}
