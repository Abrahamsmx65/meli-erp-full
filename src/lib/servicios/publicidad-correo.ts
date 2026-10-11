/**
 * Correo de PUBLICIDAD cada mañana (pedido del dueño, 11-oct-2026: «cada día
 * en la mañana me mandas qué cambios hay que hacer» en publicidad).
 *
 * Son las MISMAS recomendaciones del panel de Publicidad
 * (`armarRecomendaciones`: publicidad × stock de Full × margen) sobre los
 * últimos 14 días completos (hasta ayer), listas para ejecutarse a mano en
 * la consola de Product Ads: el API de MELI no deja escribir publicidad.
 *
 * Para que el correo diga qué CAMBIÓ y no repita la misma lista sin
 * contexto, cada envío guarda sus recomendaciones en `sync_log` (tarea
 * `correo-publicidad`) y el siguiente las compara (`compararConAnterior`):
 * lo NUEVO de hoy va marcado, lo que sigue pendiente dice desde cuándo y lo
 * que ya no hace falta (se hizo o se compuso solo) sale aparte.
 */
import type { Cuenta, DB } from "../datos/repos";
import { enviarCorreo, type ResultadoCorreo } from "./correo";
import { LETRA_TITULO, TONO, URL_ERP, escaparHtml as esc, plantillaCorreo } from "./correo-marca";
import {
  GRUPOS_ACCION,
  calcularPublicidadFresca,
  type AccionSugerida,
  type Publicidad,
  type RecomendacionAds,
} from "./publicidad";
import { DESTINATARIOS_RESUMEN, diaAnterior, fechaLarga, hoyMx } from "./resumen-diario";

export const TAREA_CORREO_PUBLICIDAD = "correo-publicidad";

/** Días completos que se miran (hasta ayer): los mismos que pesan en Full. */
export const DIAS_CORREO_PUBLICIDAD = 14;

/** A quién va: `CORREO_PUBLICIDAD` (separados por coma), si no los del resumen diario. */
export function destinatariosPublicidad(): string[] {
  const env = (process.env.CORREO_PUBLICIDAD ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return env.length ? env : DESTINATARIOS_RESUMEN;
}

/** Lo que se guarda de cada recomendación para compararla al día siguiente. */
export interface RecomendacionGuardada {
  modelo: string;
  accion: AccionSugerida;
  queHacer: string;
  /** primer día (México) en que el correo la pidió */
  desde: string;
}

export interface RecomendacionDelDia extends RecomendacionAds {
  /** primer día en que se pidió; = hoy si es nueva */
  desde: string;
  nueva: boolean;
}

export interface CorreoPublicidad {
  /** día del envío (México) */
  dia: string;
  rango: { desde: string; hasta: string };
  recomendaciones: RecomendacionDelDia[];
  /** las del correo anterior que hoy ya no salen */
  resueltas: RecomendacionGuardada[];
  /** había un correo anterior contra el cual comparar */
  conAnterior: boolean;
  totales: Publicidad["totales"];
  avisos: string[];
}

const clave = (r: { modelo: string; accion: AccionSugerida }) => `${r.modelo}|${r.accion}`;

/**
 * Marca cada recomendación de hoy como NUEVA o como pendiente desde el día en
 * que se pidió por primera vez, y saca las de ayer que ya no salen. Se
 * compara por modelo + acción: si cambia la acción (de «bajar» a «pausar»),
 * es otra cosa que hacer y sale como nueva.
 */
export function compararConAnterior(
  hoy: RecomendacionAds[],
  anterior: RecomendacionGuardada[] | null,
  dia: string,
): { recomendaciones: RecomendacionDelDia[]; resueltas: RecomendacionGuardada[] } {
  const previas = new Map((anterior ?? []).map((r) => [clave(r), r]));
  const recomendaciones = hoy.map((r) => {
    const previa = previas.get(clave(r));
    // Sin correo anterior no hay contra qué: nada se marca como nuevo.
    if (anterior == null) return { ...r, desde: dia, nueva: false };
    return previa ? { ...r, desde: previa.desde, nueva: false } : { ...r, desde: dia, nueva: true };
  });
  const deHoy = new Set(hoy.map(clave));
  const resueltas = (anterior ?? []).filter((r) => !deHoy.has(clave(r)));
  return { recomendaciones, resueltas };
}

export function paraGuardar(rs: RecomendacionDelDia[]): RecomendacionGuardada[] {
  return rs.map((r) => ({ modelo: r.modelo, accion: r.accion, queHacer: r.queHacer, desde: r.desde }));
}

export function armarCorreoDePublicidad(o: {
  dia: string;
  rango: { desde: string; hasta: string };
  publicidad: Publicidad;
  anterior: RecomendacionGuardada[] | null;
}): CorreoPublicidad {
  const p = o.publicidad;
  const { recomendaciones, resueltas } = compararConAnterior(p.recomendaciones, o.anterior, o.dia);
  const avisos: string[] = [];
  if (p.errorAds) avisos.push(p.errorAds);
  if (p.errorRecomendaciones) avisos.push(p.errorRecomendaciones);
  avisos.push(...p.advertencias.filter((a) => a !== p.errorRecomendaciones));
  if (p.sinAmarre.gasto > 0) {
    avisos.push(`${pesos(p.sinAmarre.gasto)} de gasto en ${p.sinAmarre.anuncios} anuncio(s) que no amarran con ningún modelo del catálogo.`);
  }
  return {
    dia: o.dia,
    rango: o.rango,
    recomendaciones,
    resueltas,
    conAnterior: o.anterior != null,
    totales: p.totales,
    avisos,
  };
}

// ---------------------------------------------------------------------------
// Correo
// ---------------------------------------------------------------------------

function pesos(x: number): string {
  return (x < 0 ? "-$" : "$") + Math.round(Math.abs(x)).toLocaleString("es-MX");
}
const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(1)} %`);

const COLOR_ACCION: Record<AccionSugerida, string> = {
  apagar: TONO.mal,
  pausar: TONO.mal,
  bajar: TONO.alerta,
  subir: TONO.bien,
  encender: TONO.bien,
  activar: TONO.acento,
};

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000);
}

function etiquetaEstado(r: RecomendacionDelDia, dia: string): string {
  if (r.nueva) {
    return `<span style="display:inline-block;padding:1px 6px;border-radius:4px;background:${TONO.acento};color:#ffffff;font-size:10px;font-weight:700;letter-spacing:0.5px;">NUEVO HOY</span>`;
  }
  const dias = diasEntre(r.desde, dia);
  if (dias <= 0) return "";
  return `<span style="font-size:11px;color:${TONO.tenue};">pendiente desde hace ${dias} día${dias === 1 ? "" : "s"}</span>`;
}

function tablaGrupo(rs: RecomendacionDelDia[], dia: string): string {
  const celda = `padding:10px 12px;border-bottom:1px solid ${TONO.borde};font-size:13px;vertical-align:top;`;
  const encabezado = `padding:8px 12px;font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:${TONO.tenue};font-weight:700;border-bottom:1px solid ${TONO.borde};background:${TONO.suave};`;
  const renglones = rs
    .map(
      (r) =>
        `<tr${r.nueva ? ` style="background:${TONO.acentoSuave};"` : ""}>` +
        `<td style="${celda}font-weight:700;white-space:nowrap;">${esc(r.modelo)}</td>` +
        `<td style="${celda}"><div style="font-weight:700;color:${COLOR_ACCION[r.accion]};">${esc(r.queHacer)}</div>` +
        `<div class="g-nota" style="font-size:12px;color:${TONO.tinta2};margin-top:3px;">${esc(r.razon)}</div>` +
        `<div style="margin-top:4px;">${etiquetaEstado(r, dia)}</div></td></tr>`,
    )
    .join("");
  return (
    `<table class="g-t" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid ${TONO.borde};border-radius:8px;">` +
    `<tr><th align="left" style="${encabezado}">Modelo</th><th align="left" style="${encabezado}">Qué hacer y por qué</th></tr>` +
    renglones +
    `</table>`
  );
}

function cifras(c: CorreoPublicidad): string {
  const nuevas = c.recomendaciones.filter((r) => r.nueva).length;
  const caja = (etiqueta: string, valor: string, color: string = TONO.tinta) =>
    `<td class="g-cifra" width="33%" valign="top" style="padding:14px 16px;background:${TONO.suave};border:1px solid ${TONO.borde};border-radius:8px;">` +
    `<div style="font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:${TONO.tenue};font-weight:700;">${etiqueta}</div>` +
    `<div style="font-family:${LETRA_TITULO};font-size:22px;font-weight:600;color:${color};margin-top:4px;white-space:nowrap;">${valor}</div></td>`;
  const hueco = `<td class="g-hueco" width="10" style="font-size:0;line-height:0;">&nbsp;</td>`;
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 0 20px;"><tr>` +
    caja("Cambios por hacer", `${c.recomendaciones.length}${c.conAnterior ? ` · ${nuevas} nuevos` : ""}`, c.recomendaciones.length ? TONO.acento : TONO.bien) +
    hueco +
    caja(`Gasto en ads · ${DIAS_CORREO_PUBLICIDAD} días`, pesos(c.totales.gastoAds)) +
    hueco +
    caja("TACOS · ACOS", `${pct(c.totales.tacos)} · ${pct(c.totales.acos)}`) +
    `</tr></table>`
  );
}

function subtitulo(texto: string, nota?: string): string {
  return (
    `<h2 style="margin:24px 0 ${nota ? 4 : 10}px;font-family:${LETRA_TITULO};font-size:18px;font-weight:600;color:${TONO.tinta};">${esc(texto)}</h2>` +
    (nota ? `<p style="margin:0 0 10px;font-size:13px;color:${TONO.tinta2};">${esc(nota)}</p>` : "")
  );
}

export function htmlCorreoPublicidad(c: CorreoPublicidad): { asunto: string; html: string; texto: string } {
  const nuevas = c.recomendaciones.filter((r) => r.nueva).length;
  const asunto = c.recomendaciones.length
    ? `Publicidad hoy: ${c.recomendaciones.length} cambio${c.recomendaciones.length === 1 ? "" : "s"} por hacer${c.conAnterior ? ` (${nuevas} nuevo${nuevas === 1 ? "" : "s"})` : ""}`
    : "Publicidad hoy: nada que cambiar";
  const partes: string[] = [cifras(c)];

  if (!c.recomendaciones.length) {
    partes.push(`<p style="margin:0;font-size:14px;color:${TONO.tinta2};">Ningún anuncio pide cambios hoy: nada gasta sin stock, nada se come el margen y no hay productos nuevos en Full sin anuncio.</p>`);
  }
  for (const grupo of GRUPOS_ACCION) {
    const delGrupo = c.recomendaciones
      .filter((r) => grupo.acciones.includes(r.accion))
      // Dentro del grupo, lo nuevo primero; luego el orden del panel.
      .sort((a, b) => Number(b.nueva) - Number(a.nueva));
    if (!delGrupo.length) continue;
    partes.push(subtitulo(`${grupo.titulo} (${delGrupo.length})`));
    partes.push(tablaGrupo(delGrupo, c.dia));
  }
  if (c.resueltas.length) {
    partes.push(subtitulo(`Ya no hace falta (${c.resueltas.length})`, "Salían en el correo anterior y hoy ya no: se hicieron o se compusieron solas."));
    partes.push(
      `<div style="font-size:13px;color:${TONO.tinta2};">` +
        c.resueltas.map((r) => `<div style="margin:3px 0;">✓ <b>${esc(r.modelo)}</b> · ${esc(r.queHacer)}</div>`).join("") +
        `</div>`,
    );
  }
  partes.push(
    `<p style="margin:18px 0 0;font-size:12px;color:${TONO.tenue};">Product Ads de Mercado Libre (calzado), del ${esc(fechaLarga(c.rango.desde))} al ${esc(fechaLarga(c.rango.hasta))}. Cruza el gasto de cada modelo con su stock en Full y su margen real. Los cambios se hacen a mano en la consola de Product Ads: MELI no deja escribir publicidad por API.</p>`,
  );
  if (c.avisos.length) {
    partes.push(
      `<div style="margin:16px 0 0;padding:12px 14px;background:${TONO.alertaSuave};border:1px solid #f1dfb5;border-radius:8px;font-size:12px;color:${TONO.alerta};">` +
        c.avisos.map((x) => `<div style="margin:2px 0;">• ${esc(x)}</div>`).join("") +
        `</div>`,
    );
  }
  const subtituloFecha = fechaLarga(c.dia);
  const html = plantillaCorreo({
    preencabezado: asunto,
    ceja: "Publicidad",
    titulo: "Cambios de publicidad para hoy",
    subtitulo: subtituloFecha.charAt(0).toUpperCase() + subtituloFecha.slice(1),
    cuerpo: partes.join(""),
    boton: { texto: "Abrir Publicidad", url: `${URL_ERP}/publicidad` },
  });

  const lineas = [`Cambios de publicidad · ${fechaLarga(c.dia)}`, ""];
  for (const grupo of GRUPOS_ACCION) {
    const delGrupo = c.recomendaciones.filter((r) => grupo.acciones.includes(r.accion));
    if (!delGrupo.length) continue;
    lineas.push(grupo.titulo);
    for (const r of delGrupo) lineas.push(`${r.nueva ? "[NUEVO] " : ""}${r.modelo}: ${r.queHacer}. ${r.razon}`);
    lineas.push("");
  }
  if (!c.recomendaciones.length) lineas.push("Nada que cambiar hoy.", "");
  if (c.resueltas.length) {
    lineas.push("Ya no hace falta:");
    for (const r of c.resueltas) lineas.push(`✓ ${r.modelo}: ${r.queHacer}`);
    lineas.push("");
  }
  if (c.avisos.length) lineas.push(...c.avisos);
  return { asunto, html, texto: lineas.join("\n") };
}

// ---------------------------------------------------------------------------
// Carga y envío
// ---------------------------------------------------------------------------

interface EnvioAnterior {
  dia: string;
  recomendaciones: RecomendacionGuardada[];
}

/** Los últimos correos mandados (el cron puede dispararse dos veces). */
async function enviosAnteriores(db: DB, accountId: string): Promise<EnvioAnterior[]> {
  const { data } = await db
    .from("sync_log")
    .select("detalle")
    .eq("account_id", accountId)
    .eq("tarea", TAREA_CORREO_PUBLICIDAD)
    .eq("estado", "ok")
    .order("inicio", { ascending: false })
    .limit(5);
  return (data ?? [])
    .map((f: any) => f.detalle)
    .filter((d: any) => d?.enviado === true && typeof d.dia === "string" && Array.isArray(d.recomendaciones))
    .map((d: any) => ({ dia: d.dia, recomendaciones: d.recomendaciones as RecomendacionGuardada[] }));
}

export async function enviarCorreoPublicidad(
  db: DB,
  cuenta: Cuenta,
  opts: { forzar?: boolean; para?: string | string[] } = {},
): Promise<{ dia: string; enviado: boolean; omitido?: string; correo?: ResultadoCorreo; cambios?: number; nuevos?: number }> {
  const dia = hoyMx();
  const previos = await enviosAnteriores(db, cuenta.id);
  if (!opts.forzar && previos.some((p) => p.dia === dia)) return { dia, enviado: false, omitido: "ya se mandó el de hoy" };
  if (!process.env.RESEND_API_KEY) return { dia, enviado: false, omitido: "el correo no está configurado (RESEND_API_KEY)" };

  const hasta = diaAnterior(dia);
  const desde = new Date(Date.parse(`${hasta}T12:00:00Z`) - (DIAS_CORREO_PUBLICIDAD - 1) * 86_400_000).toISOString().slice(0, 10);
  const rango = { desde, hasta };
  const publicidad = await calcularPublicidadFresca(db, { id: cuenta.id, site_id: cuenta.site_id }, rango);
  // Contra el último correo de OTRO día (un reenvío forzado no se compara consigo mismo).
  const anterior = previos.find((p) => p.dia !== dia)?.recomendaciones ?? null;
  const c = armarCorreoDePublicidad({ dia, rango, publicidad, anterior });
  const { asunto, html, texto } = htmlCorreoPublicidad(c);
  const para = opts.para ?? destinatariosPublicidad();
  const correo = await enviarCorreo({ para, asunto, html, texto });
  const nuevos = c.recomendaciones.filter((r) => r.nueva).length;
  await db.from("sync_log").insert({
    account_id: cuenta.id,
    tarea: TAREA_CORREO_PUBLICIDAD,
    estado: correo.enviado ? "ok" : "error",
    fin: new Date().toISOString(),
    detalle: {
      dia,
      rango,
      para,
      enviado: correo.enviado,
      id: correo.id ?? null,
      motivo: correo.motivo ?? null,
      recomendaciones: paraGuardar(c.recomendaciones),
      resueltas: c.resueltas.length,
      avisos: c.avisos,
    },
  });
  return { dia, enviado: correo.enviado, correo, cambios: c.recomendaciones.length, nuevos };
}
