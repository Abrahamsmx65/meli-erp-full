/**
 * Solicitud de factura del contenedor POR CORREO (dueño, 21-oct-2026:
 * «que pueda mandarme por correo la solicitud de factura con su correo
 * bonito como el de los pedidos»). Mismo Excel que se descarga en la
 * Calculadora fiscal, adjunto, y en el cuerpo las dos facturas (Industher a
 * Komerline y la de Industher) con precio por par sin y con IVA. Los
 * destinatarios se recuerdan en `app_cache` (`calculadora-precios:correo`)
 * y cada envío deja constancia en `sync_log` tarea `correo-factura`.
 */
import type { Cuenta, DB } from "../datos/repos";
import { guardarCacheApp, leerCacheAppGuardado } from "./cache-app";
import { enviarCorreo, type ResultadoCorreo } from "./correo";
import { escaparHtml, plantillaCorreo, TONO, URL_ERP } from "./correo-marca";
import { nombreDelPeriodo } from "./corte-meli";
import { excelFacturaContenedor, type ExcelFactura } from "./calculadora-precios";

export const CLAVE_CORREO_FACTURA = "calculadora-precios:correo";
export const TAREA_CORREO_FACTURA = "correo-factura";

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Separa por coma, punto y coma o espacio; solo lo que parece correo, sin repetir. */
export function limpiarDestinatarios(x: unknown): string[] {
  const lista = Array.isArray(x) ? x : String(x ?? "").split(/[,;\s]+/);
  return [...new Set(lista.map((d) => String(d).trim().toLowerCase()).filter((d) => RE_CORREO.test(d)))];
}

export async function leerDestinatariosFactura(db: DB, accountId: string): Promise<string[]> {
  const r = await leerCacheAppGuardado<{ para: string[] }>(db, accountId, CLAVE_CORREO_FACTURA);
  return r.estado === "encontrado" ? limpiarDestinatarios(r.valor.datos.para) : [];
}

const din = (x: number | null) =>
  x == null ? "—" : "$" + x.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** El precio unitario sin IVA lleva sus 6 decimales: con dos no cuadra contra el importe. */
const din6 = (x: number | null) =>
  x == null ? "—" : "$" + x.toLocaleString("es-MX", { minimumFractionDigits: 6, maximumFractionDigits: 6 });

/** Asunto, HTML con la marca y texto plano de la solicitud. */
export function correoSolicitudFactura(x: Omit<ExcelFactura, "buffer">): { asunto: string; html: string; texto: string } {
  const e = escaparHtml;
  const pares = x.facturas[0]?.totales.pares ?? 0;
  const contenedor = `${x.numero}${x.iso ? ` (${x.iso})` : ""}`;
  const td = (v: string, der = false, extra = "") =>
    `<td style="padding:7px 8px;border-bottom:1px solid ${TONO.borde};text-align:${der ? "right" : "left"};${extra}">${v}</td>`;
  const th = (v: string, der = false) =>
    `<th style="padding:7px 8px;border-bottom:2px solid ${TONO.borde};font-size:11px;text-transform:uppercase;color:${TONO.tinta2};text-align:${der ? "right" : "left"}">${v}</th>`;
  const cifra = (titulo: string, valor: string, nota: string) =>
    `<td class="g-cifra" style="padding:12px 14px;background:${TONO.suave};border:1px solid ${TONO.borde};border-radius:8px;width:33%">` +
    `<div style="font-size:11px;text-transform:uppercase;color:${TONO.tenue}">${titulo}</div>` +
    `<div style="font-size:20px;font-weight:700;margin-top:4px">${valor}</div>` +
    `<div style="font-size:11px;color:${TONO.tinta2};margin-top:2px">${nota}</div></td>`;

  const tablas = x.facturas
    .map((f) => {
      const filas = f.filas
        .map(
          (r) =>
            `<tr>${td(e(r.modelo), false, "font-weight:600")}${td(e(r.codigoSat || "—"))}${td(r.pares.toLocaleString("es-MX"), true)}` +
            `${td(din6(r.precioSinIva), true)}${td(din(r.precioConIva), true)}${td(din(r.importeSinIva), true)}${td(din(r.iva), true)}${td(din(r.total), true, "font-weight:600")}</tr>`,
        )
        .join("");
      const t = f.totales;
      return (
        `<h2 style="margin:22px 0 8px;font-size:15px;color:${TONO.tinta}">${e(f.titulo)}</h2>` +
        `<table class="g-t" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;border-collapse:collapse">` +
        `<tr>${th("Modelo")}${th("Código SAT")}${th("Pares", true)}${th("Precio sin IVA", true)}${th("Precio con IVA", true)}${th("Importe sin IVA", true)}${th("IVA", true)}${th("Total", true)}</tr>` +
        filas +
        `<tr style="background:${TONO.acentoSuave}">${td("<b>Total</b>")}${td("")}${td(`<b>${t.pares.toLocaleString("es-MX")}</b>`, true)}${td("")}${td("")}` +
        `${td(`<b>${din(t.base)}</b>`, true)}${td(`<b>${din(t.iva)}</b>`, true)}${td(`<b>${din(t.total)}</b>`, true)}</tr>` +
        `</table>` +
        (f.sinPrecio.length
          ? `<p style="font-size:12px;color:${TONO.alerta};margin:6px 0 0">Sin precio (van en blanco): ${e(f.sinPrecio.join(", "))}.</p>`
          : "")
      );
    })
    .join("");

  const komer = x.facturas.find((f) => f.tipo === "komerline");
  const indus = x.facturas.find((f) => f.tipo === "industher");
  const cuerpo =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="6" border="0"><tr>` +
    cifra("Pares", pares.toLocaleString("es-MX"), x.fuente === "erp" ? "del packing list" : "del Excel de costeo") +
    cifra("Industher a Komerline", din(komer?.totales.total ?? null), `${din(komer?.totales.base ?? null)} sin IVA`) +
    cifra("Factura a Industher", din(indus?.totales.total ?? null), `${din(indus?.totales.base ?? null)} sin IVA`) +
    `</tr></table>` +
    tablas +
    (x.avisos.length
      ? `<div style="margin-top:18px;padding:10px 12px;background:${TONO.alertaSuave};border-radius:8px;font-size:12px;color:${TONO.alerta}">` +
        x.avisos.map((a) => `<div style="margin:2px 0">${e(a)}</div>`).join("") +
        `</div>`
      : "") +
    `<p style="font-size:12px;color:${TONO.tenue};margin-top:14px">Adjunto: el Excel con el resumen de la cuenta y una hoja por cada factura. Precios con IVA trasladado (16 %), promedio de ${e(x.meses.map(nombreDelPeriodo).join(", "))}.</p>`;

  const asunto = `Solicitud de factura · contenedor ${contenedor}`;
  const html = plantillaCorreo({
    preencabezado: `${contenedor}: ${pares.toLocaleString("es-MX")} pares · Komerline ${din(komer?.totales.total ?? null)} · Industher ${din(indus?.totales.total ?? null)}`,
    ceja: "Solicitud de factura",
    titulo: `Contenedor ${x.numero}`,
    subtitulo: x.iso ? `Contenedor ${x.iso}` : undefined,
    cuerpo,
    boton: { texto: "Abrir la calculadora fiscal", url: `${URL_ERP}/finanzas/calculadora` },
  });
  const texto =
    `${asunto}\n${pares} pares\n\n` +
    x.facturas
      .map(
        (f) =>
          `${f.titulo}\n` +
          f.filas
            .map((r) => `${r.modelo} · SAT ${r.codigoSat || "—"} · ${r.pares} pares · ${din6(r.precioSinIva)} sin IVA · ${din(r.precioConIva)} con IVA · total ${din(r.total)}`)
            .join("\n") +
          `\nTotal: ${din(f.totales.base)} + IVA ${din(f.totales.iva)} = ${din(f.totales.total)}`,
      )
      .join("\n\n");
  return { asunto, html, texto };
}

/** Arma el Excel, lo manda adjunto y deja constancia. Recuerda los destinatarios. */
export async function mandarSolicitudFactura(
  db: DB,
  cuenta: Cuenta,
  numero: string,
  paraEntrada: unknown,
): Promise<ResultadoCorreo & { para: string[] }> {
  const para = limpiarDestinatarios(paraEntrada);
  if (!para.length) throw new Error("Escribe al menos un correo válido.");
  const archivo = await excelFacturaContenedor(db, cuenta, numero);
  if (!archivo) throw new Error("Contenedor no encontrado.");
  await guardarCacheApp(db, cuenta.id, CLAVE_CORREO_FACTURA, { para }, 0);

  const { buffer, ...datos } = archivo;
  const c = correoSolicitudFactura(datos);
  const res = await enviarCorreo({ para, asunto: c.asunto, html: c.html, texto: c.texto, adjuntos: [{ nombre: archivo.nombre, contenido: buffer }] });
  await db.from("sync_log").insert({
    account_id: cuenta.id,
    tarea: TAREA_CORREO_FACTURA,
    estado: res.enviado ? "ok" : "error",
    fin: new Date().toISOString(),
    detalle: {
      contenedor: archivo.numero,
      para,
      enviado: res.enviado,
      id: res.id ?? null,
      motivo: res.motivo ?? null,
      totales: Object.fromEntries(archivo.facturas.map((f) => [f.tipo, f.totales])),
    },
  });
  return { ...res, para };
}
