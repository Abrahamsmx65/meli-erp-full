/**
 * Confirmación de los pedidos a China contra el sheet de pedidos pendientes.
 *
 * China confirma un pedido SUBIÉNDOLO al sheet "PENDING ORDERS SHOES
 * INTERNET" (el mismo de `pedidos-sheet.ts`); el dueño lo revisaba a ojo.
 * Pedido del dueño, 21-oct-2026: «a las 8 am de aquí corra y revise si ya
 * subieron al sheets los pedidos nuevos y me salga ahí confirmado o en su
 * caso falta confirmar».
 *
 * Cada mañana (cron `/api/cron/confirmacion-pedidos`, 14:00Z = 8:00 en
 * México) se relee el sheet, se guarda masticado (la pantalla de Órdenes de
 * compra lo enseña junto a cada pedido sin barco), queda constancia en
 * `sync_log` (tarea `confirmacion-pedidos`) y, si hay algo que decir —un
 * pedido que sigue sin confirmar o uno que se confirmó desde la revisión
 * anterior—, va un correo al dueño. Con todo confirmado y ya avisado, no se
 * manda nada.
 */
import type { Cuenta, DB } from "../datos/repos";
import { guardarCacheApp } from "./cache-app";
import { enviarCorreo, type ResultadoCorreo } from "./correo";
import { TONO, URL_ERP, escaparHtml, plantillaCorreo } from "./correo-marca";
import { listarPedidos } from "./pedidos";
import {
  configuracionSheetPedidos,
  confirmacionDePedidos,
  faltantesDelSheet,
  type ConfirmacionPedido,
} from "./pedidos-sheet";
import { hoyMx } from "./resumen-diario";

export const TAREA_CONFIRMACION = "confirmacion-pedidos";

/** Solo al dueño; `CORREO_CONFIRMACION_PEDIDOS` lo cambia. */
export const DESTINATARIO_CONFIRMACION = "abraham.darwish@yapanizcel.com.mx";

export function destinatariosConfirmacion(): string[] {
  const env = (process.env.CORREO_CONFIRMACION_PEDIDOS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return env.length ? env : [DESTINATARIO_CONFIRMACION];
}

export interface RevisionConfirmacion {
  dia: string;
  revisadoEn: string;
  confirmacion: ConfirmacionPedido[];
  /** los que se confirmaron desde la revisión anterior */
  nuevosConfirmados: string[];
  faltan: number;
  confirmados: number;
}

/** Qué pedidos ya se reportaron como confirmados en la revisión anterior. */
export function nuevosConfirmadosDesde(
  confirmacion: ConfirmacionPedido[],
  confirmadosAntes: string[] | null,
): string[] {
  const antes = new Set((confirmadosAntes ?? []).map((p) => p.toUpperCase()));
  return confirmacion.filter((c) => c.estado === "confirmado" && !antes.has(c.pedido.toUpperCase())).map((c) => c.pedido);
}

/**
 * Hay algo que avisar si algún pedido sigue sin confirmar o alguno se
 * confirmó desde la última revisión. Sin pedidos sin barco, nada.
 */
export function hayQueAvisar(r: Pick<RevisionConfirmacion, "faltan" | "nuevosConfirmados">): boolean {
  return r.faltan > 0 || r.nuevosConfirmados.length > 0;
}

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function fechaCorta(iso: string): string {
  return iso.slice(0, 10);
}

export function armarCorreoConfirmacion(r: RevisionConfirmacion): { asunto: string; html: string; texto: string } {
  const e = escaparHtml;
  const faltan = r.confirmacion.filter((c) => c.estado === "falta");
  const confirmados = r.confirmacion.filter((c) => c.estado === "confirmado");
  // Los viejos que ya no están en el sheet (`fuera`) no van en el correo:
  // China los quitó de pendientes; se ven en Órdenes de compra.
  const nuevos = new Set(r.nuevosConfirmados.map((p) => p.toUpperCase()));

  const asunto =
    faltan.length > 0
      ? `Pedidos a China: ${faltan.length} por confirmar · ${r.dia}`
      : `Pedidos a China: todo confirmado · ${r.dia}`;

  const fila = (c: ConfirmacionPedido): string => {
    const esFalta = c.estado === "falta";
    const color = esFalta ? TONO.mal : TONO.bien;
    const estado = esFalta
      ? "Falta confirmar"
      : `Confirmado${c.fechaConfirm ? ` · ${c.fechaConfirm}` : ""}${nuevos.has(c.pedido.toUpperCase()) ? " · nuevo" : ""}`;
    const pares =
      c.paresSheet != null && c.paresSheet !== c.paresErp
        ? `${n(c.paresErp)} <span style="color:${TONO.alerta};">(sheet: ${n(c.paresSheet)})</span>`
        : n(c.paresErp);
    return (
      `<tr>` +
      `<td style="padding:8px 6px;border-bottom:1px solid ${TONO.borde};font-weight:700;">${e(c.pedido)}</td>` +
      `<td style="padding:8px 6px;border-bottom:1px solid ${TONO.borde};font-size:12px;">${e(c.modelos.join(", ") || "—")}</td>` +
      `<td style="padding:8px 6px;border-bottom:1px solid ${TONO.borde};text-align:right;">${pares}</td>` +
      `<td style="padding:8px 6px;border-bottom:1px solid ${TONO.borde};font-size:12px;color:${TONO.tinta2};">${e(fechaCorta(c.creadoEn))}</td>` +
      `<td style="padding:8px 6px;border-bottom:1px solid ${TONO.borde};font-weight:700;color:${color};">${e(estado)}</td>` +
      `</tr>`
    );
  };

  const tabla = (titulo: string, lista: ConfirmacionPedido[]): string =>
    lista.length
      ? `<h2 style="margin:18px 0 8px;font-size:15px;">${e(titulo)}</h2>` +
        `<table class="g-t" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:13px;">` +
        `<tr>` +
        ["Pedido", "Modelos", "Pares", "Creado", "Estado"]
          .map(
            (t, i) =>
              `<th style="padding:6px;border-bottom:2px solid ${TONO.borde};font-size:10px;letter-spacing:1px;text-transform:uppercase;color:${TONO.tenue};text-align:${i === 2 ? "right" : "left"};">${t}</th>`,
          )
          .join("") +
        `</tr>` +
        lista.map(fila).join("") +
        `</table>`
      : "";

  const resumen =
    faltan.length > 0
      ? `${faltan.length} ${faltan.length === 1 ? "pedido sigue" : "pedidos siguen"} sin aparecer en el sheet de China.`
      : `Los ${confirmados.length} pedidos sin barco ya están en el sheet de China.`;

  const cuerpo =
    `<p style="margin:0 0 6px;font-size:15px;">${e(resumen)}</p>` +
    (r.nuevosConfirmados.length
      ? `<p style="margin:0;font-size:13px;color:${TONO.tinta2};">Confirmados desde la última revisión: ${e(r.nuevosConfirmados.join(", "))}.</p>`
      : "") +
    tabla("Falta confirmar", faltan) +
    tabla("Confirmados", confirmados) +
    `<p style="margin:16px 0 0;font-size:12px;color:${TONO.tenue};">Se revisa el <a href="${e(configuracionSheetPedidos().url)}" style="color:${TONO.acento};">sheet de pedidos pendientes</a> todos los días a las 8:00. Un pedido cuenta como confirmado cuando China lo sube ahí; la fecha es la de su columna «Confirm».</p>`;

  const html = plantillaCorreo({
    preencabezado: resumen,
    ceja: "Pedidos a China",
    titulo: faltan.length > 0 ? `${faltan.length} por confirmar` : "Todo confirmado",
    subtitulo: `Revisión del ${r.dia} a las 8:00`,
    cuerpo,
    boton: { texto: "Ver órdenes de compra", url: `${URL_ERP}/pedidos/cargar` },
  });

  const texto =
    `${resumen}\n\n` +
    [...faltan, ...confirmados]
      .map(
        (c) =>
          `${c.pedido} · ${c.modelos.join(", ") || "—"} · ${n(c.paresErp)} pares · ${
            c.estado === "falta" ? "FALTA CONFIRMAR" : `confirmado${c.fechaConfirm ? ` ${c.fechaConfirm}` : ""}`
          }`,
      )
      .join("\n");

  return { asunto, html, texto };
}

/** La última revisión guardada (para saber qué ya se reportó). */
async function revisionAnterior(db: DB, accountId: string): Promise<{ dia: string; confirmados: string[]; enviado: boolean } | null> {
  const { data } = await db
    .from("sync_log")
    .select("detalle")
    .eq("account_id", accountId)
    .eq("tarea", TAREA_CONFIRMACION)
    .eq("estado", "ok")
    .order("inicio", { ascending: false })
    .limit(1)
    .maybeSingle();
  const d = (data as { detalle?: Record<string, unknown> } | null)?.detalle;
  if (!d) return null;
  return {
    dia: String(d.dia ?? ""),
    confirmados: Array.isArray(d.confirmados) ? (d.confirmados as string[]) : [],
    enviado: d.enviado === true,
  };
}

/**
 * Relee el sheet, lo deja masticado para la pantalla, compara contra la
 * revisión anterior y avisa por correo si hay algo que decir.
 */
export async function revisarConfirmacionPedidos(
  db: DB,
  cuenta: Cuenta,
  opts: { forzar?: boolean; para?: string | string[]; sinCorreo?: boolean } = {},
): Promise<RevisionConfirmacion & { enviado: boolean; omitido?: string; correo?: ResultadoCorreo }> {
  const inicio = new Date().toISOString();
  const dia = hoyMx();
  const t0 = Date.now();
  const [sheet, pedidos, anterior] = await Promise.all([
    faltantesDelSheet(db, cuenta.id),
    listarPedidos(db, cuenta.id),
    revisionAnterior(db, cuenta.id),
  ]);
  // Lo que la pantalla lee: el mismo renglón que ella refresca cada 10 min.
  await guardarCacheApp(db, cuenta.id, "pedidos-sheet", sheet, Date.now() - t0).catch(() => undefined);

  const confirmacion = confirmacionDePedidos(pedidos, [...sheet.cargados, ...sheet.faltan]);
  const nuevosConfirmados = nuevosConfirmadosDesde(confirmacion, anterior?.confirmados ?? null);
  const r: RevisionConfirmacion = {
    dia,
    revisadoEn: new Date().toISOString(),
    confirmacion,
    nuevosConfirmados,
    faltan: confirmacion.filter((c) => c.estado === "falta").length,
    confirmados: confirmacion.filter((c) => c.estado === "confirmado").length,
  };

  let enviado = false;
  let omitido: string | undefined;
  let correo: ResultadoCorreo | undefined;
  if (opts.sinCorreo) omitido = "sin correo";
  else if (!hayQueAvisar(r)) omitido = "nada que avisar";
  else if (!opts.forzar && anterior?.dia === dia && anterior.enviado) omitido = "ya se mandó el de hoy";
  else if (!process.env.RESEND_API_KEY) omitido = "el correo no está configurado (RESEND_API_KEY)";
  else {
    const { asunto, html, texto } = armarCorreoConfirmacion(r);
    correo = await enviarCorreo({ para: opts.para ?? destinatariosConfirmacion(), asunto, html, texto });
    enviado = correo.enviado;
  }

  await db.from("sync_log").insert({
    account_id: cuenta.id,
    tarea: TAREA_CONFIRMACION,
    inicio,
    fin: new Date().toISOString(),
    estado: "ok",
    detalle: {
      dia,
      faltan: confirmacion.filter((c) => c.estado === "falta").map((c) => c.pedido),
      confirmados: confirmacion.filter((c) => c.estado === "confirmado").map((c) => c.pedido),
      nuevosConfirmados,
      enviado,
      omitido: omitido ?? null,
      correo: correo ? { id: correo.id ?? null, motivo: correo.motivo ?? null } : null,
    },
  });

  return { ...r, enviado, omitido, correo };
}
