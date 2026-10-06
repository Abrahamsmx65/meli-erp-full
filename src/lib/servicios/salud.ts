/**
 * Revisión general: el sistema se delata solo.
 *
 * Decisión del dueño (11-sep-2026, reforzada el 6-oct-2026): después de
 * varias rondas de «tú lo encuentras, yo lo parcho», lo que falla tiene que
 * salir en UN lugar, sin que nadie lo cace pantalla por pantalla.
 *
 * La primera versión falló en tres cosas y esta las corrige:
 *  · Bajaba 1,000 renglones crudos de `meli_cargos` y, como todos eran de
 *    agosto, marcó septiembre «sin facturación» teniendo 9,132 renglones.
 *    Ahora TODO se cuenta en Postgres (`salud_cortes`, `salud_fuentes`).
 *  · Gritaba nueve veces por una sola causa. Ahora es UN hallazgo por causa
 *    con la lista de meses afectados.
 *  · No miraba lo único que importaba: la COBERTURA de cada canal en cada
 *    mes. Mayo 2026 de calzado era una columna de ceros (0 % de depósitos
 *    leídos) y la revisión decía «todo bien».
 *
 * Dos montones:
 *  · GRAVE: un número EN PANTALLA está mal o incompleto sin que se note.
 *  · FALTA: el dato todavía no llega y el sistema ya lo declara; se completa
 *    solo.
 *
 * Las reglas son funciones PURAS probadas con los casos reales. El correo
 * del cron solo sale cuando CAMBIA lo encontrado (huella en `app_cache`).
 */
import type { DB } from "../datos/repos";
import { guardarCacheApp, leerCacheAppGuardado } from "./cache-app";
import { leidoAntesDeCerrar } from "./cargos-meli";

export type Severidad = "grave" | "falta";

export interface Hallazgo {
  area: string;
  /** un mes, o null cuando el hallazgo abarca varios (van en `detalle`) */
  periodo: string | null;
  severidad: Severidad;
  /** Qué está mal, en una línea, sin jerga. */
  que: string;
  /** El dato que lo prueba. */
  detalle: string;
}

/** Los canales que un corte general debe traer siempre (TikTok solo desde que vende). */
export const CANALES_ESPERADOS = ["amazon", "meli_calzado", "meli_fundas"] as const;

export const NOMBRE_CANAL: Record<string, string> = {
  meli_calzado: "Calzado · Mercado Libre",
  meli_fundas: "Fundas · Mercado Libre",
  amazon: "Amazon",
  tiktok: "TikTok Shop",
};

export interface CanalDelMes {
  canal: string;
  venta: number;
  /** parte de la venta con neto leído; null = fuente no comparable (se confía) */
  cobertura: number | null;
  calculable: boolean;
}

export interface MesDeCorte {
  periodo: string;
  generadoEn: string | null;
  vigente: boolean;
  motivo: string | null;
  canales: CanalDelMes[];
  ventaTotal: number | null;
  /** suma de los canales CALCULABLES: es lo que el total debe dar */
  ventaCanales: number | null;
  exacto: boolean;
  avisos: number;
  avisosTimeout: number;
}

/** Lo que hay de cada fuente en un mes (RPC `salud_fuentes`). */
export interface FuentesDelMes {
  mes: string;
  ventaCalzado: number;
  ordenesCalzado: number;
  ordenesRegistradas: number;
  ordenesConDeposito: number;
  cargos: number;
  diasPublicidad: number;
  ventaFundas: number;
  ordenesFundas: number;
  fundasConDeposito: number;
  ventaAmazon: number;
  eventosAmazon: number;
  gruposAmazonDescuadrados: number;
  descuadreAmazon: number;
}

/** Un mes cerrado con depósitos a medias es «falta» este tiempo; después es grave. */
const MESES_DE_GRACIA = 2;
/** Product Ads de MELI no entrega métricas de más de 90 días: después, solo a mano. */
const DIAS_VENTANA_ADS = 90;
/** Debajo de esto, un mes cerrado no se da por leído. */
const COBERTURA_COMPLETA = 0.95;

/** El mes en curso en hora de México. */
export const periodoActualMx = (): string =>
  new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 7);

export function mesesEntre(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

export function diasDelMes(mes: string): number {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const pesos = (n: number) =>
  n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });
const pct = (x: number) => `${Math.round(x * 100)} %`;
const lista = (xs: string[]) => xs.join(", ");

/**
 * Lo que le pasa a UN mes del corte general. Puro.
 * `canalesEsperados` se pasa para no gritar por un canal que el negocio no
 * tiene conectado.
 */
export function hallazgosDelMes(
  m: MesDeCorte,
  canalesEsperados: readonly string[] = CANALES_ESPERADOS,
  hoy: string = periodoActualMx(),
): Hallazgo[] {
  const out: Hallazgo[] = [];
  const area = "Corte general";
  const presentes = new Set(m.canales.map((k) => k.canal));
  const cerrado = m.periodo < hoy;

  // 1. Un canal que no está. Así desapareció Amazon de julio y fundas de mayo.
  const faltantes = canalesEsperados.filter((c) => !presentes.has(c));
  for (const canal of faltantes) {
    out.push({
      area,
      periodo: m.periodo,
      severidad: "grave",
      que: `${NOMBRE_CANAL[canal] ?? canal} no está en el corte: el mes se está enseñando SIN ese canal.`,
      detalle: m.motivo
        ? `El renglón guardado dice: ${m.motivo}`
        : `El corte trae ${m.canales.length} canal(es): ${m.canales.map((c) => NOMBRE_CANAL[c.canal] ?? c.canal).join(", ") || "ninguno"}.`,
    });
  }

  // 2. La cobertura de cada canal: lo que la primera versión no miraba.
  for (const k of m.canales) {
    if (k.venta <= 0) continue;
    const nombre = NOMBRE_CANAL[k.canal] ?? k.canal;
    if (!k.calculable || k.cobertura === 0) {
      out.push({
        area,
        periodo: m.periodo,
        severidad: "grave",
        que: `${nombre} vendió ${pesos(k.venta)} y NO tiene ni un depósito leído: el canal está fuera del total y su columna no se calcula.`,
        detalle: "Hay que cargar sus órdenes y depósitos; mientras, nada de ese canal se puede creer.",
      });
      continue;
    }
    if (k.cobertura != null && k.cobertura < COBERTURA_COMPLETA && cerrado) {
      const viejo = mesesEntre(m.periodo, hoy) > MESES_DE_GRACIA;
      out.push({
        area,
        periodo: m.periodo,
        severidad: viejo ? "grave" : "falta",
        que: `${nombre}: solo el ${pct(k.cobertura)} de su venta tiene neto leído; el resto está FUERA del neto y de la utilidad.`,
        detalle: viejo
          ? `El mes cerró hace ${mesesEntre(m.periodo, hoy)} meses y la lectura de depósitos no terminó: ya no va a completarse sola.`
          : "El fondo sigue leyendo depósitos; se completa solo.",
      });
    }
  }

  // 3. Una fuente que se murió. El aviso ya lo dice; aquí se grita.
  if (m.avisosTimeout > 0 && faltantes.length === 0) {
    out.push({
      area,
      periodo: m.periodo,
      severidad: "grave",
      que: "Una fuente del mes no respondió (timeout o error) y el corte se armó sin ella.",
      detalle: `${m.avisosTimeout} aviso(s) del mes hablan de una fuente caída. Ábrelos en Cortes.`,
    });
  }

  // 4. El invariante que no se negocia: el total es la suma de sus canales
  //    calculables. Si no cuadra, hay un número inventado en la pantalla.
  if (m.ventaTotal != null && m.ventaCanales != null) {
    const diferencia = Math.abs(m.ventaTotal - m.ventaCanales);
    if (diferencia > Math.max(1, Math.abs(m.ventaTotal) * 0.0001)) {
      out.push({
        area,
        periodo: m.periodo,
        severidad: "grave",
        que: "La venta del mes no cuadra con la suma de sus canales.",
        detalle: `Total ${pesos(m.ventaTotal)} contra ${pesos(m.ventaCanales)} sumando los canales: sobran ${pesos(diferencia)}.`,
      });
    }
  }

  // 5. Marcado para rehacerse y ahí sigue. Un rato es normal; un día no.
  if (!m.vigente && esViejo(m.generadoEn, 24)) {
    out.push({
      area,
      periodo: m.periodo,
      severidad: "falta",
      que: "El corte lleva más de un día marcado para recalcularse y no se ha rehecho.",
      detalle: m.motivo ?? "Sin motivo guardado.",
    });
  }

  return out;
}

/**
 * Las fuentes, mes por mes, en UN hallazgo por causa. Puro.
 * `hoyFecha` es AAAA-MM-DD en hora de México.
 */
export function hallazgosDeFuentes(meses: FuentesDelMes[], hoyFecha: string): Hallazgo[] {
  const out: Hallazgo[] = [];
  const hoy = hoyFecha.slice(0, 7);
  const cerrados = meses.filter((f) => f.mes < hoy);
  const actual = meses.find((f) => f.mes === hoy) ?? null;

  // Órdenes de calzado sin registrar: así mayo 2026 quedó en cero.
  const sinOrdenes = cerrados.filter(
    (f) => f.ventaCalzado > 0 && f.ordenesCalzado > 0 && f.ordenesRegistradas < f.ordenesCalzado * 0.7,
  );
  if (sinOrdenes.length) {
    out.push({
      area: "Órdenes de calzado",
      periodo: null,
      severidad: "grave",
      que: `${sinOrdenes.length} mes(es) con venta de calzado tienen sus órdenes SIN registrar: sin órdenes no hay depósitos, y el canal sale fuera del corte.`,
      detalle: lista(sinOrdenes.map((f) => `${f.mes} (${f.ordenesRegistradas.toLocaleString("es-MX")} de ~${f.ordenesCalzado.toLocaleString("es-MX")} órdenes)`)) + ". El latido las registra hacia atrás, día por día.",
    });
  }

  // Facturación de MELI (gastos de Full): mayo, junio y julio nunca se leyeron.
  const sinCargos = cerrados.filter((f) => f.ventaCalzado > 0 && f.cargos === 0);
  if (sinCargos.length) {
    out.push({
      area: "Facturación de MELI",
      periodo: null,
      severidad: "grave",
      que: `${sinCargos.length} mes(es) cerrado(s) sin la facturación de MELI leída: sus gastos de Full salen en cero.`,
      detalle: lista(sinCargos.map((f) => f.mes)) + ". El latido la pide sola, un mes por vez, mientras MELI la tenga disponible.",
    });
  }
  if (actual && actual.ventaCalzado > 0 && actual.cargos === 0) {
    out.push({
      area: "Facturación de MELI",
      periodo: actual.mes,
      severidad: "falta",
      que: "La facturación del mes en curso todavía no se lee.",
      detalle: "Se lee en el latido.",
    });
  }

  // Publicidad de MELI: la ventana del API es de 90 días; después, a mano.
  const sinAds = cerrados.filter((f) => f.ventaCalzado > 0 && f.diasPublicidad < diasDelMes(f.mes) * 0.8);
  if (sinAds.length) {
    const detalle = sinAds.map((f) => {
      const finMes = `${f.mes}-${String(diasDelMes(f.mes)).padStart(2, "0")}`;
      const diasDesde = Math.floor((Date.parse(hoyFecha) - Date.parse(finMes)) / 86_400_000);
      const estado = f.diasPublicidad === 0 ? "sin nada" : `${f.diasPublicidad} de ${diasDelMes(f.mes)} días`;
      return `${f.mes} (${estado}${diasDesde > DIAS_VENTANA_ADS ? ", ya fuera de la ventana de 90 días: solo a mano" : ""})`;
    });
    out.push({
      area: "Publicidad de MELI",
      periodo: null,
      severidad: "grave",
      que: `${sinAds.length} mes(es) con la publicidad de MELI incompleta: la ganancia por modelo sale sin su publicidad.`,
      detalle: lista(detalle) + ".",
    });
  }

  // Amazon: el dinero exacto sale de la Finances API; un mes con venta y sin eventos es un mes a ciegas.
  const sinFinanzas = cerrados.filter((f) => f.ventaAmazon > 0 && f.eventosAmazon === 0);
  if (sinFinanzas.length) {
    out.push({
      area: "Finanzas de Amazon",
      periodo: null,
      severidad: "grave",
      que: `${sinFinanzas.length} mes(es) con venta en Amazon sin un solo evento de la Finances API: el canal se arma con el respaldo (SKU Economics), que es una estimación.`,
      detalle: lista(sinFinanzas.map((f) => f.mes)) + ".",
    });
  }
  const descuadrados = meses.filter((f) => f.gruposAmazonDescuadrados > 0);
  if (descuadrados.length) {
    const grupos = descuadrados.reduce((a, f) => a + f.gruposAmazonDescuadrados, 0);
    const monto = descuadrados.reduce((a, f) => a + f.descuadreAmazon, 0);
    out.push({
      area: "Liquidaciones de Amazon",
      periodo: null,
      severidad: "grave",
      que: `${grupos} liquidación(es) de Amazon no cuadran: la suma de sus eventos difiere de lo depositado por ${pesos(monto)} en total. Es dinero sin explicar.`,
      detalle: lista(descuadrados.map((f) => `${f.mes} (${f.gruposAmazonDescuadrados}: ${pesos(f.descuadreAmazon)})`)) + ".",
    });
  }

  return out;
}

/** Un trabajo de fondo que dejó de correr. */
export function hallazgoDeSincronizacion(nombre: string, ultima: string | null, horasMaximas: number): Hallazgo[] {
  if (ultima && !esViejo(ultima, horasMaximas)) return [];
  return [{
    area: "Sincronización",
    periodo: null,
    severidad: "grave",
    que: `${nombre} lleva demasiado sin correr: lo que alimenta está quedándose viejo.`,
    detalle: ultima ? `Última corrida: ${ultima} (el tope son ${horasMaximas} h).` : "Nunca ha corrido, o no dejó bitácora.",
  }];
}

function esViejo(cuando: string | null, horas: number, ahora = Date.now()): boolean {
  if (!cuando) return true;
  const t = Date.parse(cuando);
  if (!Number.isFinite(t)) return true;
  return ahora - t > horas * 3_600_000;
}

export interface Salud {
  revisadoEn: string;
  graves: Hallazgo[];
  faltas: Hallazgo[];
  /** los meses del corte con la cobertura de cada canal, para la tabla */
  meses: MesDeCorte[];
  fuentes: FuentesDelMes[];
  /** Lo que la propia revisión no pudo leer: no se calla. */
  errores: string[];
}

/** El avance de la lectura de la facturación de MELI de un mes (bitácora `cargos_meli`). */
export interface AvanceFacturacion {
  periodo: string;
  /** renglones leídos */
  leidos: number;
  /** renglones que MELI declara para el periodo; null = no lo dijo */
  total: number | null;
  completo: boolean;
  /** última lectura (ISO) */
  leidoEn: string | null;
  error: string | null;
}

/**
 * La facturación de MELI contra lo que MELI declara, un hallazgo por causa.
 * Puro. Hasta el 6-oct-2026 la revisión solo preguntaba «¿hay renglones?»,
 * y así agosto 2026 pasaba con 9,900 de 74,059 renglones (MELI topa la
 * paginación en 10 mil) y septiembre con la lectura del día 7 dada por
 * completa.
 */
export function hallazgosDeFacturacion(avances: AvanceFacturacion[], fuentes: FuentesDelMes[], hoyFecha: string): Hallazgo[] {
  const out: Hallazgo[] = [];
  const hoy = hoyFecha.slice(0, 7);
  const conVenta = new Set(fuentes.filter((f) => f.ventaCalzado > 0).map((f) => f.mes));
  const relevantes = avances.filter((a) => conVenta.has(a.periodo) && a.leidos > 0);
  const n = (x: number) => x.toLocaleString("es-MX");

  const incompletos = relevantes.filter((a) => a.total != null && a.total > 0 && a.leidos < a.total * COBERTURA_COMPLETA);
  if (incompletos.length) {
    out.push({
      area: "Facturación de MELI",
      periodo: null,
      severidad: incompletos.some((a) => a.periodo < hoy) ? "grave" : "falta",
      que: `${incompletos.length} mes(es) con la facturación de MELI a medias: sus gastos de Full salen incompletos.`,
      detalle: lista(incompletos.map((a) => `${a.periodo} (${n(a.leidos)} de ${n(a.total!)} renglones${a.error ? `; ${a.error}` : ""})`)),
    });
  }

  const antesDeCerrar = relevantes.filter(
    (a) => a.periodo < hoy && a.completo && !incompletos.includes(a) && leidoAntesDeCerrar({ actualizadoEn: a.leidoEn }, a.periodo),
  );
  if (antesDeCerrar.length) {
    out.push({
      area: "Facturación de MELI",
      periodo: null,
      severidad: "falta",
      que: `${antesDeCerrar.length} mes(es) cuya facturación se dio por leída con el mes todavía abierto: le faltan los cargos de los días siguientes.`,
      detalle: lista(antesDeCerrar.map((a) => `${a.periodo} (leído el ${(a.leidoEn ?? "?").slice(0, 10)}, ${n(a.leidos)} renglones)`)) + ". El latido lo relee solo.",
    });
  }
  return out;
}

/** El último avance de la facturación de cada mes, de la bitácora. */
export async function avancesDeFacturacion(db: DB, accountId: string, meses: string[]): Promise<AvanceFacturacion[]> {
  const out: AvanceFacturacion[] = [];
  for (const periodo of meses) {
    const { data, error } = await db
      .from("sync_log")
      .select("detalle, fin")
      .eq("account_id", accountId)
      .eq("tarea", "cargos_meli")
      .eq("detalle->>periodo", periodo)
      .order("inicio", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) continue;
    const d: any = data.detalle ?? {};
    out.push({
      periodo,
      leidos: Number(d.offset) || 0,
      total: d.total == null ? null : Number(d.total),
      completo: Boolean(d.completo),
      leidoEn: (data as any).fin ?? null,
      error: typeof d.error === "string" && d.error ? d.error.slice(0, 160) : null,
    });
  }
  return out;
}

/**
 * La revisión completa. Dos RPC (un renglón por mes cada uno) y un conteo.
 * No calcula ningún corte.
 */
export async function revisarSalud(
  db: DB,
  cuenta: { id: string },
  opts: { yzAccountId?: string | null; amazonAccountId?: string | null } = {},
): Promise<Salud> {
  const graves: Hallazgo[] = [];
  const faltas: Hallazgo[] = [];
  const errores: string[] = [];
  const meses: MesDeCorte[] = [];
  const fuentes: FuentesDelMes[] = [];
  const hoy = periodoActualMx();
  const hoyFecha = new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
  const agregar = (hs: Hallazgo[]) => {
    for (const h of hs) (h.severidad === "grave" ? graves : faltas).push(h);
  };

  const canalesEsperados = CANALES_ESPERADOS.filter(
    (c) => (c !== "meli_fundas" || opts.yzAccountId) && (c !== "amazon" || opts.amazonAccountId),
  );

  try {
    // `salud_cortes_v2`: la primera versión devolvía los canales como texto;
    // esta trae venta, cobertura y si son calculables (migración 0086).
    const { data, error } = await (db as any).rpc("salud_cortes_v2", { p_account: cuenta.id });
    if (error) throw new Error(error.message);
    for (const f of (data ?? []) as any[]) {
      const m: MesDeCorte = {
        periodo: f.periodo,
        generadoEn: f.generado_en ?? null,
        vigente: f.vigente !== false,
        motivo: f.motivo ?? null,
        canales: ((f.canales ?? []) as any[]).map((k) => ({
          canal: String(k.canal),
          venta: Number(k.venta) || 0,
          cobertura: k.cobertura == null ? null : Number(k.cobertura),
          calculable: k.calculable !== false,
        })),
        ventaTotal: f.venta_total == null ? null : Number(f.venta_total),
        ventaCanales: f.venta_canales == null ? null : Number(f.venta_canales),
        exacto: f.exacto === true,
        avisos: Number(f.avisos) || 0,
        avisosTimeout: Number(f.avisos_timeout) || 0,
      };
      meses.push(m);
      agregar(hallazgosDelMes(m, canalesEsperados, hoy));
    }
  } catch (err) {
    errores.push(`No se pudieron revisar los cortes: ${(err as Error).message}`);
  }

  try {
    const { data, error } = await (db as any).rpc("salud_fuentes", {
      p_account: cuenta.id,
      p_yz: opts.yzAccountId ?? null,
      p_amazon: opts.amazonAccountId ?? null,
    });
    if (error) throw new Error(error.message);
    for (const f of (data ?? []) as any[]) {
      fuentes.push({
        mes: String(f.mes),
        ventaCalzado: Number(f.venta_calzado) || 0,
        ordenesCalzado: Number(f.ordenes_calzado) || 0,
        ordenesRegistradas: Number(f.ordenes_registradas) || 0,
        ordenesConDeposito: Number(f.ordenes_con_deposito) || 0,
        cargos: Number(f.cargos) || 0,
        diasPublicidad: Number(f.dias_publicidad) || 0,
        ventaFundas: Number(f.venta_fundas) || 0,
        ordenesFundas: Number(f.ordenes_fundas) || 0,
        fundasConDeposito: Number(f.fundas_con_deposito) || 0,
        ventaAmazon: Number(f.venta_amazon) || 0,
        eventosAmazon: Number(f.eventos_amazon) || 0,
        gruposAmazonDescuadrados: Number(f.grupos_amazon_descuadrados) || 0,
        descuadreAmazon: Number(f.descuadre_amazon) || 0,
      });
    }
    agregar(hallazgosDeFuentes(fuentes, hoyFecha));
  } catch (err) {
    errores.push(`No se pudieron revisar las fuentes: ${(err as Error).message}`);
  }

  // La facturación de MELI contra lo que MELI declara (un renglón de
  // bitácora por mes con venta de calzado).
  try {
    const meses = fuentes.filter((f) => f.ventaCalzado > 0).map((f) => f.mes);
    const avances = await avancesDeFacturacion(db, cuenta.id, meses);
    agregar(hallazgosDeFacturacion(avances, fuentes, hoyFecha));
  } catch (err) {
    errores.push(`No se pudo revisar la facturación de MELI: ${(err as Error).message}`);
  }

  // TikTok: un saldo negativo es que se vendió algo que no existe.
  try {
    const { data } = await db
      .from("tiktok_inventario")
      .select("sku, saldo")
      .eq("account_id", cuenta.id)
      .lt("saldo", 0)
      .limit(50);
    const rojos = (data ?? []) as { sku: string; saldo: number }[];
    if (rojos.length) {
      graves.push({
        area: "TikTok",
        periodo: null,
        severidad: "grave",
        que: `${rojos.length} SKU con saldo NEGATIVO: se vendió algo que nunca entró al kardex.`,
        detalle: rojos.slice(0, 5).map((r) => `${r.sku} (${r.saldo})`).join(", "),
      });
    }
  } catch (err) {
    errores.push(`Inventario de TikTok: ${(err as Error).message}`);
  }

  return { revisadoEn: new Date().toISOString(), graves, faltas, meses, fuentes, errores };
}

/** La huella de lo grave: si no cambia, no se vuelve a avisar. */
export function huellaDeSalud(s: Pick<Salud, "graves">): string {
  return s.graves
    .map((h) => `${h.area}|${h.periodo ?? ""}|${h.que}`)
    .sort()
    .join("\n");
}

export interface UltimoAviso {
  huella: string;
  enviadoEn: string;
  graves: number;
}

/** Solo se avisa cuando lo encontrado CAMBIÓ respecto al último correo. */
export function debeAvisar(huella: string, anterior: UltimoAviso | null): boolean {
  if (!anterior) return huella.length > 0;
  return anterior.huella !== huella;
}

/** El correo de la revisión. `null` si no hay nada grave y nunca lo hubo. */
export function correoDeSalud(s: Salud, anterior: UltimoAviso | null = null): { asunto: string; html: string; texto: string } | null {
  const esc = (x: string) => x.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!);
  const enlace = `<p style="font-size:12px"><a href="https://meli-erp-full.vercel.app/salud">Abrir la revisión general</a></p>`;
  if (s.graves.length === 0) {
    if (!anterior || anterior.graves === 0) return null;
    return {
      asunto: "ERP: ya no hay problemas en los números",
      html: `<p>La revisión general ya no encuentra nada grave. Lo que estaba mal se corrigió o se completó.</p>${enlace}`,
      texto: "ERP: ya no hay problemas en los números.",
    };
  }
  const asunto = `ERP: ${s.graves.length} problema(s) en los números`;
  const filas = s.graves
    .map((h) => `<li><strong>${esc(h.area)}${h.periodo ? ` · ${esc(h.periodo)}` : ""}</strong><br>${esc(h.que)}<br><span style="color:#666;font-size:12px">${esc(h.detalle)}</span></li>`)
    .join("");
  const html = `
<p>La revisión general encontró <strong>${s.graves.length}</strong> cosa(s) que hacen que un número
de los cortes esté mal o incompleto sin que se note:</p>
<ul style="font-family:sans-serif;font-size:13px">${filas}</ul>
${s.faltas.length ? `<p style="color:#666;font-size:12px">Además hay ${s.faltas.length} dato(s) que todavía no llegan; esos se completan solos.</p>` : ""}
<p style="color:#666;font-size:12px">Este correo solo se manda cuando cambia lo encontrado.</p>
${enlace}`;
  const texto = [
    `${asunto}.`,
    ...s.graves.map((h) => `- ${h.area}${h.periodo ? ` ${h.periodo}` : ""}: ${h.que} (${h.detalle})`),
  ].join("\n");
  return { asunto, html, texto };
}

const CLAVE_ULTIMO_AVISO = "salud:correo";

/**
 * La revisión del cron diario: correo SOLO si lo grave cambió desde el último
 * (y uno de «ya no hay nada» cuando se limpia). Nunca lanza.
 */
export async function avisarSalud(
  db: DB,
  cuenta: { id: string },
  opts: { yzAccountId?: string | null; amazonAccountId?: string | null } = {},
): Promise<{ graves: number; faltas: number; enviado: boolean; motivo?: string }> {
  const { correoConfigurado, enviarCorreo } = await import("./correo");
  const salud = await revisarSalud(db, cuenta, opts);
  const resumen = { graves: salud.graves.length, faltas: salud.faltas.length };

  const leido = await leerCacheAppGuardado<UltimoAviso>(db, cuenta.id, CLAVE_ULTIMO_AVISO).catch(() => null);
  const anterior = leido && leido.estado === "encontrado" ? leido.valor.datos : null;
  const huella = huellaDeSalud(salud);
  if (!debeAvisar(huella, anterior)) return { ...resumen, enviado: false, motivo: "Sin cambios desde el último aviso." };

  const correo = correoDeSalud(salud, anterior);
  if (!correo) return { ...resumen, enviado: false };
  if (!correoConfigurado()) return { ...resumen, enviado: false, motivo: "Correo sin configurar." };

  const env = await enviarCorreo(correo).catch((err) => ({ enviado: false, motivo: (err as Error).message }));
  if (env.enviado) {
    await guardarCacheApp(db, cuenta.id, CLAVE_ULTIMO_AVISO, { huella, enviadoEn: new Date().toISOString(), graves: salud.graves.length } satisfies UltimoAviso, 0).catch(() => undefined);
  }
  return { ...resumen, enviado: env.enviado, motivo: env.motivo };
}
