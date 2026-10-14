/**
 * Correo de PUBLICIDAD los LUNES y JUEVES en la mañana (pedido del dueño,
 * 11-oct-2026: «cada día en la mañana me mandas qué cambios hay que hacer»;
 * el mismo día: «en los 3, Amazon, MELI calzado y MELI fundas, lunes y
 * jueves solamente, solo lo recibo yo»).
 *
 * Son las MISMAS recomendaciones del panel de Publicidad
 * (`armarRecomendaciones`: publicidad × stock × margen) sobre los últimos 14
 * días completos (hasta ayer), por canal: calzado y fundas en Mercado Libre
 * (Product Ads) y Amazon (SKU Economics + FBA, `publicidad-canales.ts`).
 * Se ejecutan a mano en cada consola: el ERP no escribe publicidad.
 *
 * Para que el correo diga qué CAMBIÓ y no repita la misma lista sin
 * contexto, cada envío guarda sus recomendaciones en `sync_log` (tarea
 * `correo-publicidad`) y el siguiente las compara (`compararConAnterior`):
 * lo NUEVO desde el correo anterior va marcado, lo que sigue pendiente dice
 * desde cuándo y lo que ya no hace falta (se hizo o se compuso solo) sale
 * aparte.
 */
import type { Cuenta, DB } from "../datos/repos";
import { enviarCorreo, type ResultadoCorreo } from "./correo";
import { LETRA_TITULO, TONO, URL_ERP, escaparHtml as esc, plantillaCorreo } from "./correo-marca";
import { GRUPOS_ACCION, TACOS_TOPE, calcularPublicidadFresca, type AccionSugerida, type RecomendacionAds } from "./publicidad";
import { publicidadAmazon, publicidadFundas, type PublicidadCanal } from "./publicidad-canales";
import { diaAnterior, fechaLarga, hoyMx } from "./resumen-diario";

export const TAREA_CORREO_PUBLICIDAD = "correo-publicidad";

/** Días completos que se miran (hasta ayer). */
export const DIAS_CORREO_PUBLICIDAD = 14;

/** Solo el dueño (11-oct-2026: «solo lo recibo yo»). */
export const DESTINATARIO_PUBLICIDAD = "abraham.darwish@yapanizcel.com.mx";

/** A quién va: `CORREO_PUBLICIDAD` (separados por coma), si no el dueño. */
export function destinatariosPublicidad(): string[] {
  const env = (process.env.CORREO_PUBLICIDAD ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return env.length ? env : [DESTINATARIO_PUBLICIDAD];
}

export type CanalAds = "meli_calzado" | "meli_fundas" | "amazon";

export const CANALES_ADS: { canal: CanalAds; nombre: string; consola: string; url: string }[] = [
  { canal: "meli_calzado", nombre: "Calzado · Mercado Libre", consola: "Product Ads de la cuenta de calzado", url: `${URL_ERP}/publicidad` },
  { canal: "meli_fundas", nombre: "Fundas · Mercado Libre", consola: "Product Ads de la cuenta de fundas", url: `${URL_ERP}/yapanizcel` },
  { canal: "amazon", nombre: "Amazon", consola: "Sponsored Products de Amazon", url: `${URL_ERP}/amazon/publicidad` },
];

/** Lo que se guarda de cada recomendación para compararla en el correo siguiente. */
export interface RecomendacionGuardada {
  canal?: CanalAds;
  modelo: string;
  accion: AccionSugerida;
  queHacer: string;
  /** primer día (México) en que el correo la pidió */
  desde: string;
}

export interface RecomendacionDelDia extends RecomendacionAds {
  canal: CanalAds;
  /** primer día en que se pidió; = hoy si es nueva */
  desde: string;
  nueva: boolean;
}

export interface SeccionCanal {
  canal: CanalAds;
  nombre: string;
  consola: string;
  url: string;
  recomendaciones: RecomendacionDelDia[];
  resueltas: RecomendacionGuardada[];
  gastoAds: number;
  tacos: number | null;
  hasta: string | null;
  avisos: string[];
}

export interface CorreoPublicidad {
  /** día del envío (México) */
  dia: string;
  rango: { desde: string; hasta: string };
  secciones: SeccionCanal[];
  /** había un correo anterior contra el cual comparar */
  conAnterior: boolean;
  /** día del correo anterior */
  diaAnterior: string | null;
}

const clave = (r: { canal?: CanalAds; modelo: string; accion: AccionSugerida }) => `${r.canal ?? "meli_calzado"}|${r.modelo}|${r.accion}`;

/**
 * Marca cada recomendación como NUEVA o como pendiente desde el día en que se
 * pidió por primera vez, y saca las del correo anterior que ya no salen. Se
 * compara por canal + modelo + acción: si cambia la acción (de «bajar» a
 * «pausar»), es otra cosa que hacer y sale como nueva. Un canal que hoy no
 * se pudo leer no da nada por resuelto (`canalesLeidos`).
 */
export function compararConAnterior(
  hoy: { canal: CanalAds; recomendaciones: RecomendacionAds[] }[],
  anterior: RecomendacionGuardada[] | null,
  dia: string,
  canalesLeidos: Set<CanalAds> = new Set(hoy.map((h) => h.canal)),
): { recomendaciones: RecomendacionDelDia[]; resueltas: RecomendacionGuardada[] } {
  const previas = new Map((anterior ?? []).map((r) => [clave(r), r]));
  const recomendaciones: RecomendacionDelDia[] = [];
  for (const h of hoy) {
    for (const r of h.recomendaciones) {
      const previa = previas.get(clave({ ...r, canal: h.canal }));
      // Sin correo anterior no hay contra qué: nada se marca como nuevo.
      if (anterior == null) recomendaciones.push({ ...r, canal: h.canal, desde: dia, nueva: false });
      else if (previa) recomendaciones.push({ ...r, canal: h.canal, desde: previa.desde, nueva: false });
      else recomendaciones.push({ ...r, canal: h.canal, desde: dia, nueva: true });
    }
  }
  const deHoy = new Set(recomendaciones.map(clave));
  const resueltas = (anterior ?? []).filter((r) => canalesLeidos.has(r.canal ?? "meli_calzado") && !deHoy.has(clave(r)));
  return { recomendaciones, resueltas };
}

export function paraGuardar(rs: RecomendacionDelDia[]): RecomendacionGuardada[] {
  return rs.map((r) => ({ canal: r.canal, modelo: r.modelo, accion: r.accion, queHacer: r.queHacer, desde: r.desde }));
}

/** Un canal que no se pudo leer: sin recomendaciones y con el porqué. */
export const canalConError = (motivo: string): PublicidadCanal => ({ recomendaciones: [], gastoAds: 0, tacos: null, hasta: null, avisos: [motivo], error: true });

export function armarCorreoDePublicidad(o: {
  dia: string;
  rango: { desde: string; hasta: string };
  canales: Partial<Record<CanalAds, PublicidadCanal>>;
  anterior: { dia: string; recomendaciones: RecomendacionGuardada[] } | null;
}): CorreoPublicidad {
  const presentes = CANALES_ADS.filter((c) => o.canales[c.canal]);
  const leidos = new Set(presentes.filter((c) => !o.canales[c.canal]!.error).map((c) => c.canal));
  const { recomendaciones, resueltas } = compararConAnterior(
    presentes.map((c) => ({ canal: c.canal, recomendaciones: o.canales[c.canal]!.recomendaciones })),
    o.anterior?.recomendaciones ?? null,
    o.dia,
    leidos,
  );
  const secciones = presentes.map((c) => {
    const p = o.canales[c.canal]!;
    return {
      ...c,
      recomendaciones: recomendaciones.filter((r) => r.canal === c.canal),
      resueltas: resueltas.filter((r) => (r.canal ?? "meli_calzado") === c.canal),
      gastoAds: p.gastoAds,
      tacos: p.tacos,
      hasta: p.hasta,
      avisos: p.avisos,
    };
  });
  return { dia: o.dia, rango: o.rango, secciones, conAnterior: o.anterior != null, diaAnterior: o.anterior?.dia ?? null };
}

// ---------------------------------------------------------------------------
// Correo
// ---------------------------------------------------------------------------

function pesos(x: number): string {
  return (x < 0 ? "-$" : "$") + Math.round(Math.abs(x)).toLocaleString("es-MX");
}
const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(1)} %`);
/** El TACOS del canal contra el tope de 10 %: en rojo si lo pasa. */
function tacosConTope(t: number | null): string {
  if (t == null) return "—";
  const tope = `${Math.round(TACOS_TOPE * 100)} %`;
  return t > TACOS_TOPE
    ? `<b style="color:${TONO.mal};">${pct(t)} (arriba del tope de ${tope})</b>`
    : `${pct(t)} (tope ${tope})`;
}
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

const COLOR_ACCION: Record<AccionSugerida, string> = {
  apagar: TONO.mal,
  pausar: TONO.mal,
  bajar: TONO.alerta,
  subir: TONO.bien,
  encender: TONO.bien,
  activar: TONO.acento,
};

const COLOR_CANAL: Record<CanalAds, string> = {
  meli_calzado: "#a35f1c",
  meli_fundas: "#2f9c63",
  amazon: "#3a72b8",
};

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000);
}

function etiquetaEstado(r: RecomendacionDelDia, dia: string): string {
  if (r.nueva) {
    return `<span style="display:inline-block;padding:1px 6px;border-radius:4px;background:${TONO.acento};color:#ffffff;font-size:10px;font-weight:700;letter-spacing:0.5px;">NUEVO</span>`;
  }
  const dias = diasEntre(r.desde, dia);
  if (dias <= 0) return "";
  return `<span style="font-size:11px;color:${TONO.tenue};">pendiente desde hace ${plural(dias, "día", "días")}</span>`;
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
    `<table class="g-t" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid ${TONO.borde};border-radius:8px;margin:0 0 6px;">` +
    `<tr><th align="left" style="${encabezado}">Modelo</th><th align="left" style="${encabezado}">Qué hacer y por qué</th></tr>` +
    renglones +
    `</table>`
  );
}

function cifras(c: CorreoPublicidad): string {
  const todas = c.secciones.flatMap((s) => s.recomendaciones);
  const nuevas = todas.filter((r) => r.nueva).length;
  const gasto = c.secciones.reduce((s, x) => s + x.gastoAds, 0);
  const resueltas = c.secciones.reduce((s, x) => s + x.resueltas.length, 0);
  const caja = (etiqueta: string, valor: string, color: string = TONO.tinta) =>
    `<td class="g-cifra" width="33%" valign="top" style="padding:14px 16px;background:${TONO.suave};border:1px solid ${TONO.borde};border-radius:8px;">` +
    `<div style="font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:${TONO.tenue};font-weight:700;">${etiqueta}</div>` +
    `<div style="font-family:${LETRA_TITULO};font-size:22px;font-weight:600;color:${color};margin-top:4px;white-space:nowrap;">${valor}</div></td>`;
  const hueco = `<td class="g-hueco" width="10" style="font-size:0;line-height:0;">&nbsp;</td>`;
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 0 8px;"><tr>` +
    caja("Cambios por hacer", `${todas.length}${c.conAnterior ? ` · ${nuevas} nuevos` : ""}`, todas.length ? TONO.acento : TONO.bien) +
    hueco +
    caja("Ya resueltos", c.conAnterior ? String(resueltas) : "—", TONO.bien) +
    hueco +
    caja(`Gasto en ads · ${DIAS_CORREO_PUBLICIDAD} días`, pesos(gasto)) +
    `</tr></table>`
  );
}

function seccionHtml(s: SeccionCanal, dia: string): string {
  const partes: string[] = [];
  const nuevas = s.recomendaciones.filter((r) => r.nueva).length;
  partes.push(
    `<h2 style="margin:28px 0 4px;font-family:${LETRA_TITULO};font-size:20px;font-weight:600;color:${TONO.tinta};">` +
      `<span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:${COLOR_CANAL[s.canal]};margin-right:8px;vertical-align:middle;"></span>` +
      `<span style="vertical-align:middle;">${esc(s.nombre)}</span></h2>` +
      `<p style="margin:0 0 12px;font-size:13px;color:${TONO.tinta2};">` +
      `${plural(s.recomendaciones.length, "cambio", "cambios")}${nuevas ? ` (${nuevas} nuevo${nuevas === 1 ? "" : "s"})` : ""} · gasto ${pesos(s.gastoAds)} · publicidad sobre venta ${tacosConTope(s.tacos)}` +
      (s.hasta && s.hasta < diaAnterior(dia) ? ` · datos hasta el ${esc(fechaLarga(s.hasta))}` : "") +
      `</p>`,
  );
  if (!s.recomendaciones.length && !s.avisos.length) {
    partes.push(`<p style="margin:0 0 6px;font-size:13px;color:${TONO.tinta2};">Nada que cambiar: nada gasta sin stock, nada se come el margen y no hay productos nuevos sin anuncio.</p>`);
  }
  for (const grupo of GRUPOS_ACCION) {
    const delGrupo = s.recomendaciones
      .filter((r) => grupo.acciones.includes(r.accion))
      // Dentro del grupo, lo nuevo primero; luego el orden del panel.
      .sort((a, b) => Number(b.nueva) - Number(a.nueva));
    if (!delGrupo.length) continue;
    partes.push(`<div style="margin:14px 0 6px;font-size:13px;font-weight:700;color:${TONO.tinta};">${esc(grupo.titulo)} (${delGrupo.length})</div>`);
    partes.push(tablaGrupo(delGrupo, dia));
  }
  if (s.resueltas.length) {
    partes.push(
      `<div style="margin:12px 0 0;font-size:13px;color:${TONO.tinta2};"><div style="font-weight:700;color:${TONO.bien};margin-bottom:3px;">Ya no hace falta (${s.resueltas.length})</div>` +
        s.resueltas.map((r) => `<div style="margin:2px 0;">✓ <b>${esc(r.modelo)}</b> · ${esc(r.queHacer)}</div>`).join("") +
        `</div>`,
    );
  }
  if (s.avisos.length) {
    partes.push(
      `<div style="margin:12px 0 0;padding:10px 12px;background:${TONO.alertaSuave};border:1px solid #f1dfb5;border-radius:8px;font-size:12px;color:${TONO.alerta};">` +
        s.avisos.map((x) => `<div style="margin:2px 0;">• ${esc(x)}</div>`).join("") +
        `</div>`,
    );
  }
  partes.push(`<p style="margin:8px 0 0;font-size:12px;"><a href="${esc(s.url)}" style="color:${TONO.acento};">Abrir en el ERP</a> · se cambia en ${esc(s.consola)}</p>`);
  return partes.join("");
}

export function htmlCorreoPublicidad(c: CorreoPublicidad): { asunto: string; html: string; texto: string } {
  const todas = c.secciones.flatMap((s) => s.recomendaciones);
  const nuevas = todas.filter((r) => r.nueva).length;
  const asunto = todas.length
    ? `Publicidad: ${plural(todas.length, "cambio", "cambios")} por hacer${c.conAnterior ? ` (${nuevas} nuevo${nuevas === 1 ? "" : "s"})` : ""} en calzado, fundas y Amazon`
    : "Publicidad: nada que cambiar en calzado, fundas y Amazon";
  const partes: string[] = [cifras(c)];
  if (c.diaAnterior) {
    partes.push(`<p style="margin:0;font-size:12px;color:${TONO.tenue};">«Nuevo» = no salía en el correo del ${esc(fechaLarga(c.diaAnterior))}.</p>`);
  }
  for (const s of c.secciones) partes.push(seccionHtml(s, c.dia));
  partes.push(
    `<p style="margin:22px 0 0;font-size:12px;color:${TONO.tenue};">Del ${esc(fechaLarga(c.rango.desde))} al ${esc(fechaLarga(c.rango.hasta))}. Cruza el gasto en publicidad de cada modelo con su stock (Full o FBA) y su margen real. Los cambios se hacen a mano en cada consola: el ERP no escribe publicidad.</p>`,
  );
  const fecha = fechaLarga(c.dia);
  const html = plantillaCorreo({
    preencabezado: asunto,
    ceja: "Publicidad",
    titulo: "Cambios de publicidad",
    subtitulo: fecha.charAt(0).toUpperCase() + fecha.slice(1),
    cuerpo: partes.join(""),
    boton: { texto: "Abrir Publicidad", url: `${URL_ERP}/publicidad` },
  });

  const lineas = [`Cambios de publicidad · ${fecha}`, ""];
  for (const s of c.secciones) {
    lineas.push(`== ${s.nombre} · gasto ${pesos(s.gastoAds)} ==`);
    if (!s.recomendaciones.length) lineas.push("Nada que cambiar.");
    for (const grupo of GRUPOS_ACCION) {
      const delGrupo = s.recomendaciones.filter((r) => grupo.acciones.includes(r.accion));
      if (!delGrupo.length) continue;
      lineas.push(grupo.titulo);
      for (const r of delGrupo) lineas.push(`${r.nueva ? "[NUEVO] " : ""}${r.modelo}: ${r.queHacer}. ${r.razon}`);
    }
    if (s.resueltas.length) {
      lineas.push("Ya no hace falta:");
      for (const r of s.resueltas) lineas.push(`✓ ${r.modelo}: ${r.queHacer}`);
    }
    lineas.push(...s.avisos, "");
  }
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

/** Un canal que truena no tumba el correo: sale con su aviso. */
const sinTronar = (p: Promise<PublicidadCanal>, nombre: string): Promise<PublicidadCanal> =>
  p.catch((err) => canalConError(`No se pudo leer ${nombre}: ${(err as Error).message}`));

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

  const calzado = async (): Promise<PublicidadCanal> => {
    const p = await calcularPublicidadFresca(db, { id: cuenta.id, site_id: cuenta.site_id }, rango);
    const avisos: string[] = [];
    if (p.errorAds) avisos.push(p.errorAds);
    if (p.errorRecomendaciones) avisos.push(p.errorRecomendaciones);
    avisos.push(...p.advertencias.filter((a) => a !== p.errorRecomendaciones));
    if (p.sinAmarre.gasto > 0) avisos.push(`${pesos(p.sinAmarre.gasto)} de gasto en ${p.sinAmarre.anuncios} anuncio(s) que no amarran con ningún modelo del catálogo.`);
    return { recomendaciones: p.recomendaciones, gastoAds: p.totales.gastoAds, tacos: p.totales.tacos, hasta, avisos, error: Boolean(p.errorAds) };
  };
  const [meliCalzado, meliFundas, amazon] = await Promise.all([
    sinTronar(calzado(), "la publicidad de calzado"),
    sinTronar(publicidadFundas(db, rango), "la publicidad de fundas"),
    sinTronar(publicidadAmazon(db, cuenta.id, rango), "la publicidad de Amazon"),
  ]);
  const canales: Record<CanalAds, PublicidadCanal> = { meli_calzado: meliCalzado, meli_fundas: meliFundas, amazon };

  // Contra el último correo de OTRO día (un reenvío forzado no se compara consigo mismo).
  const anterior = previos.find((p) => p.dia !== dia) ?? null;
  const c = armarCorreoDePublicidad({ dia, rango, canales, anterior });
  const { asunto, html, texto } = htmlCorreoPublicidad(c);
  const para = opts.para ?? destinatariosPublicidad();
  const correo = await enviarCorreo({ para, asunto, html, texto });
  const todas = c.secciones.flatMap((s) => s.recomendaciones);
  // Lo de un canal que hoy no se leyó se arrastra tal cual para el siguiente correo.
  const arrastradas = (anterior?.recomendaciones ?? []).filter((r) => canales[r.canal ?? "meli_calzado"].error);
  const nuevos = todas.filter((r) => r.nueva).length;
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
      recomendaciones: [...paraGuardar(todas), ...arrastradas],
      porCanal: Object.fromEntries(c.secciones.map((s) => [s.canal, { cambios: s.recomendaciones.length, resueltas: s.resueltas.length, gasto: Math.round(s.gastoAds), avisos: s.avisos }])),
    },
  });
  return { dia, enviado: correo.enviado, correo, cambios: todas.length, nuevos };
}
