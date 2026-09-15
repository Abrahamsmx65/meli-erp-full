/**
 * Recordatorios del contenedor por correo (decisión del dueño, 10-sep-2026):
 *
 *  · Una SEMANA antes de la llegada estimada: las fotos que faltan de los
 *    productos nuevos que trae, para que dé tiempo de hacerlas.
 *  · El día que LLEGA: aviso de que el contenedor ya está en USA.
 *
 * Cada uno se manda una sola vez (`aviso_previo_en` / `aviso_llegada_en`,
 * migración 0082). Corre en el cron diario de contenedores; un contenedor
 * que ya se marcó recibido, o cuya fecha quedó muy atrás, no dispara nada:
 * el día que se prendió esto no tenía por qué llover correo viejo.
 */
import type { DB } from "../datos/repos";
import { correoConfigurado, enviarCorreo } from "./correo";
import { correoDeFotos, listaFotosDeContenedor } from "./fotos-contenedor";

export type AvisoContenedor = "previo" | "llegada";

export interface ContenedorParaAviso {
  id: string;
  numero: string;
  estado: string;
  llegadaEst: string | null;
  llegadaReal: string | null;
  avisoPrevioEn: string | null;
  avisoLlegadaEn: string | null;
}

/** Hoy en hora de México (AAAA-MM-DD), como el resto del sistema. */
export const hoyMx = (): string => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);

const sumarDias = (dia: string, n: number): string =>
  new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Qué aviso le toca HOY a este contenedor. Puro, para probarse.
 * Si ya llegó, el de la llegada gana: el de "falta una semana" ya no sirve.
 */
export function avisoQueToca(
  c: ContenedorParaAviso,
  hoy: string,
  opts: { diasAntes?: number; ventanaDias?: number } = {},
): AvisoContenedor | null {
  const diasAntes = opts.diasAntes ?? 7;
  // Más de esto de retraso y ya no se avisa: es historia, no una novedad.
  const ventana = opts.ventanaDias ?? 30;
  if (c.estado === "recibido") return null;

  const llegada = c.llegadaReal || c.llegadaEst;
  if (llegada && !c.avisoLlegadaEn && hoy >= llegada && hoy <= sumarDias(llegada, ventana)) {
    return "llegada";
  }
  if (
    c.llegadaEst &&
    !c.avisoPrevioEn &&
    hoy >= sumarDias(c.llegadaEst, -diasAntes) &&
    hoy < c.llegadaEst
  ) {
    return "previo";
  }
  return null;
}

const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!);

/** El correo de "ya llegó": qué contenedor, qué trae y de qué pedidos. */
export function correoDeLlegada(datos: {
  numero: string;
  numeroNaviera: string | null;
  cajas: number;
  modelos: { modelo: string; color: string; cajas: number }[];
  pedidos: string[];
}): { asunto: string; html: string; texto: string } {
  const n = (x: number) => Math.round(x).toLocaleString("es-MX");
  const asunto = `Llegó a USA el contenedor ${datos.numero}${datos.numeroNaviera ? ` (${datos.numeroNaviera})` : ""}`;
  const filas = datos.modelos
    .map((m) => `<tr><td>${esc(m.modelo)}</td><td>${esc(m.color)}</td><td align="right">${n(m.cajas)}</td></tr>`)
    .join("");
  const html = `
<p>El contenedor <strong>${esc(datos.numero)}</strong>${datos.numeroNaviera ? ` (naviera ${esc(datos.numeroNaviera)})` : ""} llega hoy a USA.
Trae ${n(datos.cajas)} cajas de los pedidos ${esc(datos.pedidos.join(", ") || "—")}.</p>
${
  filas
    ? `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:13px">
<tr><th>Modelo</th><th>Color</th><th>Cajas</th></tr>${filas}</table>`
    : ""
}
<p style="color:#666;font-size:12px">Confirmar la llegada en el ERP no suma inventario: las existencias llegan solas del API de Industher.</p>`;
  const texto = [
    `${asunto}. ${n(datos.cajas)} cajas · pedidos ${datos.pedidos.join(", ") || "—"}.`,
    ...datos.modelos.map((m) => `- ${m.modelo} ${m.color}: ${n(m.cajas)} cajas`),
  ].join("\n");
  return { asunto, html, texto };
}

export interface ResultadoAvisos {
  revisados: number;
  previos: string[];
  llegadas: string[];
  errores: string[];
}

/**
 * Revisa los contenedores vivos y manda el aviso que toque. Nunca lanza:
 * un correo que falla no debe tumbar el cron.
 */
export async function avisarContenedores(
  admin: DB,
  accountId: string,
  opts: { hoy?: string; tope?: number } = {},
): Promise<ResultadoAvisos> {
  const r: ResultadoAvisos = { revisados: 0, previos: [], llegadas: [], errores: [] };
  if (!correoConfigurado()) {
    r.errores.push("Correo sin configurar (RESEND_API_KEY / CORREO_AVISOS).");
    return r;
  }
  const hoy = opts.hoy ?? hoyMx();

  const { data, error } = await admin
    .from("contenedores")
    .select("id, numero, numero_naviera, estado, fecha_llegada_est, fecha_llegada_real, aviso_previo_en, aviso_llegada_en")
    .eq("account_id", accountId)
    .neq("estado", "recibido")
    .order("fecha_llegada_est", { ascending: true, nullsFirst: false })
    .limit(200);
  if (error) {
    r.errores.push(`contenedores: ${error.message}`);
    return r;
  }

  for (const c of data ?? []) {
    if (r.previos.length + r.llegadas.length >= (opts.tope ?? 10)) break;
    const cont: ContenedorParaAviso = {
      id: c.id,
      numero: c.numero,
      estado: c.estado,
      llegadaEst: c.fecha_llegada_est ?? null,
      llegadaReal: c.fecha_llegada_real ?? null,
      avisoPrevioEn: c.aviso_previo_en ?? null,
      avisoLlegadaEn: c.aviso_llegada_en ?? null,
    };
    const toca = avisoQueToca(cont, hoy);
    if (!toca) continue;
    r.revisados++;
    try {
      if (toca === "previo") {
        const lista = await listaFotosDeContenedor(admin, accountId, c.id);
        const base = correoDeFotos(lista);
        const env = await enviarCorreo({
          ...base,
          asunto: `Llega en una semana el contenedor ${c.numero} (${c.fecha_llegada_est}) · ${base.asunto}`,
        });
        if (!env.enviado) throw new Error(env.motivo ?? "no se envió");
        await admin.from("contenedores").update({ aviso_previo_en: new Date().toISOString() }).eq("id", c.id);
        r.previos.push(c.numero);
      } else {
        const datos = await datosDeLlegada(admin, c.id);
        const env = await enviarCorreo(
          correoDeLlegada({ numero: c.numero, numeroNaviera: c.numero_naviera ?? null, ...datos }),
        );
        if (!env.enviado) throw new Error(env.motivo ?? "no se envió");
        await admin.from("contenedores").update({ aviso_llegada_en: new Date().toISOString() }).eq("id", c.id);
        r.llegadas.push(c.numero);
      }
    } catch (err) {
      r.errores.push(`${c.numero}: ${(err as Error).message}`.slice(0, 200));
    }
  }
  return r;
}

/** Qué trae el contenedor, para el correo de llegada. */
async function datosDeLlegada(
  admin: DB,
  contenedorId: string,
): Promise<{ cajas: number; modelos: { modelo: string; color: string; cajas: number }[]; pedidos: string[] }> {
  const { data: cls } = await admin
    .from("contenedor_lineas")
    .select("pedido_linea_id, cajas")
    .eq("contenedor_id", contenedorId);
  const ids = [...new Set((cls ?? []).map((x) => x.pedido_linea_id as string))];
  if (!ids.length) return { cajas: 0, modelos: [], pedidos: [] };

  const { data: lineas } = await admin
    .from("pedido_lineas")
    .select("id, pedido_id, modelo, color")
    .in("id", ids);
  const porLinea = new Map((lineas ?? []).map((l) => [l.id as string, l]));
  const { data: pedidos } = await admin
    .from("pedidos")
    .select("id, pedido")
    .in("id", [...new Set((lineas ?? []).map((l) => l.pedido_id as string))]);
  const nombre = new Map((pedidos ?? []).map((p) => [p.id as string, String(p.pedido)]));

  const porModelo = new Map<string, { modelo: string; color: string; cajas: number }>();
  const usados = new Set<string>();
  let cajas = 0;
  for (const cl of cls ?? []) {
    const l = porLinea.get(cl.pedido_linea_id as string);
    if (!l) continue;
    cajas += cl.cajas ?? 0;
    const p = nombre.get(l.pedido_id as string);
    if (p) usados.add(p.trim().toUpperCase());
    const modelo = String(l.modelo ?? "").toUpperCase();
    const color = String(l.color ?? "").toUpperCase();
    const k = `${modelo}|${color}`;
    const x = porModelo.get(k) ?? { modelo, color, cajas: 0 };
    x.cajas += cl.cajas ?? 0;
    porModelo.set(k, x);
  }
  return {
    cajas,
    modelos: [...porModelo.values()].sort((a, b) => a.modelo.localeCompare(b.modelo) || a.color.localeCompare(b.color)),
    pedidos: [...usados].sort(),
  };
}
