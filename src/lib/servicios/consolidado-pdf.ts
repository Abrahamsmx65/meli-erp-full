/**
 * PDF del CORTE GENERAL: un informe para leer, no una tabla (pedido del
 * dueño, 9-oct-2026: «que al hacer corte genere el PDF precioso con
 * gráficas y explicaciones»).
 *
 * Hoja carta, dibujado con pdf-lib y Helvetica (cubre los acentos sin
 * incrustar nada), como el corte de MELI:
 *   1. Portada: la utilidad grande, cuatro cifras, «lo que pasó en el mes»
 *      con palabras y la cascada de la venta a la utilidad.
 *   2. Canales: a dónde se fue cada peso de venta (barras apiladas), la
 *      utilidad por canal, la comparación contra el mes anterior y la tabla.
 *   3. Categorías y modelos: barras de ganancia, los que más dejaron y los
 *      que perdieron.
 *   4. Qué falta y cómo se calcula.
 * Todo sale del consolidado guardado (`consolidado-informe.ts` arma las
 * frases); el PDF no recalcula nada.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { nombreDelPeriodo } from "./corte-meli";
import type { Consolidado } from "./consolidado";
import type { ComparacionMensual } from "./consolidado-comparar";
import {
  CANAL_CORTO,
  cascadaDelMes,
  avisosParaMostrar,
  estadoDelCorte,
  loQuePaso,
  modelosDestacados,
  repartoDelPeso,
} from "./consolidado-informe";

const CARTA: [number, number] = [612, 792];
const M = 40;
const ANCHO = CARTA[0] - 2 * M;

// Paleta de la marca GETAC (globals.css): tinta café, acento café, fondos crema.
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const MARINO = hex("#2b2119");
const ACENTO = hex("#8b6640");
const TINTA = hex("#2a2019");
const GRIS = hex("#5e5146");
const GRIS_CLARO = hex("#998a7b");
const LINEA = hex("#e9e1d6");
const FONDO = hex("#faf7f2");
const VERDE = hex("#00854a");
const ROJO = hex("#c4182b");
const AMBAR = hex("#8a6100");
const BLANCO = rgb(1, 1, 1);

/** Los cinco destinos de cada peso de venta, siempre con el mismo color. */
const DESTINO = {
  plataforma: { nombre: "Plataforma", color: hex("#d9c7b2") },
  costo: { nombre: "Producto", color: hex("#8b6640") },
  publicidad: { nombre: "Publicidad", color: hex("#d3a52e") },
  gastos: { nombre: "Gastos de plataforma", color: hex("#b5523b") },
  utilidad: { nombre: "Utilidad", color: hex("#2f9c63") },
} as const;

/** Un color por canal, el mismo en todas las gráficas. */
const COLOR_CANAL: Record<string, RGB> = {
  meli_calzado: hex("#a35f1c"),
  meli_fundas: hex("#2f9c63"),
  amazon: hex("#3a72b8"),
  tiktok: hex("#d3a52e"),
};

function pesos(x: number): string {
  return (x < 0 ? "-$" : "$") + Math.abs(x).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pesosRedondos(x: number): string {
  return (x < 0 ? "-$" : "$") + Math.round(Math.abs(x)).toLocaleString("es-MX");
}
function compacto(x: number): string {
  const a = Math.abs(x);
  const s = x < 0 ? "-$" : "$";
  if (a >= 1_000_000) return `${s}${(a / 1_000_000).toFixed(2)} M`;
  if (a >= 1_000) return `${s}${Math.round(a / 1000)} mil`;
  return `${s}${Math.round(a)}`;
}
function enteros(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}
function pct(x: number | null | undefined): string {
  return x == null ? "—" : `${(x * 100).toFixed(1)}%`;
}
function cambioTexto(x: number | null): string {
  if (x == null) return "nuevo";
  return `${x >= 0 ? "+" : "-"}${(Math.abs(x) * 100).toFixed(1)}%`;
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
    .replace(/[▲]/g, "+")
    .replace(/[▼]/g, "-")
    .replace(/[^\x00-\xff–—‘’“”•…]/g, "?");
}

export async function pdfDelConsolidado(
  cns: Consolidado,
  opts?: { comparacion?: ComparacionMensual | null; preliminar?: boolean },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const mes = nombreDelPeriodo(cns.periodo);
  const titulo = `Estado de resultados · ${mes}`;
  doc.setTitle(titulo);
  doc.setAuthor("GETAC ERP");

  const estado = estadoDelCorte(cns);
  const comp = opts?.comparacion ?? null;
  const canales = cns.canales.filter((k) => k.calculable !== false);

  const paginas: PDFPage[] = [];
  let pagina!: PDFPage;
  let y = 0;

  const texto = (t: string, x: number, yy: number, size: number, font: PDFFont = normal, color: RGB = TINTA) =>
    pagina.drawText(ansi(t), { x, y: yy, size, font, color });
  const textoDer = (t: string, xDer: number, yy: number, size: number, font: PDFFont = normal, color: RGB = TINTA) => {
    const s = ansi(t);
    pagina.drawText(s, { x: xDer - font.widthOfTextAtSize(s, size), y: yy, size, font, color });
  };
  const textoCentro = (t: string, xCentro: number, yy: number, size: number, font: PDFFont = normal, color: RGB = TINTA) => {
    const s = ansi(t);
    pagina.drawText(s, { x: xCentro - font.widthOfTextAtSize(s, size) / 2, y: yy, size, font, color });
  };
  const recorta = (t: string, ancho: number, size: number, font: PDFFont = normal): string => {
    let s = ansi(t);
    if (font.widthOfTextAtSize(s, size) <= ancho) return s;
    while (s.length > 1 && font.widthOfTextAtSize(s + "…", size) > ancho) s = s.slice(0, -1);
    return s + "…";
  };
  const envolver = (t: string, ancho: number, size: number, font: PDFFont = normal): string[] => {
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
  };
  const linea = (yy: number, color: RGB = LINEA, grosor = 0.6) =>
    pagina.drawLine({ start: { x: M, y: yy }, end: { x: M + ANCHO, y: yy }, thickness: grosor, color });

  const nuevaPagina = (encabezado = true) => {
    pagina = doc.addPage(CARTA);
    paginas.push(pagina);
    y = CARTA[1] - M;
    if (encabezado) {
      texto(titulo, M, y - 8, 9, negrita, GRIS);
      textoDer(`${fechaLarga(cns.desde)} – ${fechaLarga(cns.hasta)}`, M + ANCHO, y - 8, 9, normal, GRIS);
      y -= 16;
      linea(y);
      y -= 20;
    }
  };
  const asegurar = (alto: number) => {
    if (y - alto < M + 24) nuevaPagina();
  };
  const seccion = (t: string, sub?: string) => {
    const lineasSub = sub ? envolver(sub, ANCHO, 8.5) : [];
    asegurar(26 + lineasSub.length * 11 + 40);
    texto(t.toUpperCase(), M, y - 10, 10, negrita, ACENTO);
    y -= 18;
    for (const l of lineasSub) {
      texto(l, M, y - 8, 8.5, normal, GRIS);
      y -= 11;
    }
    y -= 8;
  };
  const parrafo = (t: string, size = 9, color: RGB = TINTA, sangria = 0) => {
    const lineas = envolver(t, ANCHO - sangria, size);
    asegurar(lineas.length * (size + 3.5));
    for (const l of lineas) {
      texto(l, M + sangria, y - size, size, normal, color);
      y -= size + 3.5;
    }
  };
  const vineta = (t: string, color: RGB = ACENTO) => {
    const lineas = envolver(t, ANCHO - 14, 9.5);
    asegurar(lineas.length * 13 + 4);
    pagina.drawCircle({ x: M + 4, y: y - 6.5, size: 2.2, color });
    for (const l of lineas) {
      texto(l, M + 14, y - 9.5, 9.5, normal, TINTA);
      y -= 13;
    }
    y -= 4;
  };

  type Col = { t: string; w: number; der: boolean };
  const cabecera = (cols: Col[]) => {
    asegurar(30);
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
  const fila = (cols: Col[], valores: string[], o?: { negrita?: boolean; fondo?: boolean; colorUltima?: RGB; colores?: (RGB | undefined)[] }) => {
    asegurar(14);
    if (o?.fondo) pagina.drawRectangle({ x: M, y: y - 13, width: ANCHO, height: 13, color: FONDO });
    let x = M;
    valores.forEach((v, i) => {
      const col = cols[i];
      const f = o?.negrita ? negrita : normal;
      const color = o?.colores?.[i] ?? (i === valores.length - 1 && o?.colorUltima ? o.colorUltima : TINTA);
      const s = recorta(v, col.w - 4, 7.5, f);
      if (col.der) textoDer(s, x + col.w, y - 10, 7.5, f, color);
      else texto(s, x, y - 10, 7.5, f, color);
      x += col.w;
    });
    y -= 13;
  };
  const leyenda = (items: { nombre: string; color: RGB }[]) => {
    asegurar(16);
    let x = M;
    for (const it of items) {
      pagina.drawRectangle({ x, y: y - 8, width: 8, height: 8, color: it.color });
      texto(it.nombre, x + 11, y - 7.5, 7.5, normal, GRIS);
      x += 11 + normal.widthOfTextAtSize(ansi(it.nombre), 7.5) + 14;
    }
    y -= 16;
  };

  /** Barras horizontales con su valor; los negativos en rojo hacia la izquierda. */
  const barrasHorizontales = (datos: { etiqueta: string; valor: number; color?: RGB; nota?: string }[], formato: (x: number) => string) => {
    const anchoEtiqueta = 120;
    const anchoValor = 70;
    const anchoNota = datos.some((d) => d.nota) ? 52 : 0;
    const anchoBarra = ANCHO - anchoEtiqueta - anchoValor - anchoNota - 8;
    const max = Math.max(...datos.map((d) => Math.abs(d.valor)), 1);
    const hayNegativos = datos.some((d) => d.valor < 0);
    const minimo = Math.min(...datos.map((d) => d.valor), 0);
    const escala = hayNegativos ? anchoBarra / (max + Math.abs(minimo)) : anchoBarra / max;
    const cero = M + anchoEtiqueta + (hayNegativos ? Math.abs(minimo) * escala : 0);
    for (const d of datos) {
      asegurar(15);
      texto(recorta(d.etiqueta, anchoEtiqueta - 6, 8), M, y - 9, 8, normal, TINTA);
      const largo = Math.max(1, Math.abs(d.valor) * escala);
      const x = d.valor >= 0 ? cero : cero - largo;
      pagina.drawRectangle({ x, y: y - 11, width: largo, height: 10, color: d.color ?? (d.valor < 0 ? ROJO : ACENTO) });
      textoDer(formato(d.valor), M + ANCHO, y - 9, 8, negrita, d.valor < 0 ? ROJO : TINTA);
      if (d.nota) textoDer(d.nota, M + ANCHO - anchoValor - 4, y - 9, 7, normal, GRIS);
      y -= 15;
    }
    if (hayNegativos) pagina.drawLine({ start: { x: cero, y: y + 2 }, end: { x: cero, y: y + 15 * datos.length + 2 }, thickness: 0.5, color: GRIS_CLARO });
    y -= 4;
  };

  // =========================================================================
  // 1. Portada
  // =========================================================================
  nuevaPagina(false);
  pagina.drawRectangle({ x: 0, y: CARTA[1] - 128, width: CARTA[0], height: 128, color: MARINO });
  pagina.drawRectangle({ x: 0, y: CARTA[1] - 132, width: CARTA[0], height: 4, color: ACENTO });
  texto("ESTADO DE RESULTADOS · GETAC", M, CARTA[1] - 38, 9, negrita, hex("#c8aa8c"));
  texto(mes.charAt(0).toUpperCase() + mes.slice(1), M, CARTA[1] - 76, 32, negrita, BLANCO);
  texto(
    `Del ${fechaLarga(cns.desde)} al ${fechaLarga(cns.hasta)} · ${canales.map((k) => CANAL_CORTO[k.canal]).join(" · ")}`,
    M,
    CARTA[1] - 100,
    10,
    normal,
    hex("#e9dccb"),
  );
  const colorEstado = estado.estado === "definitivo" ? hex("#9fd8b5") : estado.estado === "preliminar" ? hex("#e9dccb") : hex("#f0dca0");
  textoDer(opts?.preliminar ? "VISTA PREVIA (sin corte guardado)" : estado.etiqueta.toUpperCase(), M + ANCHO, CARTA[1] - 38, 9, negrita, colorEstado);
  textoDer(
    `Datos del ${new Date(cns.generadoEn).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`,
    M + ANCHO,
    CARTA[1] - 100,
    8,
    normal,
    hex("#c8aa8c"),
  );
  y = CARTA[1] - 132 - 24;

  // La cifra que importa, grande.
  const t = cns.total;
  pagina.drawRectangle({ x: M, y: y - 76, width: ANCHO, height: 76, color: FONDO });
  pagina.drawRectangle({ x: M, y: y - 76, width: 4, height: 76, color: t.utilidadNeta < 0 ? ROJO : VERDE });
  texto("UTILIDAD NETA DEL MES", M + 18, y - 20, 8.5, negrita, GRIS);
  texto(pesos(t.utilidadNeta), M + 18, y - 52, 28, negrita, t.utilidadNeta < 0 ? ROJO : VERDE);
  texto(
    `${pct(t.margenSobreVenta)} de la venta · ${t.gananciaPorUnidad != null ? pesos(t.gananciaPorUnidad) : "—"} por unidad`,
    M + 18,
    y - 68,
    8.5,
    normal,
    GRIS,
  );
  if (comp) {
    const total = comp.renglones.find((r) => r.canal === "total");
    const x0 = M + ANCHO - 180;
    texto(comp.base === "mismos-dias" ? `CONTRA LOS MISMOS DÍAS DE ${nombreDelPeriodo(comp.periodoAnterior).toUpperCase()}` : `CONTRA ${nombreDelPeriodo(comp.periodoAnterior).toUpperCase()}`, x0, y - 20, 7, negrita, GRIS);
    const ut = comp.utilidadNeta;
    texto(`Utilidad ${cambioTexto(ut.cambio)}`, x0, y - 38, 11, negrita, (ut.cambio ?? 0) >= 0 ? VERDE : ROJO);
    texto(`antes ${pesosRedondos(ut.anterior)}`, x0, y - 50, 8, normal, GRIS);
    if (total) {
      texto(`Unidades ${cambioTexto(total.unidades.cambio)}`, x0, y - 64, 9, negrita, (total.unidades.cambio ?? 0) >= 0 ? VERDE : ROJO);
    }
  }
  y -= 76 + 14;

  // Cuatro cifras.
  const fichas = [
    { titulo: "Venta bruta", valor: compacto(t.ventaBruta), nota: `${enteros(t.unidades)} unidades` },
    { titulo: "Pagaron las plataformas", valor: compacto(t.neto), nota: `${pct(t.ventaBruta ? t.neto / t.ventaBruta : null)} de la venta` },
    { titulo: "Costo del producto", valor: compacto(t.costoProducto), nota: `${pct(t.ventaBruta ? t.costoProducto / t.ventaBruta : null)} de la venta` },
    { titulo: "Publicidad y gastos", valor: compacto(t.publicidad + t.gastosGenerales - cns.canales.reduce((a, k) => a + (k.adsGenerales ?? 0), 0)), nota: "ads + Full, FBA, devoluciones" },
  ];
  const anchoFicha = (ANCHO - 3 * 10) / 4;
  fichas.forEach((f, i) => {
    const x = M + i * (anchoFicha + 10);
    pagina.drawRectangle({ x, y: y - 56, width: anchoFicha, height: 56, borderColor: LINEA, borderWidth: 0.8, color: BLANCO });
    texto(f.titulo, x + 10, y - 16, 7.5, negrita, GRIS);
    texto(f.valor, x + 10, y - 36, 15, negrita, TINTA);
    texto(recorta(f.nota, anchoFicha - 16, 7), x + 10, y - 49, 7, normal, GRIS_CLARO);
  });
  y -= 56 + 22;

  // Lo que pasó, con palabras.
  seccion("Lo que pasó en el mes");
  for (const f of loQuePaso(cns, comp)) vineta(f);
  y -= 6;

  // Cascada, en su propia hoja con el reparto del peso.
  nuevaPagina();
  seccion("De la venta a la utilidad", "Cada barra es dinero real: lo que pagaron los clientes, lo que se quedaron las plataformas, lo que costó el producto y lo que se gastó aparte.");
  const pasos = cascadaDelMes(cns);
  {
    const anchoEtiqueta = 150;
    const anchoValor = 82;
    const anchoBarra = ANCHO - anchoEtiqueta - anchoValor - 10;
    const base = Math.max(...pasos.map((p) => Math.abs(p.monto)), 1);
    const escala = anchoBarra / base;
    let acumulado = 0;
    for (const paso of pasos) {
      asegurar(17);
      const fuerte = paso.tipo !== "resta";
      texto(recorta(paso.concepto, anchoEtiqueta - 6, 8.5, fuerte ? negrita : normal), M, y - 10, 8.5, fuerte ? negrita : normal, TINTA);
      const x0 = M + anchoEtiqueta;
      let desde: number;
      let largo: number;
      let color: RGB;
      if (paso.tipo === "resta") {
        const fin = acumulado + paso.monto;
        desde = Math.min(acumulado, fin);
        largo = Math.abs(paso.monto);
        color = paso.monto > 0 ? VERDE : ROJO;
        acumulado = fin;
      } else {
        acumulado = paso.monto;
        desde = Math.min(0, paso.monto);
        largo = Math.abs(paso.monto);
        color = paso.tipo === "inicio" ? MARINO : paso.tipo === "subtotal" ? ACENTO : paso.monto < 0 ? ROJO : VERDE;
      }
      pagina.drawRectangle({ x: x0 + Math.max(0, desde) * escala, y: y - 12, width: Math.max(1, largo * escala), height: 11, color });
      textoDer(pesosRedondos(paso.monto), M + ANCHO, y - 10, 8.5, fuerte ? negrita : normal, paso.monto < 0 ? ROJO : TINTA);
      y -= 13;
      texto(recorta(paso.nota, anchoEtiqueta + anchoBarra, 6.5), M + 4, y - 5, 6.5, normal, GRIS_CLARO);
      y -= 9;
    }
  }

  // =========================================================================
  // 2. Canales
  // =========================================================================
  y -= 10;
  asegurar(60 + 30 * (canales.length + 1));
  seccion("A dónde se fue cada peso de venta", "Por canal, de cada $100 que pagaron los clientes: cuánto se quedó la plataforma, cuánto costó el producto, la publicidad, los gastos de la plataforma y lo que quedó de utilidad.");
  leyenda(Object.values(DESTINO));
  for (const r of repartoDelPeso(cns)) {
    asegurar(30);
    const anchoEtiqueta = 96;
    const anchoBarra = ANCHO - anchoEtiqueta;
    texto(r.nombre, M, y - 12, 9, negrita, TINTA);
    texto(compacto(r.venta), M, y - 22, 7, normal, GRIS_CLARO);
    let x = M + anchoEtiqueta;
    const partes: [keyof typeof DESTINO, number][] = [
      ["plataforma", r.plataforma],
      ["costo", r.costo],
      ["publicidad", r.publicidad],
      ["gastos", r.gastos],
      ["utilidad", r.utilidad],
    ];
    for (const [clave, frac] of partes) {
      if (frac <= 0) continue;
      const w = frac * anchoBarra;
      pagina.drawRectangle({ x, y: y - 22, width: w, height: 18, color: DESTINO[clave].color });
      const etiqueta = `${Math.round(frac * 100)}`;
      if (w > 18) textoCentro(etiqueta, x + w / 2, y - 16, 8, negrita, clave === "publicidad" || clave === "plataforma" ? TINTA : BLANCO);
      x += w;
    }
    if (r.utilidad < 0) textoDer(`pérdida ${Math.round(-r.utilidad * 100)}`, M + ANCHO, y - 30, 7, negrita, ROJO);
    y -= 30;
  }
  y -= 8;

  nuevaPagina();
  seccion("Utilidad por canal", "Antes de los gastos de la empresa. El porcentaje es el margen sobre la venta del canal.");
  barrasHorizontales(
    canales.map((k) => ({ etiqueta: CANAL_CORTO[k.canal], valor: k.utilidadNeta, color: COLOR_CANAL[k.canal], nota: pct(k.margen) })),
    compacto,
  );

  if (comp) {
    seccion(
      comp.base === "mismos-dias" ? `Contra los mismos días de ${nombreDelPeriodo(comp.periodoAnterior)}` : `Contra ${nombreDelPeriodo(comp.periodoAnterior)}`,
      "Barra clara = mes anterior; barra fuerte = este mes.",
    );
    const renglones = comp.renglones.filter((r) => r.canal !== "total");
    const medio = ANCHO / 2;
    const dibujaGrupo = (x0: number, ancho: number, tituloG: string, sacar: (r: (typeof renglones)[number]) => { actual: number; anterior: number; cambio: number | null }, formato: (x: number) => string) => {
      const max = Math.max(...renglones.flatMap((r) => [Math.abs(sacar(r).actual), Math.abs(sacar(r).anterior)]), 1);
      const anchoEt = 70;
      const anchoB = ancho - anchoEt - 56;
      let yy = y;
      texto(tituloG, x0, yy - 8, 8.5, negrita, TINTA);
      yy -= 16;
      for (const r of renglones) {
        const v = sacar(r);
        texto(recorta(CANAL_CORTO[r.canal as keyof typeof CANAL_CORTO] ?? r.nombre, anchoEt - 4, 7.5), x0, yy - 9, 7.5, normal, TINTA);
        const color = COLOR_CANAL[r.canal] ?? ACENTO;
        pagina.drawRectangle({ x: x0 + anchoEt, y: yy - 6, width: Math.max(1, (Math.max(0, v.anterior) / max) * anchoB), height: 5, color, opacity: 0.3 });
        pagina.drawRectangle({ x: x0 + anchoEt, y: yy - 12, width: Math.max(1, (Math.max(0, v.actual) / max) * anchoB), height: 6, color });
        textoDer(cambioTexto(v.cambio), x0 + ancho, yy - 9, 8, negrita, (v.cambio ?? 0) >= 0 ? VERDE : ROJO);
        texto(formato(v.actual), x0 + anchoEt + 2, yy - 20, 6.5, normal, GRIS_CLARO);
        yy -= 26;
      }
      return yy;
    };
    asegurar(20 + renglones.length * 26);
    const y1 = dibujaGrupo(M, medio - 12, "Unidades", (r) => r.unidades, enteros);
    const y2 = dibujaGrupo(M + medio + 12, medio - 12, "Utilidad", (r) => r.utilidad, compacto);
    y = Math.min(y1, y2) - 6;
  }

  asegurar(40 + 16 * 13 + 30);
  seccion("Detalle por canal");
  {
    const anchoConcepto = 150;
    const anchoCol = (ANCHO - anchoConcepto) / (canales.length + 1);
    const cols: Col[] = [{ t: "", w: anchoConcepto, der: false }, ...canales.map((k) => ({ t: CANAL_CORTO[k.canal], w: anchoCol, der: true })), { t: "Total", w: anchoCol, der: true }];
    cabecera(cols);
    const adsModelo = canales.reduce((a, k) => a + k.adsPorModelo, 0);
    const renglones: [string, (k: (typeof canales)[number]) => number | string, number | string, boolean?][] = [
      ["Unidades", (k) => enteros(k.unidades), enteros(t.unidades)],
      ["Venta bruta", (k) => k.ventaBruta, t.ventaBruta, true],
      ["Comisión", (k) => -k.desglosePlataforma.comision, -t.comision],
      ["Envío y logística", (k) => -k.desglosePlataforma.envio, -t.envio],
      ["Retenciones ISR + IVA", (k) => -(k.desglosePlataforma.isr + k.desglosePlataforma.iva), -(t.isr + t.iva)],
      ["Otros cargos y ajustes", (k) => k.neto - k.ventaBruta + k.desglosePlataforma.comision + k.desglosePlataforma.envio + k.desglosePlataforma.isr + k.desglosePlataforma.iva, t.neto - t.ventaBruta + t.comision + t.envio + t.isr + t.iva],
      ["Neto de plataforma", (k) => k.neto, t.neto, true],
      ["Costo del producto", (k) => -k.costoProducto, -t.costoProducto],
      ["Publicidad por modelo", (k) => -k.adsPorModelo, -adsModelo],
      ["Gastos de plataforma", (k) => -k.gastosGenerales, -t.gastosGenerales],
      ["Utilidad", (k) => k.utilidadNeta, t.utilidadAntesGastosEmpresariales, true],
      ["Margen sobre la venta", (k) => pct(k.margen), pct(t.ventaCubierta ? t.utilidadAntesGastosEmpresariales / t.ventaCubierta : null)],
      ["Utilidad por unidad", (k) => (k.gananciaPorUnidad != null ? pesos(k.gananciaPorUnidad) : "—"), t.unidades ? pesos(t.utilidadAntesGastosEmpresariales / t.unidades) : "—"],
    ];
    for (const [concepto, f, total, fuerte] of renglones) {
      const valores = [concepto, ...canales.map((k) => f(k)), total].map((v) => (typeof v === "number" ? pesosRedondos(v) : v));
      const numeros = [null, ...canales.map((k) => f(k)), total];
      fila(cols, valores, { negrita: fuerte, fondo: fuerte, colores: numeros.map((v) => (typeof v === "number" && v < 0 && concepto === "Utilidad" ? ROJO : undefined)) });
    }
    if (t.gastosEmpresariales) {
      fila(cols, ["Gastos empresariales", ...canales.map(() => ""), pesosRedondos(-t.gastosEmpresariales)]);
      fila(cols, ["Utilidad neta final", ...canales.map(() => ""), pesosRedondos(t.utilidadNeta)], { negrita: true, fondo: true, colorUltima: t.utilidadNeta < 0 ? ROJO : VERDE });
    }
    y -= 4;
    parrafo("Fuente del neto: " + canales.map((k) => `${CANAL_CORTO[k.canal]}, ${k.fuenteNeto}`).join("; ") + ".", 7.5, GRIS);
  }

  // =========================================================================
  // 3. Categorías y modelos
  // =========================================================================
  nuevaPagina();
  const cats = cns.porCategoria.filter((k) => k.ganancia != null).slice(0, 14);
  if (cats.length) {
    seccion("Ganancia por categoría", "Todos los canales sumados. Ganancia = neto − costo − publicidad − su parte de los gastos de plataforma. El porcentaje es el margen sobre la venta.");
    barrasHorizontales(
      [...cats].sort((a, b) => (b.ganancia ?? 0) - (a.ganancia ?? 0)).map((k) => ({ etiqueta: k.categoria, valor: k.ganancia ?? 0, nota: pct(k.importe ? (k.ganancia ?? 0) / k.importe : null) })),
      compacto,
    );
  }

  const { mejores, peores } = modelosDestacados(cns, 20);
  const ganadores = mejores.filter((m) => (m.ganancia ?? 0) > 0);
  if (ganadores.length) {
    seccion(`Los ${ganadores.length} modelos que más dejaron`, "Ganancia del mes sumando todos los canales donde se vendió; a la derecha, la ganancia por unidad.");
    barrasHorizontales(
      ganadores.map((m) => ({ etiqueta: `${m.modelo} · ${enteros(m.unidades)} u`, valor: m.ganancia ?? 0, color: VERDE, nota: m.unidades ? pesosRedondos((m.ganancia ?? 0) / m.unidades) + "/u" : "" })),
      compacto,
    );
  }
  if (peores.length) {
    asegurar(50 + Math.min(peores.length, 12) * 13);
    seccion("Modelos que perdieron dinero", "Lo que pagaron las plataformas no alcanzó para el costo, la publicidad y su parte de los gastos. Revisa precio, publicidad o costo.");
    const cols: Col[] = [
      { t: "Modelo", w: 80, der: false },
      { t: "Categoría", w: 110, der: false },
      { t: "Unidades", w: 50, der: true },
      { t: "Neto", w: 70, der: true },
      { t: "Costo", w: 70, der: true },
      { t: "Publicidad", w: 62, der: true },
      { t: "Ganancia", w: ANCHO - 80 - 110 - 50 - 70 - 70 - 62, der: true },
    ];
    cabecera(cols);
    for (const m of peores) {
      fila(cols, [m.modelo, m.categoria, enteros(m.unidades), pesosRedondos(m.neto), pesosRedondos(m.costo ?? 0), pesosRedondos(m.ads), pesosRedondos(m.ganancia ?? 0)], { colorUltima: ROJO });
    }
    y -= 6;
  }

  asegurar(40 + Math.min(cns.porCategoria.length, 20) * 13);
  seccion("Categorías: detalle");
  {
    const cols: Col[] = [
      { t: "Categoría", w: 104, der: false },
      { t: "Unidades", w: 48, der: true },
      { t: "Venta", w: 70, der: true },
      { t: "Neto", w: 70, der: true },
      { t: "Costo", w: 64, der: true },
      { t: "Publicidad", w: 56, der: true },
      { t: "Gastos", w: 52, der: true },
      { t: "Ganancia", w: ANCHO - 104 - 48 - 70 - 70 - 64 - 56 - 52, der: true },
    ];
    cabecera(cols);
    cns.porCategoria.forEach((k, i) => {
      fila(
        cols,
        [k.categoria, enteros(k.unidades), pesosRedondos(k.importe), pesosRedondos(k.neto), k.costo == null ? "sin costo" : pesosRedondos(k.costo), pesosRedondos(k.ads), pesosRedondos(k.cargoGeneral), k.ganancia == null ? "—" : pesosRedondos(k.ganancia)],
        { fondo: i % 2 === 1, colorUltima: k.ganancia == null ? GRIS : k.ganancia < 0 ? ROJO : VERDE },
      );
    });
  }

  // =========================================================================
  // 4. Qué falta y cómo se calcula
  // =========================================================================
  nuevaPagina();
  seccion("Estado del corte");
  parrafo(`${estado.etiqueta}. ${estado.explicacion}`, 9.5);
  y -= 6;

  const { sinCosto: sinCostoCanal, acciones, pendientes, notas } = avisosParaMostrar(cns);
  if (acciones.length || sinCostoCanal.length) {
    seccion("Qué falta o no cuadra", "Puede mover la utilidad: conviene arreglarlo antes de dar el mes por cerrado.");
    for (const s of sinCostoCanal) {
      vineta(`${s.nombre}: ${enteros(s.unidades)} unidades de ${s.modelos.length} modelo(s) sin costo (${s.modelos.slice(0, 8).join(", ")}${s.modelos.length > 8 ? "…" : ""}). Su neto (${pesos(s.neto)}) entra a la utilidad SIN restarle costo: captúralo en Productos y costos.`, ROJO);
    }
    for (const a of acciones) vineta(`${a.origen}: ${a.texto}`, ROJO);
    y -= 4;
  }
  if (pendientes.length) {
    seccion("Se resuelve solo", "No hay que hacer nada: llega con los días.");
    for (const a of pendientes) vineta(`${a.origen}: ${a.texto}`, AMBAR);
    y -= 4;
  }
  if (notas.length) {
    seccion("Notas", "Cómo se tratan algunos conceptos; no son problemas.");
    for (const a of notas) vineta(`${a.origen}: ${a.texto}`, GRIS_CLARO);
    y -= 4;
  }
  seccion("Cómo se calcula");
  for (const tx of [
    "Venta bruta: lo que pagaron los clientes en los pedidos pagados del mes (hora de México). Las cancelaciones no cuentan; las devoluciones sí vendieron y se restan aparte.",
    "Neto de plataforma: el dinero real. Mercado Libre, orden por orden con el depósito de Mercado Pago; Amazon, la Finances API por fecha de asiento con liquidaciones cuadradas; TikTok, lo que TikTok paga por pedido (liquidado o por liquidar). Nada se estima: la venta sin neto leído queda fuera.",
    "Costo del producto: unidades × costo por modelo de Productos y costos (en pesos, con todo). El costo de un par devuelto en MELI se suma de vuelta solo si volvió a la venta.",
    "Publicidad: se descuenta al modelo que la gastó (Product Ads de MELI, Amazon Ads por SKU). Lo que no se amarra a un modelo va a gastos de plataforma.",
    "Gastos de plataforma: Full, colecta, FBA, cargos sueltos y devoluciones netas. Se reparten entre las unidades vendidas en esa plataforma, así cada modelo y categoría carga su parte.",
    "Gastos empresariales: los que se capturan a mano en el corte (nómina, renta…). Se descuentan una sola vez, al final.",
  ]) {
    vineta(tx, ACENTO);
  }

  // Pie de página.
  paginas.forEach((pg, i) => {
    const s = ansi(`${titulo} · página ${i + 1} de ${paginas.length}`);
    pg.drawText(s, { x: M, y: M - 18, size: 7, font: normal, color: GRIS_CLARO });
    const d = ansi(opts?.preliminar ? "Vista previa" : estado.etiqueta);
    pg.drawText(d, { x: M + ANCHO - normal.widthOfTextAtSize(d, 7), y: M - 18, size: 7, font: normal, color: GRIS_CLARO });
  });

  return doc.save();
}
