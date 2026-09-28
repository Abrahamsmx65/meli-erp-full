/**
 * Resumen de ventas de AYER por correo, cada mañana a las 7:00 de México
 * (pedido del dueño, 28-sep-2026: «cada día en la mañana 7 am me mande un
 * resumen de mis ventas de ayer en unidades, facturación y ganancia de las 4
 * plataformas a mi mail»).
 *
 * Las cuatro plataformas: calzado y fundas en Mercado Libre y Amazon salen
 * del MISMO motor que el corte general, recortado a un día
 * (`cargarConsolidado` con `desde` = `hasta` = ayer); TikTok, de lo que
 * TikTok dice que va a pagar por cada pedido en pie (`resumenPorModelo`).
 *
 * «Ganancia del día» = neto real − costo de los pares − publicidad. Los
 * gastos de plataforma que MELI y Amazon cobran por mes (almacenamiento de
 * Full, facturación, colecta) NO se reparten en un día: van en el corte del
 * mes, que el correo enseña abajo. Y como NADA SE ESTIMA, la venta cuyo
 * depósito aún no se lee (o el pedido de TikTok que TikTok todavía no
 * calcula) queda fuera de la ganancia y el correo lo dice.
 */
import type { Cuenta, DB } from "../datos/repos";
import { traerTodo } from "../datos/repos";
import { diaMx, resumenPorModelo, type OrdenParaVentas, type RenglonParaVentas } from "../tiktok/ventas";
import { cargarConsolidado, leerConsolidadoGuardado } from "./consolidado-cargar";
import type { Consolidado } from "./consolidado";
import { enviarCorreo, type ResultadoCorreo } from "./correo";

export const TAREA_RESUMEN_DIARIO = "correo-resumen-diario";

/** A quién va: `CORREO_RESUMEN_DIARIO`, si no el correo del dueño que lo pidió. */
export function destinatarioResumen(): string {
  return process.env.CORREO_RESUMEN_DIARIO?.trim() || "abrahamdarwish@hotmail.com";
}

export interface FilaResumen {
  canal: string;
  nombre: string;
  unidades: number;
  /** venta bruta: lo que pagó el cliente */
  facturacion: number;
  /** neto − costo − publicidad; null si no hay nada con dato */
  ganancia: number | null;
  notas: string[];
}

export interface ResumenDiario {
  dia: string;
  filas: FilaResumen[];
  total: { unidades: number; facturacion: number; ganancia: number };
  /** el mes hasta ayer (del corte general guardado + TikTok) */
  mes: { periodo: string; filas: FilaResumen[]; total: { unidades: number; facturacion: number; ganancia: number } } | null;
  avisos: string[];
}

const r2 = (x: number) => Math.round(x * 100) / 100 || 0;

/** El día anterior a `hoy` (YYYY-MM-DD). */
export function diaAnterior(hoy: string): string {
  return new Date(Date.parse(`${hoy}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** Hoy en México (UTC−6 fijo). */
export function hoyMx(ahora = Date.now()): string {
  return new Date(ahora - 6 * 3_600_000).toISOString().slice(0, 10);
}

/** Las filas de MELI y Amazon de un consolidado: ganancia antes de los gastos del mes. */
export function filasDeConsolidado(c: Consolidado, antesDeGastosDelMes: boolean): FilaResumen[] {
  return c.canales.map((k) => {
    const notas: string[] = [];
    if (k.coberturaNeto != null && k.coberturaNeto < 0.999 && k.ventaBruta > 0) {
      const sinLeer = k.ventaBruta * (1 - k.coberturaNeto);
      notas.push(`${Math.round(k.coberturaNeto * 100)} % con depósito leído: ${pesos(sinLeer)} de venta aún sin depósito, fuera de la ganancia`);
    }
    if (k.unidades > 0 && k.unidadesConCosto < k.unidades) notas.push(`${k.unidades - k.unidadesConCosto} piezas sin costo capturado`);
    const ganancia = antesDeGastosDelMes ? k.utilidadBruta - k.publicidad : k.utilidadNeta;
    return {
      canal: k.canal,
      nombre: k.nombre,
      unidades: k.unidades,
      facturacion: k.ventaBruta,
      ganancia: k.ventaBruta > 0 || k.neto !== 0 || k.publicidad > 0 ? r2(ganancia) : null,
      notas,
    };
  });
}

export interface TikTokDelRango {
  unidades: number;
  facturacion: number;
  ganancia: number | null;
  notas: string[];
}

/**
 * TikTok en un rango: pares y cobrado de los pedidos en pie; ganancia = lo
 * que TikTok dice que va a pagar − costo de esos pares. Lo que TikTok aún
 * no calcula (casi todo lo de ayer: publica las transacciones hasta que el
 * pedido sale) se declara aparte.
 */
export function tiktokDelRango(
  ordenes: OrdenParaVentas[],
  renglones: RenglonParaVentas[],
  costoDe: Map<string, number>,
  rango: { desde: string; hasta: string },
): TikTokDelRango {
  const modelos = resumenPorModelo(ordenes, renglones, rango);
  let unidades = 0;
  let facturacion = 0;
  let ganancia = 0;
  let hayGanancia = false;
  let sinDatoPares = 0;
  let sinDatoCobrado = 0;
  let sinCostoPares = 0;
  for (const m of modelos) {
    unidades += m.unidades;
    facturacion += m.cobrado;
    sinDatoPares += m.unidadesSinDato;
    sinDatoCobrado += m.cobradoSinDato;
    if (m.unidadesConDato <= 0) continue;
    const costo = costoDe.get(m.modelo);
    if (costo == null) {
      sinCostoPares += m.unidadesConDato;
      continue;
    }
    ganancia += m.aRecibir - costo * m.unidadesConDato;
    hayGanancia = true;
  }
  const notas: string[] = [];
  if (sinDatoPares > 0) notas.push(`${sinDatoPares} pares (${pesos(sinDatoCobrado)}) que TikTok aún no calcula cuánto paga: fuera de la ganancia`);
  if (sinCostoPares > 0) notas.push(`${sinCostoPares} pares sin costo capturado`);
  return { unidades, facturacion: r2(facturacion), ganancia: hayGanancia ? r2(ganancia) : null, notas };
}

function totalDe(filas: FilaResumen[]) {
  return {
    unidades: filas.reduce((a, f) => a + f.unidades, 0),
    facturacion: r2(filas.reduce((a, f) => a + f.facturacion, 0)),
    ganancia: r2(filas.reduce((a, f) => a + (f.ganancia ?? 0), 0)),
  };
}

/** Las cuatro plataformas en orden, aunque alguna no haya vendido. */
export function armarResumen(dia: string, consolidadoDia: Consolidado | null, tiktokDia: TikTokDelRango | null, mes: { periodo: string; consolidado: Consolidado | null; tiktok: TikTokDelRango | null } | null, avisos: string[] = []): ResumenDiario {
  const filaTikTok = (t: TikTokDelRango | null): FilaResumen => ({
    canal: "tiktok",
    nombre: "TikTok Shop",
    unidades: t?.unidades ?? 0,
    facturacion: t?.facturacion ?? 0,
    ganancia: t?.ganancia ?? null,
    notas: t ? t.notas : ["No se pudo leer TikTok."],
  });
  const ordenar = (filas: FilaResumen[]): FilaResumen[] => {
    const orden = ["meli_calzado", "meli_fundas", "amazon", "tiktok"];
    const nombres: Record<string, string> = { meli_calzado: "Calzado · Mercado Libre", meli_fundas: "Fundas · Mercado Libre", amazon: "Amazon", tiktok: "TikTok Shop" };
    return orden.map((canal) => filas.find((f) => f.canal === canal) ?? { canal, nombre: nombres[canal], unidades: 0, facturacion: 0, ganancia: null, notas: [] });
  };
  const filas = ordenar([...(consolidadoDia ? filasDeConsolidado(consolidadoDia, true) : []), filaTikTok(tiktokDia)]);
  let resumenMes: ResumenDiario["mes"] = null;
  if (mes && (mes.consolidado || mes.tiktok)) {
    const f = ordenar([...(mes.consolidado ? filasDeConsolidado(mes.consolidado, false) : []), filaTikTok(mes.tiktok)]);
    resumenMes = { periodo: mes.periodo, filas: f, total: totalDe(f) };
  }
  return { dia, filas, total: totalDe(filas), mes: resumenMes, avisos };
}

// ---------------------------------------------------------------------------
// Correo
// ---------------------------------------------------------------------------

function pesos(x: number): string {
  return (x < 0 ? "-$" : "$") + Math.round(Math.abs(x)).toLocaleString("es-MX");
}
function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function fechaLarga(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}

function tabla(filas: FilaResumen[], total: ResumenDiario["total"], tituloGanancia: string): string {
  const td = "padding:6px 10px;border-bottom:1px solid #e5e5e5;";
  const num = `${td}text-align:right;white-space:nowrap;`;
  const color = (g: number | null) => (g == null ? "#888" : g < 0 ? "#b42318" : "#067647");
  const renglones = filas
    .map(
      (f) =>
        `<tr><td style="${td}">${esc(f.nombre)}${f.notas.length ? `<div style="font-size:11px;color:#888">${f.notas.map(esc).join(" · ")}</div>` : ""}</td>` +
        `<td style="${num}">${n(f.unidades)}</td><td style="${num}">${pesos(f.facturacion)}</td>` +
        `<td style="${num}color:${color(f.ganancia)}">${f.ganancia == null ? "—" : pesos(f.ganancia)}</td></tr>`,
    )
    .join("");
  return (
    `<table style="border-collapse:collapse;width:100%;font-size:14px">` +
    `<tr style="background:#f5f5f5"><th style="${td}text-align:left">Plataforma</th><th style="${num}">Unidades</th><th style="${num}">Facturación</th><th style="${num}">${tituloGanancia}</th></tr>` +
    renglones +
    `<tr style="font-weight:bold;background:#f5f5f5"><td style="${td}">Total</td><td style="${num}">${n(total.unidades)}</td><td style="${num}">${pesos(total.facturacion)}</td><td style="${num}color:${color(total.ganancia)}">${pesos(total.ganancia)}</td></tr>` +
    `</table>`
  );
}

export function armarCorreoResumen(r: ResumenDiario): { asunto: string; html: string; texto: string } {
  const asunto = `Ventas de ayer (${fechaLarga(r.dia)}): ${n(r.total.unidades)} unidades · ${pesos(r.total.facturacion)} · ganancia ${pesos(r.total.ganancia)}`;
  const partes: string[] = [];
  partes.push(`<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;color:#111">`);
  partes.push(`<h2 style="margin:0 0 4px">Ventas de ayer · ${esc(fechaLarga(r.dia))}</h2>`);
  partes.push(`<p style="margin:0 0 12px;color:#555;font-size:13px">Ganancia del día = neto real − costo de los pares − publicidad. Los gastos que las plataformas cobran por mes (almacenamiento de Full y FBA, facturación, colecta) no se reparten en un día: van en el corte del mes.</p>`);
  partes.push(tabla(r.filas, r.total, "Ganancia"));
  if (r.mes) {
    const [a, m] = r.mes.periodo.split("-").map(Number);
    partes.push(`<h3 style="margin:20px 0 4px">${MESES[m - 1].charAt(0).toUpperCase()}${MESES[m - 1].slice(1)} ${a} hasta hoy</h3>`);
    partes.push(`<p style="margin:0 0 8px;color:#555;font-size:13px">Del corte general (ganancia después de gastos de cada plataforma, antes de gastos empresariales) y TikTok.</p>`);
    partes.push(tabla(r.mes.filas, r.mes.total, "Ganancia"));
  }
  if (r.avisos.length) {
    partes.push(`<ul style="color:#b54708;font-size:12px">${r.avisos.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`);
  }
  partes.push(`<p style="color:#888;font-size:11px;margin-top:16px">ERP GETAC · https://meli-erp-full.vercel.app/cortes</p></div>`);

  const lineas = [`Ventas de ayer · ${fechaLarga(r.dia)}`, ""];
  for (const f of r.filas) lineas.push(`${f.nombre}: ${n(f.unidades)} u · ${pesos(f.facturacion)} · ganancia ${f.ganancia == null ? "—" : pesos(f.ganancia)}${f.notas.length ? ` (${f.notas.join("; ")})` : ""}`);
  lineas.push(`Total: ${n(r.total.unidades)} u · ${pesos(r.total.facturacion)} · ganancia ${pesos(r.total.ganancia)}`);
  if (r.avisos.length) lineas.push("", ...r.avisos);
  return { asunto, html: partes.join(""), texto: lineas.join("\n") };
}

// ---------------------------------------------------------------------------
// Carga y envío
// ---------------------------------------------------------------------------

async function cargarTikTok(db: DB, accountId: string, desde: string, hasta: string): Promise<{ ordenes: OrdenParaVentas[]; renglones: RenglonParaVentas[]; costoDe: Map<string, number> }> {
  // El día de México empieza a las 06:00 UTC; un margen de un día por lado
  // y el filtro fino lo hace `diaMx`.
  const desdeIso = new Date(Date.parse(`${desde}T06:00:00Z`) - 86_400_000).toISOString();
  const hastaIso = new Date(Date.parse(`${hasta}T06:00:00Z`) + 2 * 86_400_000).toISOString();
  const crudas = await traerTodo<any>(db, "tiktok_ordenes", "order_id, estado, fecha_creacion, fecha_actualizacion, es_muestra, neto_recibido, pago_esperado, pago_afiliado", (q) =>
    q.eq("account_id", accountId).gte("fecha_creacion", desdeIso).lt("fecha_creacion", hastaIso),
  );
  const ordenes: OrdenParaVentas[] = crudas
    .filter((o) => o.fecha_creacion && diaMx(o.fecha_creacion) >= desde && diaMx(o.fecha_creacion) <= hasta)
    .map((o) => ({
      orderId: o.order_id,
      estado: o.estado,
      creadoEn: o.fecha_creacion,
      actualizadoEn: o.fecha_actualizacion,
      esMuestra: Boolean(o.es_muestra),
      netoRecibido: o.neto_recibido != null ? Number(o.neto_recibido) : null,
      pagoEsperado: o.pago_esperado != null ? Number(o.pago_esperado) : null,
      afiliado: o.pago_afiliado != null ? Number(o.pago_afiliado) : null,
    }));
  const renglones: RenglonParaVentas[] = [];
  const ids = ordenes.map((o) => o.orderId);
  for (let i = 0; i < ids.length; i += 300) {
    const lote = ids.slice(i, i + 300);
    const items = await traerTodo<any>(db, "tiktok_orden_items", "order_id, sku_interno, cantidad, precio, estado", (q) =>
      q.eq("account_id", accountId).in("order_id", lote),
    );
    for (const it of items) {
      renglones.push({ orderId: it.order_id, skuInterno: it.sku_interno ?? null, cantidad: it.cantidad ?? 0, precio: it.precio != null ? Number(it.precio) : null, estado: it.estado ?? null });
    }
  }
  const costos = await traerTodo<any>(db, "productos_config", "modelo, costo_mxn", (q) => q.eq("account_id", accountId).not("costo_mxn", "is", null));
  const costoDe = new Map<string, number>();
  for (const c of costos) {
    const modelo = String(c.modelo ?? "").toUpperCase();
    if (modelo && !costoDe.has(modelo)) costoDe.set(modelo, Number(c.costo_mxn));
  }
  return { ordenes, renglones, costoDe };
}

export async function cargarResumenDiario(db: DB, cuenta: Cuenta, dia: string): Promise<ResumenDiario> {
  const periodo = dia.slice(0, 7);
  const avisos: string[] = [];
  const [consolidadoDia, tiktok, mesGuardado] = await Promise.all([
    cargarConsolidado(db, cuenta, periodo, {
      desde: dia,
      hasta: dia,
      alFallarCanal: (canal, motivo) => avisos.push(`${canal}: no se pudo leer (${motivo}).`),
    }).catch((err) => {
      avisos.push(`Mercado Libre y Amazon: no se pudieron leer (${(err as Error).message}).`);
      return null;
    }),
    cargarTikTok(db, cuenta.id, `${periodo}-01`, dia).catch((err) => {
      avisos.push(`TikTok: no se pudo leer (${(err as Error).message}).`);
      return null;
    }),
    leerConsolidadoGuardado(db, cuenta, periodo),
  ]);
  const tiktokDia = tiktok ? tiktokDelRango(tiktok.ordenes, tiktok.renglones, tiktok.costoDe, { desde: dia, hasta: dia }) : null;
  const tiktokMes = tiktok ? tiktokDelRango(tiktok.ordenes, tiktok.renglones, tiktok.costoDe, { desde: `${periodo}-01`, hasta: dia }) : null;
  return armarResumen(dia, consolidadoDia, tiktokDia, { periodo, consolidado: mesGuardado, tiktok: tiktokMes }, avisos);
}

/** Ya se mandó el resumen de ese día (el cron puede dispararse dos veces). */
async function yaEnviado(db: DB, accountId: string, dia: string): Promise<boolean> {
  const { data } = await db
    .from("sync_log")
    .select("detalle")
    .eq("account_id", accountId)
    .eq("tarea", TAREA_RESUMEN_DIARIO)
    .eq("estado", "ok")
    .order("inicio", { ascending: false })
    .limit(5);
  return (data ?? []).some((f: any) => f.detalle?.dia === dia && f.detalle?.enviado === true);
}

export async function enviarResumenDiario(
  db: DB,
  cuenta: Cuenta,
  opts: { dia?: string; forzar?: boolean; para?: string } = {},
): Promise<{ dia: string; enviado: boolean; omitido?: string; correo?: ResultadoCorreo; total?: ResumenDiario["total"] }> {
  const dia = opts.dia ?? diaAnterior(hoyMx());
  if (!opts.forzar && (await yaEnviado(db, cuenta.id, dia))) return { dia, enviado: false, omitido: "ya se mandó el de ese día" };
  if (!process.env.RESEND_API_KEY) return { dia, enviado: false, omitido: "el correo no está configurado (RESEND_API_KEY)" };
  const resumen = await cargarResumenDiario(db, cuenta, dia);
  const { asunto, html, texto } = armarCorreoResumen(resumen);
  const para = opts.para ?? destinatarioResumen();
  const correo = await enviarCorreo({ para, asunto, html, texto });
  await db.from("sync_log").insert({
    account_id: cuenta.id,
    tarea: TAREA_RESUMEN_DIARIO,
    estado: correo.enviado ? "ok" : "error",
    fin: new Date().toISOString(),
    detalle: { dia, para, enviado: correo.enviado, id: correo.id ?? null, motivo: correo.motivo ?? null, total: resumen.total, filas: resumen.filas, avisos: resumen.avisos },
  });
  return { dia, enviado: correo.enviado, correo, total: resumen.total };
}
