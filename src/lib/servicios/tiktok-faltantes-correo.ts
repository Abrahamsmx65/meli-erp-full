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
  const enviado = await enviarCorreo({ para: destinatarioFaltantes(), ...correo });
  return {
    cortes: lista.filter((c) => c.faltantes.length).length,
    pedidos: lista.reduce((a, c) => a + c.faltantes.length, 0),
    correo: enviado,
  };
}
