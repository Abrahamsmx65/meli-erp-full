/**
 * Resumen de ventas de AYER por correo, cada mañana a las 8:00 de México
 * (pedido del dueño, 28-sep-2026: «cada día en la mañana me mande un
 * resumen de mis ventas de ayer en unidades, facturación y ganancia de las 4
 * plataformas»; primero a las 7 y a su correo, luego a las 8, a tres
 * correos y cada LUNES con la semana pasada completa, de lunes a domingo).
 *
 * Las cuatro plataformas salen del MISMO motor que el corte general,
 * recortado a un día (`cargarConsolidado` con `desde` = `hasta` = ayer);
 * TikTok es su cuarto canal (`consolidado-tiktok.ts`): lo que TikTok dice
 * que paga por cada pedido en pie.
 *
 * «Ganancia del día» = neto real − costo de los pares − publicidad. Los
 * gastos de plataforma que MELI y Amazon cobran por mes (almacenamiento de
 * Full, facturación, colecta) NO se reparten en un día: van en el corte del
 * mes, que el correo enseña abajo. Y como NADA SE ESTIMA, la venta cuyo
 * depósito aún no se lee (o el pedido de TikTok que TikTok todavía no
 * calcula) queda fuera de la ganancia y el correo lo dice.
 */
import type { Cuenta, DB } from "../datos/repos";
import { cargarConsolidado, leerConsolidadoGuardado } from "./consolidado-cargar";
import type { Consolidado } from "./consolidado";
import { enviarCorreo, type ResultadoCorreo } from "./correo";
import { LETRA_TITULO, TONO, URL_ERP, plantillaCorreo } from "./correo-marca";

export const TAREA_RESUMEN_DIARIO = "correo-resumen-diario";

/** Los que pidió el dueño (28-sep-2026). */
export const DESTINATARIOS_RESUMEN = ["abraham.darwish@yapanizcel.com.mx", "danidarwish1@gmail.com", "izickd@gmail.com"];

/** A quién va: `CORREO_RESUMEN_DIARIO` (separados por coma), si no los del dueño. */
export function destinatariosResumen(): string[] {
  const env = (process.env.CORREO_RESUMEN_DIARIO ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return env.length ? env : DESTINATARIOS_RESUMEN;
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
  /** los lunes: la semana pasada, de lunes a domingo */
  semana?: { desde: string; hasta: string; filas: FilaResumen[]; total: { unidades: number; facturacion: number; ganancia: number } } | null;
  /** el mes hasta ayer (del corte general guardado) */
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
      notas.push(
        k.canal === "tiktok"
          ? `${pesos(sinLeer)} de venta que TikTok aún no dice cuánto paga: fuera de la ganancia`
          : `${Math.round(k.coberturaNeto * 100)} % con depósito leído: ${pesos(sinLeer)} de venta aún sin depósito, fuera de la ganancia`,
      );
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

function totalDe(filas: FilaResumen[]) {
  return {
    unidades: filas.reduce((a, f) => a + f.unidades, 0),
    facturacion: r2(filas.reduce((a, f) => a + f.facturacion, 0)),
    ganancia: r2(filas.reduce((a, f) => a + (f.ganancia ?? 0), 0)),
  };
}

const ORDEN_CANALES = ["meli_calzado", "meli_fundas", "amazon", "tiktok"];
const NOMBRES: Record<string, string> = { meli_calzado: "Calzado · Mercado Libre", meli_fundas: "Fundas · Mercado Libre", amazon: "Amazon", tiktok: "TikTok Shop" };

/** Las cuatro plataformas en orden, aunque alguna no haya vendido. */
function ordenar(filas: FilaResumen[]): FilaResumen[] {
  return ORDEN_CANALES.map((canal) => filas.find((f) => f.canal === canal) ?? { canal, nombre: NOMBRES[canal], unidades: 0, facturacion: 0, ganancia: null, notas: [] });
}

/** Si `dia` es domingo, la semana que cierra (lunes a domingo); si no, null. */
export function semanaQueCierra(dia: string): { desde: string; hasta: string } | null {
  const d = new Date(`${dia}T12:00:00Z`);
  if (d.getUTCDay() !== 0) return null;
  return { desde: new Date(d.getTime() - 6 * 86_400_000).toISOString().slice(0, 10), hasta: dia };
}

/** Un rango partido por mes: el corte general se carga por periodo. */
export function tramosPorMes(desde: string, hasta: string): { periodo: string; desde: string; hasta: string }[] {
  const tramos: { periodo: string; desde: string; hasta: string }[] = [];
  let inicio = desde;
  while (inicio <= hasta) {
    const [a, m] = inicio.split("-").map(Number);
    const finMes = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
    const fin = finMes < hasta ? finMes : hasta;
    tramos.push({ periodo: inicio.slice(0, 7), desde: inicio, hasta: fin });
    inicio = new Date(Date.parse(`${fin}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  }
  return tramos;
}

/** Suma por plataforma las filas de varios tramos (una semana que cruza de mes). */
export function sumarFilas(listas: FilaResumen[][]): FilaResumen[] {
  const porCanal = new Map<string, FilaResumen>();
  for (const lista of listas) {
    for (const f of lista) {
      const a = porCanal.get(f.canal);
      if (!a) {
        porCanal.set(f.canal, { ...f, notas: [...f.notas] });
        continue;
      }
      a.unidades += f.unidades;
      a.facturacion = r2(a.facturacion + f.facturacion);
      a.ganancia = a.ganancia == null && f.ganancia == null ? null : r2((a.ganancia ?? 0) + (f.ganancia ?? 0));
      a.notas.push(...f.notas);
    }
  }
  return ordenar([...porCanal.values()]);
}

export function armarResumen(dia: string, consolidadoDia: Consolidado | null, mes: { periodo: string; consolidado: Consolidado | null } | null, avisos: string[] = []): ResumenDiario {
  const filas = ordenar(consolidadoDia ? filasDeConsolidado(consolidadoDia, true) : []);
  const resumenMes: ResumenDiario["mes"] = mes?.consolidado
    ? (() => {
        const f = ordenar(filasDeConsolidado(mes.consolidado!, false));
        return { periodo: mes.periodo, filas: f, total: totalDe(f) };
      })()
    : null;
  return { dia, filas, total: totalDe(filas), mes: resumenMes, avisos };
}

/** Le pone al resumen la semana ya sumada. */
export function conSemana(r: ResumenDiario, semana: { desde: string; hasta: string }, consolidados: Consolidado[]): ResumenDiario {
  const filas = sumarFilas(consolidados.map((c) => filasDeConsolidado(c, true)));
  return { ...r, semana: { ...semana, filas, total: totalDe(filas) } };
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

/** El color de cada plataforma en las gráficas de la página. */
const COLOR_CANAL: Record<string, string> = {
  meli_calzado: "#a35f1c",
  meli_fundas: "#2f9c63",
  amazon: "#3a72b8",
  tiktok: "#d3a52e",
};

function colorGanancia(g: number | null): string {
  return g == null ? TONO.tenue : g < 0 ? TONO.mal : TONO.bien;
}

function tabla(filas: FilaResumen[], total: ResumenDiario["total"], tituloGanancia: string): string {
  const celda = `padding:10px 12px;border-bottom:1px solid ${TONO.borde};font-size:14px;`;
  const num = `${celda}text-align:right;white-space:nowrap;`;
  const encabezado = `padding:8px 12px;font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:${TONO.tenue};font-weight:700;border-bottom:1px solid ${TONO.borde};background:${TONO.suave};`;
  const renglones = filas
    .map(
      (f) =>
        `<tr><td style="${celda}">` +
        `<span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${COLOR_CANAL[f.canal] ?? TONO.acento};margin-right:8px;vertical-align:middle;"></span>` +
        `<span style="vertical-align:middle;">${esc(f.nombre)}</span>` +
        (f.notas.length ? `<div class="g-nota" style="font-size:11px;color:${TONO.tenue};margin:4px 0 0 16px;">${f.notas.map(esc).join(" · ")}</div>` : "") +
        `</td>` +
        `<td style="${num}">${n(f.unidades)}</td><td style="${num}">${pesos(f.facturacion)}</td>` +
        `<td style="${num}font-weight:700;color:${colorGanancia(f.ganancia)}">${f.ganancia == null ? "—" : pesos(f.ganancia)}</td></tr>`,
    )
    .join("");
  const pie = `padding:10px 12px;font-size:14px;font-weight:700;background:${TONO.acentoSuave};`;
  return (
    `<table class="g-t" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid ${TONO.borde};border-radius:8px;">` +
    `<tr><th align="left" style="${encabezado}">Plataforma</th><th align="right" style="${encabezado}">Unidades</th><th align="right" style="${encabezado}">Facturación</th><th align="right" style="${encabezado}">${esc(tituloGanancia)}</th></tr>` +
    renglones +
    `<tr><td style="${pie}">Total</td><td style="${pie}text-align:right;">${n(total.unidades)}</td><td style="${pie}text-align:right;">${pesos(total.facturacion)}</td><td style="${pie}text-align:right;color:${colorGanancia(total.ganancia)}">${pesos(total.ganancia)}</td></tr>` +
    `</table>`
  );
}

/** Las tres cifras grandes de arriba, como las `<Cifras>` de la página. */
function cifras(total: ResumenDiario["total"]): string {
  const caja = (etiqueta: string, valor: string, color: string = TONO.tinta) =>
    `<td class="g-cifra" width="33%" valign="top" style="padding:14px 16px;background:${TONO.suave};border:1px solid ${TONO.borde};border-radius:8px;">` +
    `<div style="font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:${TONO.tenue};font-weight:700;">${etiqueta}</div>` +
    `<div style="font-family:${LETRA_TITULO};font-size:22px;font-weight:600;color:${color};margin-top:4px;white-space:nowrap;">${valor}</div></td>`;
  const hueco = `<td class="g-hueco" width="10" style="font-size:0;line-height:0;">&nbsp;</td>`;
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 0 20px;"><tr>` +
    caja("Unidades", n(total.unidades)) + hueco +
    caja("Facturación", pesos(total.facturacion)) + hueco +
    caja("Ganancia", pesos(total.ganancia), colorGanancia(total.ganancia)) +
    `</tr></table>`
  );
}

function subtitulo(texto: string, nota: string): string {
  return (
    `<h2 style="margin:28px 0 4px;font-family:${LETRA_TITULO};font-size:19px;font-weight:600;color:${TONO.tinta};">${esc(texto)}</h2>` +
    `<p style="margin:0 0 12px;font-size:13px;color:${TONO.tinta2};">${esc(nota)}</p>`
  );
}

export function armarCorreoResumen(r: ResumenDiario): { asunto: string; html: string; texto: string } {
  const asunto = r.semana
    ? `Ventas de ayer y de la semana: ${n(r.semana.total.unidades)} unidades · ${pesos(r.semana.total.facturacion)} · ganancia ${pesos(r.semana.total.ganancia)} en la semana`
    : `Ventas de ayer (${fechaLarga(r.dia)}): ${n(r.total.unidades)} unidades · ${pesos(r.total.facturacion)} · ganancia ${pesos(r.total.ganancia)}`;
  const partes: string[] = [];
  partes.push(cifras(r.total));
  partes.push(tabla(r.filas, r.total, "Ganancia"));
  partes.push(
    `<p style="margin:10px 0 0;font-size:12px;color:${TONO.tenue};">Ganancia del día = neto real − costo de los pares − publicidad. Los gastos que las plataformas cobran por mes (almacenamiento de Full y FBA, facturación, colecta) van en el corte del mes.</p>`,
  );
  if (r.semana) {
    partes.push(subtitulo(`Semana pasada · del ${fechaLarga(r.semana.desde)} al ${fechaLarga(r.semana.hasta)}`, "Misma cuenta que el día: neto real − costo − publicidad, sin los gastos del mes."));
    partes.push(tabla(r.semana.filas, r.semana.total, "Ganancia"));
  }
  if (r.mes) {
    const [a, m] = r.mes.periodo.split("-").map(Number);
    partes.push(subtitulo(`${MESES[m - 1].charAt(0).toUpperCase()}${MESES[m - 1].slice(1)} ${a} hasta hoy`, "Del Estado de resultados: ganancia después de los gastos de cada plataforma, antes de gastos empresariales."));
    partes.push(tabla(r.mes.filas, r.mes.total, "Ganancia"));
  }
  if (r.avisos.length) {
    partes.push(
      `<div style="margin:20px 0 0;padding:12px 14px;background:${TONO.alertaSuave};border:1px solid #f1dfb5;border-radius:8px;font-size:12px;color:${TONO.alerta};">` +
        r.avisos.map((x) => `<div style="margin:2px 0;">• ${esc(x)}</div>`).join("") +
        `</div>`,
    );
  }
  const html = plantillaCorreo({
    preencabezado: `${n(r.total.unidades)} unidades · ${pesos(r.total.facturacion)} · ganancia ${pesos(r.total.ganancia)}`,
    ceja: "Resumen de ventas",
    titulo: `Ventas de ayer`,
    subtitulo: fechaLarga(r.dia).charAt(0).toUpperCase() + fechaLarga(r.dia).slice(1),
    cuerpo: partes.join(""),
    boton: { texto: "Abrir Estado de resultados", url: `${URL_ERP}/cortes` },
  });

  const lineas = [`Ventas de ayer · ${fechaLarga(r.dia)}`, ""];
  for (const f of r.filas) lineas.push(`${f.nombre}: ${n(f.unidades)} u · ${pesos(f.facturacion)} · ganancia ${f.ganancia == null ? "—" : pesos(f.ganancia)}${f.notas.length ? ` (${f.notas.join("; ")})` : ""}`);
  lineas.push(`Total: ${n(r.total.unidades)} u · ${pesos(r.total.facturacion)} · ganancia ${pesos(r.total.ganancia)}`);
  if (r.semana) {
    lineas.push("", `Semana del ${fechaLarga(r.semana.desde)} al ${fechaLarga(r.semana.hasta)}`);
    for (const f of r.semana.filas) lineas.push(`${f.nombre}: ${n(f.unidades)} u · ${pesos(f.facturacion)} · ganancia ${f.ganancia == null ? "—" : pesos(f.ganancia)}`);
    lineas.push(`Total: ${n(r.semana.total.unidades)} u · ${pesos(r.semana.total.facturacion)} · ganancia ${pesos(r.semana.total.ganancia)}`);
  }
  if (r.avisos.length) lineas.push("", ...r.avisos);
  return { asunto, html, texto: lineas.join("\n") };
}

// ---------------------------------------------------------------------------
// Carga y envío
// ---------------------------------------------------------------------------

export async function cargarResumenDiario(db: DB, cuenta: Cuenta, dia: string): Promise<ResumenDiario> {
  const periodo = dia.slice(0, 7);
  const avisos: string[] = [];
  const semana = semanaQueCierra(dia);
  const cargarSemana = async (): Promise<Consolidado[] | null> => {
    if (!semana) return null;
    try {
      return await Promise.all(
        tramosPorMes(semana.desde, semana.hasta).map((t) =>
          cargarConsolidado(db, cuenta, t.periodo, {
            desde: t.desde,
            hasta: t.hasta,
            alFallarCanal: (canal, motivo) => avisos.push(`Semana · ${canal}: no se pudo leer (${motivo}).`),
          }),
        ),
      );
    } catch (err) {
      avisos.push(`No se pudo leer la semana: ${(err as Error).message}.`);
      return null;
    }
  };
  const [consolidadoDia, mesGuardado, semanaCargada] = await Promise.all([
    cargarConsolidado(db, cuenta, periodo, {
      desde: dia,
      hasta: dia,
      alFallarCanal: (canal, motivo) => avisos.push(`${canal}: no se pudo leer (${motivo}).`),
    }).catch((err) => {
      avisos.push(`No se pudieron leer las ventas: ${(err as Error).message}.`);
      return null;
    }),
    leerConsolidadoGuardado(db, cuenta, periodo),
    cargarSemana(),
  ]);
  const r = armarResumen(dia, consolidadoDia, { periodo, consolidado: mesGuardado }, avisos);
  return semana && semanaCargada ? conSemana(r, semana, semanaCargada) : r;
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
  opts: { dia?: string; forzar?: boolean; para?: string | string[] } = {},
): Promise<{ dia: string; enviado: boolean; omitido?: string; correo?: ResultadoCorreo; total?: ResumenDiario["total"] }> {
  const dia = opts.dia ?? diaAnterior(hoyMx());
  if (!opts.forzar && (await yaEnviado(db, cuenta.id, dia))) return { dia, enviado: false, omitido: "ya se mandó el de ese día" };
  if (!process.env.RESEND_API_KEY) return { dia, enviado: false, omitido: "el correo no está configurado (RESEND_API_KEY)" };
  const resumen = await cargarResumenDiario(db, cuenta, dia);
  const { asunto, html, texto } = armarCorreoResumen(resumen);
  const para = opts.para ?? destinatariosResumen();
  const correo = await enviarCorreo({ para, asunto, html, texto });
  await db.from("sync_log").insert({
    account_id: cuenta.id,
    tarea: TAREA_RESUMEN_DIARIO,
    estado: correo.enviado ? "ok" : "error",
    fin: new Date().toISOString(),
    detalle: { dia, para, enviado: correo.enviado, id: correo.id ?? null, motivo: correo.motivo ?? null, total: resumen.total, semana: resumen.semana ? { desde: resumen.semana.desde, hasta: resumen.semana.hasta, total: resumen.semana.total } : null, filas: resumen.filas, avisos: resumen.avisos },
  });
  return { dia, enviado: correo.enviado, correo, total: resumen.total };
}
