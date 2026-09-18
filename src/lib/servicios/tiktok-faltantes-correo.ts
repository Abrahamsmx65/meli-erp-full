/**
 * El correo de la mañana con lo que se quedó sin escanear.
 *
 * Un corte que se preparó a medias no avisa solo: la pantalla lo dice,
 * pero hay que abrirla. El dueño pidió (16-sep-2026) que cada mañana le
 * llegue a quien empaca un correo con los NÚMEROS DE PEDIDO que no se
 * escanearon en los cortes del día anterior, para revisarlos. Se miran
 * los cortes de los últimos `DIAS_ATRAS` días: uno de antier a medias
 * sigue siendo un pedido sin salir. Si no falta nada, no se manda nada.
 */
import { enviarCorreo, type ResultadoCorreo } from "./correo";
import { faltantesDelCorte, type FaltantesCorte } from "./tiktok-despacho";

/** A quién le llega. Se puede cambiar por entorno sin tocar el código. */
export const CORREO_FALTANTES_POR_OMISION = "daviddarwishb@gmail.com";
export function destinatarioFaltantes(): string {
  return process.env.CORREO_FALTANTES_TIKTOK?.trim() || CORREO_FALTANTES_POR_OMISION;
}

/** Cuántos días hacia atrás se revisan los cortes. */
export const DIAS_ATRAS = 3;

export interface CorteConFaltantes {
  numero: number;
  creadoEn: string;
  total: number;
  faltantes: FaltantesCorte["faltantes"];
}

function fechaMx(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });
}

/** El cuerpo del correo, puro: lo que se prueba. */
export function armarCorreoFaltantes(cortes: CorteConFaltantes[]): { asunto: string; html: string; texto: string } | null {
  const conFaltantes = cortes.filter((c) => c.faltantes.length);
  if (!conFaltantes.length) return null;
  const totalPedidos = conFaltantes.reduce((a, c) => a + c.faltantes.length, 0);
  const asunto = `TikTok: ${totalPedidos} ${totalPedidos === 1 ? "pedido sin escanear" : "pedidos sin escanear"} en ${conFaltantes.length === 1 ? "el corte" : "los cortes"} ${conFaltantes.map((c) => `#${c.numero}`).join(", ")}`;

  const bloques = conFaltantes.map((c) => {
    const filas = c.faltantes
      .map(
        (f) =>
          `<tr><td style="padding:4px 8px;font-family:monospace">${f.orderId}</td><td style="padding:4px 8px">#${f.numero}</td><td style="padding:4px 8px">${f.pares.map((p) => (p.pares > 1 ? `${p.sku} ×${p.pares}` : p.sku)).join(", ")}</td></tr>`,
      )
      .join("");
    return `<h3 style="margin:16px 0 4px">Corte #${c.numero} · ${fechaMx(c.creadoEn)} · faltan ${c.faltantes.length} de ${c.total}</h3>
<table style="border-collapse:collapse;font-size:14px"><thead><tr><th style="text-align:left;padding:4px 8px">Pedido</th><th style="text-align:left;padding:4px 8px">Hoja</th><th style="text-align:left;padding:4px 8px">Productos</th></tr></thead><tbody>${filas}</tbody></table>`;
  });

  const texto = conFaltantes
    .map(
      (c) =>
        `Corte #${c.numero} (${fechaMx(c.creadoEn)}), faltan ${c.faltantes.length} de ${c.total}:\n` +
        c.faltantes.map((f) => `  ${f.orderId}  #${f.numero}  ${f.pares.map((p) => (p.pares > 1 ? `${p.sku} x${p.pares}` : p.sku)).join(", ")}`).join("\n"),
    )
    .join("\n\n");

  const html = `<p>Estos pedidos no se escanearon en la estación de preparar. Revísalos: o se empacaron sin escanear, o siguen en la mesa.</p>${bloques.join("")}<p style="color:#666;font-size:12px">La lista viene del ERP (Despacho TikTok → Faltantes). Un pedido que ya se preparó después de este correo deja de aparecer mañana.</p>`;
  return { asunto, html, texto };
}

export interface ResultadoAvisoFaltantes {
  cortes: number;
  pedidos: number;
  correo: ResultadoCorreo | null;
}

/** Revisa los cortes recientes y manda el correo si algo se quedó sin escanear. */
export async function avisarFaltantesRecientes(admin: any, accountId: string): Promise<ResultadoAvisoFaltantes> {
  const desde = new Date(Date.now() - DIAS_ATRAS * 86_400_000).toISOString();
  const { data: cortes } = await admin
    .from("tiktok_cortes")
    .select("id, numero, creado_en")
    .eq("account_id", accountId)
    .gte("creado_en", desde)
    .order("numero", { ascending: true });

  const lista: CorteConFaltantes[] = [];
  for (const c of cortes ?? []) {
    try {
      const f = await faltantesDelCorte(admin, accountId, c.id);
      lista.push({ numero: c.numero, creadoEn: c.creado_en, total: f.total, faltantes: f.faltantes });
    } catch {
      // Un corte que no se pudo leer no tumba el aviso de los demás.
    }
  }

  const correo = armarCorreoFaltantes(lista);
  if (!correo) return { cortes: 0, pedidos: 0, correo: null };
  const para = destinatarioFaltantes();
  const enviado = await enviarCorreo({ para, ...correo });
  await registrarCorreo(admin, accountId, "correo-faltantes", para, correo.asunto, enviado);
  return {
    cortes: lista.filter((c) => c.faltantes.length).length,
    pedidos: lista.reduce((a, c) => a + c.faltantes.length, 0),
    correo: enviado,
  };
}

// ---------------------------------------------------------------------------
// Bitácora de correos: el 18-sep-2026 david no recibía nada y no había cómo saber si Resend los rechazaba
// ---------------------------------------------------------------------------

/** Deja en `tiktok_sync_log` a quién se mandó, qué, y si Resend lo aceptó (con su motivo si no). */
export async function registrarCorreo(
  admin: any,
  accountId: string,
  tarea: string,
  para: string,
  asunto: string,
  r: ResultadoCorreo,
  extra?: Record<string, unknown>,
): Promise<void> {
  await admin
    .from("tiktok_sync_log")
    .insert({
      account_id: accountId,
      tarea,
      inicio: new Date().toISOString(),
      fin: new Date().toISOString(),
      estado: r.enviado ? "ok" : "error",
      detalle: { para, asunto, enviado: r.enviado, id: r.id ?? null, motivo: r.motivo ?? null, remitente: process.env.CORREO_REMITENTE?.trim() || "onboarding@resend.dev (sin dominio verificado)", ...extra },
    })
    .then(() => undefined, () => undefined);
}

// ---------------------------------------------------------------------------
// Pedidos grandes que TikTok no deja cancelar parcial: se avisan por correo
// ---------------------------------------------------------------------------

export interface PedidoParcialSinCancelar {
  orderId: string;
  /** los renglones sin stock que había que cancelar */
  sinStock: { sku: string; pares: number }[];
  /** lo que sí hay y se habría confirmado */
  vivos: { sku: string; pares: number }[];
  /** lo que contestó TikTok */
  error: string;
}

/** Cuántos días se recuerda que un pedido ya se avisó, para no repetirlo en cada corte. */
export const DIAS_SIN_REPETIR_AVISO = 3;

export function armarCorreoParciales(pedidos: PedidoParcialSinCancelar[]): { asunto: string; html: string; texto: string } | null {
  if (!pedidos.length) return null;
  const asunto = `TikTok: ${pedidos.length} ${pedidos.length === 1 ? "pedido grande necesita" : "pedidos grandes necesitan"} cancelación a mano (sin stock de un renglón)`;
  const lista = (l: { sku: string; pares: number }[]) => l.map((p) => (p.pares > 1 ? `${p.sku} ×${p.pares}` : p.sku)).join(", ");
  const filas = pedidos
    .map(
      (p) =>
        `<tr><td style="padding:4px 8px;font-family:monospace">${p.orderId}</td><td style="padding:4px 8px;color:#b00">${lista(p.sinStock)}</td><td style="padding:4px 8px">${lista(p.vivos) || "—"}</td></tr>`,
    )
    .join("");
  const html =
    `<p>La defensa del corte quiso cancelar en TikTok SOLO el renglón sin stock de estos pedidos y confirmar el resto, pero TikTok México no acepta la cancelación parcial por API. Se quedaron FUERA del corte.</p>` +
    `<p><b>Qué hacer en el Seller Center:</b> cancelar el renglón sin stock (o el pedido completo, si no se puede parcial) con el motivo «sin stock». Lo que quede vivo entra solo al siguiente corte.</p>` +
    `<table style="border-collapse:collapse;font-size:14px"><thead><tr><th style="text-align:left;padding:4px 8px">Pedido</th><th style="text-align:left;padding:4px 8px">Sin stock (cancelar)</th><th style="text-align:left;padding:4px 8px">Sí hay (se confirma después)</th></tr></thead><tbody>${filas}</tbody></table>` +
    `<p style="color:#666;font-size:12px">TikTok contestó: ${pedidos[0].error}</p>`;
  const texto =
    "Pedidos grandes que TikTok no deja cancelar parcial (cancelar a mano en el Seller Center el renglón sin stock):\n" +
    pedidos.map((p) => `  ${p.orderId}  sin stock: ${lista(p.sinStock)}  |  sí hay: ${lista(p.vivos) || "-"}`).join("\n");
  return { asunto, html, texto };
}

/**
 * Manda a quien despacha UN correo con los pedidos grandes que TikTok no
 * dejó cancelar parcial en este corte, sin repetir los ya avisados en los
 * últimos `DIAS_SIN_REPETIR_AVISO` días (el mismo pedido se queda fuera
 * corte tras corte hasta que alguien lo arregle a mano).
 */
export async function avisarParcialesSinCancelar(
  admin: any,
  accountId: string,
  pedidos: PedidoParcialSinCancelar[],
): Promise<{ avisados: number; correo: ResultadoCorreo | null }> {
  if (!pedidos.length) return { avisados: 0, correo: null };
  const desde = new Date(Date.now() - DIAS_SIN_REPETIR_AVISO * 86_400_000).toISOString();
  const { data: previos } = await admin
    .from("tiktok_sync_log")
    .select("detalle")
    .eq("account_id", accountId)
    .eq("tarea", "correo-parciales")
    .eq("estado", "ok")
    .gte("inicio", desde);
  const yaAvisados = new Set<string>();
  for (const p of previos ?? []) for (const id of (p?.detalle?.orderIds ?? []) as string[]) yaAvisados.add(String(id));
  const nuevos = pedidos.filter((p) => !yaAvisados.has(p.orderId));
  const correo = armarCorreoParciales(nuevos);
  if (!correo) return { avisados: 0, correo: null };
  const para = destinatarioFaltantes();
  const r = await enviarCorreo({ para, ...correo });
  await registrarCorreo(admin, accountId, "correo-parciales", para, correo.asunto, r, { orderIds: nuevos.map((p) => p.orderId) });
  return { avisados: r.enviado ? nuevos.length : 0, correo: r };
}
