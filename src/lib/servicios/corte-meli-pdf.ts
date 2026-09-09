/**
 * PDF del corte mensual de Mercado Libre.
 *
 * Una hoja carta que se pueda mandar por WhatsApp y leer en el teléfono: la
 * cifra que importa (utilidad neta) grande arriba, la cascada de la venta a
 * la ganancia con barras, y después el detalle por modelo, categoría y día.
 * Se dibuja con pdf-lib y las fuentes estándar (Helvetica), que cubren los
 * acentos del español sin incrustar nada.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { nombreDelPeriodo, type EstadoResultados } from "./corte-meli";
import { puenteVentaANeto } from "./corte-meli-cascada";

const CARTA: [number, number] = [612, 792];
const M = 40;
const ANCHO = CARTA[0] - 2 * M;

const MARINO = rgb(0.043, 0.122, 0.227);
const ACENTO = rgb(0.184, 0.427, 0.965);
const TINTA = rgb(0.1, 0.1, 0.1);
const GRIS = rgb(0.4, 0.4, 0.4);
const GRIS_CLARO = rgb(0.6, 0.6, 0.6);
const LINEA = rgb(0.88, 0.9, 0.92);
const FONDO = rgb(0.957, 0.965, 0.976);
const VERDE = rgb(0, 0.52, 0.29);
const ROJO = rgb(0.85, 0.2, 0.28);
const BLANCO = rgb(1, 1, 1);

export function pesosPdf(x: number): string {
  const abs = Math.abs(x).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (x < 0 ? "-$" : "$") + abs;
}

function enteros(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function pct(x: number | null): string {
  return x == null ? "—" : `${(x * 100).toFixed(1)}%`;
}

function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${d} ${meses[(m ?? 1) - 1]} ${a}`;
}

/** Texto en WinAnsi: lo que Helvetica estándar no tiene se sustituye. */
function ansi(t: string): string {
  return t
    .replace(/[−]/g, "-")
    .replace(/[→]/g, "->")
    .replace(/[≤]/g, "<=")
    .replace(/[≥]/g, ">=")
    .replace(/[^\x00-\xff–—‘’“”•…]/g, "?");
}

export async function pdfDelCorte(e: EstadoResultados, opts?: { preliminar?: boolean; negocio?: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const negocio = opts?.negocio ?? "Mercado Libre";
  const titulo = `Corte ${nombreDelPeriodo(e.periodo)} · ${negocio}`;
  doc.setTitle(titulo);
  doc.setAuthor(e.cuenta ?? "ERP");

  const paginas: PDFPage[] = [];
  let pagina!: PDFPage;
  let y = 0;

  const nuevaPagina = () => {
    pagina = doc.addPage(CARTA);
    paginas.push(pagina);
    y = CARTA[1] - M;
  };
  const texto = (t: string, x: number, yy: number, size: number, font: PDFFont = normal, color: RGB = TINTA) =>
    pagina.drawText(ansi(t), { x, y: yy, size, font, color });
  const textoDer = (t: string, xDer: number, yy: number, size: number, font: PDFFont = normal, color: RGB = TINTA) => {
    const s = ansi(t);
    pagina.drawText(s, { x: xDer - font.widthOfTextAtSize(s, size), y: yy, size, font, color });
  };
  const recorta = (t: string, ancho: number, size: number, font: PDFFont = normal): string => {
    let s = ansi(t);
    if (font.widthOfTextAtSize(s, size) <= ancho) return s;
    while (s.length > 1 && font.widthOfTextAtSize(s + "…", size) > ancho) s = s.slice(0, -1);
    return s + "…";
  };
  const linea = (yy: number, color: RGB = LINEA, grosor = 0.6) =>
    pagina.drawLine({ start: { x: M, y: yy }, end: { x: M + ANCHO, y: yy }, thickness: grosor, color });
  const asegurar = (alto: number) => {
    if (y - alto < M + 24) {
      nuevaPagina();
      encabezadoChico();
    }
  };
  const encabezadoChico = () => {
    texto(titulo, M, y - 8, 9, negrita, GRIS);
    textoDer(`${fechaLarga(e.desde)} – ${fechaLarga(e.hasta)}`, M + ANCHO, y - 8, 9, normal, GRIS);
    y -= 16;
    linea(y);
    y -= 18;
  };
  const seccion = (t: string, sub?: string) => {
    asegurar(sub ? 44 : 32);
    texto(t.toUpperCase(), M, y - 10, 9, negrita, ACENTO);
    if (sub) {
      texto(sub, M, y - 22, 8, normal, GRIS);
      y -= 30;
    } else {
      y -= 18;
    }
  };

  // --- Portada: banda, cifras y cascada ------------------------------------
  nuevaPagina();
  pagina.drawRectangle({ x: 0, y: CARTA[1] - 118, width: CARTA[0], height: 118, color: MARINO });
  pagina.drawRectangle({ x: 0, y: CARTA[1] - 122, width: CARTA[0], height: 4, color: ACENTO });
  texto(`CORTE MENSUAL · ${negocio.toUpperCase()}`, M, CARTA[1] - 38, 9, negrita, rgb(0.7, 0.78, 0.95));
  texto(nombreDelPeriodo(e.periodo), M, CARTA[1] - 74, 30, negrita, BLANCO);
  texto(`Del ${fechaLarga(e.desde)} al ${fechaLarga(e.hasta)} · ${e.dias} días`, M, CARTA[1] - 96, 10, normal, rgb(0.85, 0.88, 0.95));
  if (e.cuenta) textoDer(e.cuenta, M + ANCHO, CARTA[1] - 38, 11, negrita, BLANCO);
  const estadoCorte = opts?.preliminar
    ? "VISTA PRELIMINAR (sin corte guardado)"
    : e.revision.exacto
      ? "CORTE EXACTO"
      : "CORTE CON PENDIENTES (ver avisos)";
  textoDer(estadoCorte, M + ANCHO, CARTA[1] - 58, 8, negrita, e.revision.exacto && !opts?.preliminar ? rgb(0.55, 0.9, 0.7) : rgb(1, 0.85, 0.5));
  textoDer(
    `Generado ${new Date(e.generadoEn).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`,
    M + ANCHO,
    CARTA[1] - 96,
    8,
    normal,
    rgb(0.7, 0.75, 0.85),
  );
  y = CARTA[1] - 122 - 22;

  // Cuatro fichas.
  const fichas: { titulo: string; valor: string; nota: string; color?: RGB }[] = [
    { titulo: "Venta bruta", valor: pesosPdf(e.ventaBruta), nota: `${enteros(e.unidades)} pares · ${enteros(e.ordenes)} órdenes` },
    { titulo: "Neto depositado", valor: pesosPdf(e.netoDepositado), nota: `${pct(e.netoDepositado / Math.max(1, e.ventaBruta))} de la venta` },
    {
      titulo: "Utilidad neta",
      valor: pesosPdf(e.utilidadNeta),
      nota: e.gananciaPorPar != null ? `${pesosPdf(e.gananciaPorPar)} por par` : "",
      color: e.utilidadNeta < 0 ? ROJO : VERDE,
    },
    { titulo: "Margen", valor: pct(e.margenSobreVenta), nota: `sobre el neto: ${pct(e.margenSobreNeto)}` },
  ];
  const anchoFicha = (ANCHO - 3 * 10) / 4;
  fichas.forEach((f, i) => {
    const x = M + i * (anchoFicha + 10);
    pagina.drawRectangle({ x, y: y - 64, width: anchoFicha, height: 64, color: FONDO });
    if (f.color) pagina.drawRectangle({ x, y: y - 3, width: anchoFicha, height: 3, color: f.color });
    texto(f.titulo, x + 10, y - 18, 8, negrita, GRIS);
    const tam = f.valor.length > 13 ? 13 : 16;
    texto(f.valor, x + 10, y - 40, tam, negrita, f.color ?? TINTA);
    texto(f.nota, x + 10, y - 54, 7.5, normal, GRIS_CLARO);
  });
  y -= 64 + 24;

  // Cascada.
  seccion("De la venta a la ganancia", "Cada renglón es dinero real: lo que Mercado Pago depositó, lo que costó el producto y lo que se pagó aparte.");
  type Renglon = { etiqueta: string; monto: number; tipo: "base" | "resta" | "suma" | "total" | "final"; nota?: string };
  const puente = puenteVentaANeto(e);
  const cascada: Renglon[] = [
    { etiqueta: "Venta bruta", monto: puente.ventaBruta, tipo: "base", nota: "precio × pares de las órdenes pagadas" },
    { etiqueta: "Comisión de MELI", monto: -puente.comision, tipo: "resta", nota: `cargo por venta (sale fee)${e.reventa?.ordenes ? (e.reventa.reconstruidas ? `; ${enteros(e.reventa.reconstruidas)} ventas en reventa reconstruidas al precio público (${pesosPdf(e.reventa.totalComprador ?? e.reventa.importe)})` : `; ${enteros(e.reventa.ordenes)} ventas en reventa por ${pesosPdf(e.reventa.importe)} ya vienen netas`) : ""}` },
    { etiqueta: "Envío", monto: -puente.envio, tipo: "resta", nota: "cargo de envío asociado a las ventas" },
    { etiqueta: "Retención ISR", monto: -puente.isr, tipo: "resta", nota: "impuesto adelantado enterado por MELI al SAT" },
    { etiqueta: "Retención IVA", monto: -puente.iva, tipo: "resta", nota: "impuesto adelantado enterado por MELI al SAT" },
    ...(puente.retencionSinSeparar ? [{ etiqueta: "Retenciones sin separar", monto: -puente.retencionSinSeparar, tipo: "resta" as const, nota: "ISR + IVA que Mercado Pago entregó sumados, sin desglosar" }] : []),
    { etiqueta: "Otros cargos", monto: -puente.otros, tipo: "resta", nota: e.cargosSinDesglosar ? `incluye ${pesosPdf(e.cargosSinDesglosar)} sin concepto por operación` : "otros descuentos incluidos en el depósito" },
    ...(puente.ajusteLiquidacion ? [{ etiqueta: "Ajuste posterior de liquidación", monto: -puente.ajusteLiquidacion, tipo: "resta" as const, nota: "cambio del saldo de Mercado Pago después del depósito original" }] : []),
    ...(puente.devolucionesIncluidasEnNeto ? [{ etiqueta: "Reembolsos ya reflejados en el neto", monto: -puente.devolucionesIncluidasEnNeto, tipo: "resta" as const, nota: "Mercado Pago ya redujo el saldo actual; este renglón cuadra la cascada" }] : []),
    { etiqueta: "Neto depositado por Mercado Pago", monto: puente.netoDepositado, tipo: "total", nota: e.netoEstimado > 0 ? `${pesosPdf(e.netoEstimado)} estimado (sin depósito real aún)` : "depósito real de todas las órdenes" },
    { etiqueta: "Devoluciones", monto: -e.devoluciones.monto, tipo: "resta", nota: `${enteros(e.devoluciones.ordenes)} órdenes; ${pesosPdf(e.devoluciones.incluidoEnNeto ?? 0)} ya está reflejado en el neto` },
    ...(e.devoluciones.ordenes
      ? [{ etiqueta: "Costo recuperado de devoluciones", monto: e.devoluciones.costoRecuperado, tipo: "suma" as const, nota: `${enteros(e.devoluciones.unidades)} pares que regresan al stock${e.devoluciones.costoEstimado ? ` (${pesosPdf(e.devoluciones.costoEstimado)} estimado)` : ""}` }]
      : []),
    { etiqueta: "Costo de producto", monto: -e.costoProducto, tipo: "resta", nota: `${enteros(e.unidadesConCosto)} de ${enteros(e.unidades)} pares con costo capturado` },
    { etiqueta: "Utilidad bruta", monto: e.utilidadBruta, tipo: "total" },
    { etiqueta: "Publicidad", monto: -e.publicidad.total, tipo: "resta", nota: `Product Ads ${pesosPdf(e.publicidad.ads)}${e.publicidad.manual ? ` + a mano ${pesosPdf(e.publicidad.manual)}` : ""}` },
    { etiqueta: "Gastos de Full", monto: -e.full.total, tipo: "resta", nota: `facturado por MELI ${pesosPdf(e.full.cargosMeli)}${e.full.manual ? ` + a mano ${pesosPdf(e.full.manual)}` : ""}` },
    { etiqueta: "Otros gastos", monto: -e.otros.total, tipo: "resta", nota: `otros cargos de MELI ${pesosPdf(e.otros.cargosMeli)}${e.otros.manual ? ` + a mano ${pesosPdf(e.otros.manual)}` : ""}` },
    { etiqueta: "UTILIDAD NETA", monto: e.utilidadNeta, tipo: "final" },
  ];
  const xBarra = M + 250;
  const anchoBarra = ANCHO - 250 - 110;
  const escala = e.ventaBruta > 0 ? anchoBarra / e.ventaBruta : 0;
  for (const r of cascada) {
    const alto = r.nota ? 26 : 20;
    asegurar(alto);
    const esTotal = r.tipo === "total" || r.tipo === "final";
    if (esTotal) linea(y, LINEA, 0.8);
    const f = esTotal ? negrita : normal;
    const tam = r.tipo === "final" ? 12 : esTotal ? 10 : 9.5;
    const color = r.tipo === "final" ? (r.monto < 0 ? ROJO : VERDE) : r.tipo === "suma" ? VERDE : esTotal ? TINTA : r.tipo === "resta" ? GRIS : TINTA;
    texto(r.etiqueta, M, y - 13, tam, f, r.tipo === "resta" ? TINTA : color);
    if (r.nota) texto(r.nota, M, y - 23, 7, normal, GRIS_CLARO);
    // Barra proporcional a la venta bruta.
    const w = Math.max(0, Math.min(anchoBarra, Math.abs(r.monto) * escala));
    if (w > 0.5) {
      pagina.drawRectangle({
        x: xBarra,
        y: y - 15,
        width: w,
        height: 8,
        color: r.tipo === "resta" ? rgb(0.93, 0.62, 0.66) : r.tipo === "suma" ? rgb(0.72, 0.89, 0.78) : r.tipo === "final" ? (r.monto < 0 ? ROJO : VERDE) : r.tipo === "total" ? ACENTO : rgb(0.75, 0.78, 0.84),
      });
    }
    textoDer((r.tipo === "suma" ? "+" : "") + pesosPdf(r.monto), M + ANCHO, y - 13, tam, f, color);
    y -= alto;
  }
  y -= 8;

  // Cancelaciones y pares.
  asegurar(30);
  texto(
    `Fuera del corte: ${enteros(e.cancelaciones.ordenes)} órdenes canceladas por ${pesosPdf(e.cancelaciones.importe)} (ni venta ni neto). Revisadas contra devoluciones: ${enteros(e.revision.revisadas)} de ${enteros(e.revision.ordenes)} órdenes.`,
    M,
    y - 10,
    8,
    normal,
    GRIS,
  );
  y -= 24;

  // Avisos.
  seccion(e.revision.exacto ? "Corte exacto" : "Qué le falta al corte para ser exacto");
  if (e.avisos.length === 0) {
    texto("Todas las órdenes tienen su depósito real, su revisión de devoluciones y su costo; publicidad y cargos de MELI leídos del API.", M, y - 10, 8.5, normal, VERDE);
    y -= 18;
  }
  for (const a of e.avisos) {
    const lineas = envolver(a, ANCHO - 14, 8.5, normal);
    asegurar(lineas.length * 11 + 4);
    texto("•", M, y - 10, 8.5, negrita, ACENTO);
    lineas.forEach((l, i) => texto(l, M + 12, y - 10 - i * 11, 8.5, normal, TINTA));
    y -= lineas.length * 11 + 4;
  }

  // --- Por modelo -----------------------------------------------------------
  nuevaPagina();
  encabezadoChico();
  seccion("Por modelo", "Neto = depósito real repartido por SKU; ganancia = neto − costo − publicidad del modelo. Ordenado por neto.");
  const colsM = [
    { t: "Modelo", w: 96, der: false },
    { t: "Categoría", w: 80, der: false },
    { t: "Pares", w: 44, der: true },
    { t: "Venta", w: 76, der: true },
    { t: "Neto", w: 76, der: true },
    { t: "Costo", w: 66, der: true },
    { t: "Ads", w: 56, der: true },
    { t: "Ganancia", w: ANCHO - 96 - 80 - 44 - 76 - 76 - 66 - 56, der: true },
  ];
  const cabecera = (cols: typeof colsM) => {
    let x = M;
    for (const col of cols) {
      if (col.der) textoDer(col.t, x + col.w, y - 9, 7.5, negrita, GRIS);
      else texto(col.t, x, y - 9, 7.5, negrita, GRIS);
      x += col.w;
    }
    y -= 13;
    linea(y, LINEA, 0.8);
    y -= 2;
  };
  const fila = (cols: typeof colsM, valores: (string | null)[], opciones?: { negrita?: boolean; colorUltima?: RGB; fondo?: boolean }) => {
    asegurar(16);
    if (opciones?.fondo) pagina.drawRectangle({ x: M, y: y - 13, width: ANCHO, height: 14, color: FONDO });
    let x = M;
    const f = opciones?.negrita ? negrita : normal;
    valores.forEach((v, i) => {
      const col = cols[i];
      const s = v ?? "—";
      const color = i === valores.length - 1 && opciones?.colorUltima ? opciones.colorUltima : TINTA;
      if (col.der) textoDer(s, x + col.w, y - 10, 8, f, color);
      else texto(recorta(s, col.w - 6, 8, f), x, y - 10, 8, f, color);
      x += col.w;
    });
    y -= 14;
  };
  cabecera(colsM);
  for (const m of e.porModelo.slice(0, 60)) {
    fila(colsM, [
      m.modelo,
      m.categoria,
      enteros(m.unidades),
      pesosPdf(m.importe),
      pesosPdf(m.neto),
      m.costo == null ? "sin costo" : pesosPdf(m.costo),
      m.publicidad ? pesosPdf(m.publicidad) : "—",
      m.ganancia == null ? "—" : pesosPdf(m.ganancia),
    ], { colorUltima: m.ganancia == null ? GRIS : m.ganancia < 0 ? ROJO : VERDE });
  }
  if (e.porModelo.length > 60) {
    asegurar(14);
    texto(`… y ${e.porModelo.length - 60} modelos más con menos venta.`, M, y - 10, 7.5, normal, GRIS);
    y -= 14;
  }
  y -= 10;

  // --- Por categoría --------------------------------------------------------
  seccion("Por categoría");
  const colsC = [
    { t: "Categoría", w: 176, der: false },
    { t: "Pares", w: 44, der: true },
    { t: "Venta", w: 76, der: true },
    { t: "Neto", w: 76, der: true },
    { t: "Costo", w: 66, der: true },
    { t: "Ads", w: 56, der: true },
    { t: "Ganancia", w: ANCHO - 176 - 44 - 76 - 76 - 66 - 56, der: true },
  ];
  cabecera(colsC);
  for (const k of e.porCategoria) {
    fila(colsC, [
      k.categoria,
      enteros(k.unidades),
      pesosPdf(k.importe),
      pesosPdf(k.neto),
      k.costo == null ? "sin costo" : pesosPdf(k.costo),
      k.publicidad ? pesosPdf(k.publicidad) : "—",
      k.ganancia == null ? "—" : pesosPdf(k.ganancia),
    ], { colorUltima: k.ganancia == null ? GRIS : k.ganancia < 0 ? ROJO : VERDE });
  }
  y -= 10;

  // --- Gastos y cargos ------------------------------------------------------
  if (e.gastosManuales.length || e.cargosPorTipo.length) {
    seccion("Gastos del mes", "Lo capturado a mano y lo que MELI facturó en el periodo, por tipo. Comisión y envío ya van dentro del neto y no se restan dos veces.");
    const colsG = [
      { t: "Fecha", w: 70, der: false },
      { t: "Concepto", w: 300, der: false },
      { t: "Clase", w: 80, der: false },
      { t: "Monto", w: ANCHO - 70 - 300 - 80, der: true },
    ];
    cabecera(colsG);
    const clase: Record<string, string> = { full: "Full", publicidad: "Publicidad", otro: "Otro", venta: "En el neto", pago: "Pago/abono", bonificacion: "Anulación", resumen: "Resumen" };
    for (const g of e.gastosManuales) fila(colsG, [fechaLarga(g.fecha), g.concepto, `${clase[g.categoria] ?? g.categoria} (a mano)`, pesosPdf(g.monto)]);
    for (const k of e.cargosPorTipo) fila(colsG, ["MELI", `${k.tipo} · ${k.renglones} renglones`, clase[k.clase] ?? k.clase, pesosPdf(k.monto)], { fondo: k.clase === "full" });
    y -= 10;
  }

  // --- Por día --------------------------------------------------------------
  seccion("Por día", "Neto real (depósito) o estimado (*) mientras Mercado Pago lo asienta.");
  const colsD = [
    { t: "Día", w: 60, der: false },
    { t: "Pares", w: 46, der: true },
    { t: "Órdenes", w: 52, der: true },
    { t: "Venta", w: 80, der: true },
    { t: "Neto", w: 84, der: true },
  ];
  // Dos columnas de días para que quepa el mes en una página.
  const anchoCol = colsD.reduce((a, col) => a + col.w, 0);
  const sep = ANCHO - 2 * anchoCol;
  const dias = e.porDia;
  const mitad = Math.ceil(dias.length / 2);
  const dibujaCabeceraDia = () => {
    for (const desplaza of [0, anchoCol + sep]) {
      let x = M + desplaza;
      for (const col of colsD) {
        if (col.der) textoDer(col.t, x + col.w, y - 9, 7.5, negrita, GRIS);
        else texto(col.t, x, y - 9, 7.5, negrita, GRIS);
        x += col.w;
      }
    }
    y -= 13;
    linea(y, LINEA, 0.8);
    y -= 2;
  };
  asegurar(16 * Math.min(mitad, 8));
  dibujaCabeceraDia();
  for (let i = 0; i < mitad; i++) {
    asegurar(14);
    for (const [j, desplaza] of [0, anchoCol + sep].entries()) {
      const d = dias[i + j * mitad];
      if (!d) continue;
      let x = M + desplaza;
      const valores = [fechaLarga(d.fecha), enteros(d.unidades), enteros(d.ordenes), pesosPdf(d.importe), pesosPdf(d.neto) + (d.real ? "" : " *")];
      valores.forEach((v, k) => {
        const col = colsD[k];
        if (col.der) textoDer(v, x + col.w, y - 10, 7.5, normal, d.real || k < 4 ? TINTA : GRIS);
        else texto(v, x, y - 10, 7.5, normal, TINTA);
        x += col.w;
      });
    }
    y -= 13;
  }

  // Pie de página.
  paginas.forEach((pg, i) => {
    const s = ansi(`${titulo} · página ${i + 1} de ${paginas.length}`);
    pg.drawText(s, { x: M, y: M - 18, size: 7, font: normal, color: GRIS_CLARO });
    const d = ansi(estadoCorte);
    pg.drawText(d, { x: M + ANCHO - normal.widthOfTextAtSize(d, 7), y: M - 18, size: 7, font: normal, color: GRIS_CLARO });
  });

  return doc.save();

  function envolver(t: string, ancho: number, size: number, font: PDFFont): string[] {
    const palabras = ansi(t).split(/\s+/);
    const lineas: string[] = [];
    let actual = "";
    for (const w of palabras) {
      const prueba = actual ? `${actual} ${w}` : w;
      if (font.widthOfTextAtSize(prueba, size) > ancho && actual) {
        lineas.push(actual);
        actual = w;
      } else {
        actual = prueba;
      }
    }
    if (actual) lineas.push(actual);
    return lineas;
  }
}
