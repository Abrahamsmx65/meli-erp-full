/**
 * El PACKING LIST de un contenedor para el agente aduanal, en el formato
 * que pide el dueño (18-sep-2026):
 *
 *   LOTE PEDIDO | MODELO | COLOR | SKU | PARES | CAJAS | LARGO | ALTO | ANCHO
 *   | PESO | PRECIO | NOMBRE | CODIGO FISCAL
 *
 * Un renglón por pedido + modelo + color (+ talla si la caja es unitalla).
 * PARES son los de UNA caja; LARGO/ALTO/ANCHO (cm) y PESO (kg) vienen del
 * packing list de la fábrica que se subió al contenedor (`contenedor_lineas`),
 * no de una captura a mano. PRECIO es el VALOR DE LA CAJA: el costo por par
 * de Productos y costos × los pares que trae. NOMBRE es el título de la
 * publicación del modelo y CODIGO FISCAL sale de la categoría de MELI del
 * modelo con la tabla que dio el dueño. Lo que falte (costo, medidas,
 * categoría) se deja en blanco y se declara en `avisos`: nunca se inventa.
 *
 * Motor puro: la ruta junta los datos de la base y este módulo arma las
 * filas y el Excel.
 */
import ExcelJS from "exceljs";

/** Códigos fiscales (fracción del SAT para calzado) que dio el dueño. */
export const CODIGOS_FISCALES = {
  /** botas hombre */
  botas: "53111500",
  /** zapatos en general: alpargatas, mocasines, flats, zapatillas */
  zapatos: "53111600",
  pantuflas: "53111700",
  sandalias: "53111800",
  /** tenis (GT250, por ejemplo) */
  tenis: "53111900",
} as const;

function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

/**
 * El código fiscal según la categoría de MELI del modelo ("Botas y Botines",
 * "Sandalias y Chanclas", "Pantuflas", "Tenis", "Flats", "Zapatillas y
 * Tacones", "Mocasines y Oxfords", "Alpargatas", "Calzado Industrial"…).
 * Una categoría que no se reconoce devuelve null: se declara, no se adivina.
 */
export function codigoFiscalDeCategoria(categoria: string | null | undefined): string | null {
  if (!categoria) return null;
  const c = sinAcentos(categoria);
  if (/BOTA|BOTIN/.test(c)) return CODIGOS_FISCALES.botas;
  if (/PANTUFLA/.test(c)) return CODIGOS_FISCALES.pantuflas;
  if (/SANDALIA|CHANCLA|HUARACHE/.test(c)) return CODIGOS_FISCALES.sandalias;
  if (/TENIS|SNEAKER|DEPORTIV/.test(c)) return CODIGOS_FISCALES.tenis;
  if (/ZAPAT|FLAT|MOCASIN|OXFORD|ALPARGATA|TACON|CALZADO|BALERINA|BAILARINA|ZUECO/.test(c)) return CODIGOS_FISCALES.zapatos;
  return null;
}

export interface RenglonContenedor {
  pedido: string;
  modelo: string;
  color: string;
  /** vacía en las cajas de corrida */
  talla: string;
  paresPorCaja: number;
  cajas: number;
  largoCm: number | null;
  anchoCm: number | null;
  altoCm: number | null;
  pesoKg: number | null;
}

export interface DatosModelo {
  /** título de la publicación en MELI */
  titulo: string | null;
  /** nombre de la categoría de MELI con más publicaciones del modelo */
  categoriaMeli: string | null;
  /** costo por par en MXN (Productos y costos) */
  costoMxn: number | null;
}

export interface FilaPackingContenedor {
  lotePedido: string;
  modelo: string;
  color: string;
  sku: string;
  pares: number;
  cajas: number;
  largoCm: number | null;
  altoCm: number | null;
  anchoCm: number | null;
  pesoKg: number | null;
  /** valor de UNA caja: costo por par × pares */
  precio: number | null;
  nombre: string;
  codigoFiscal: string;
}

export interface PackingContenedor {
  filas: FilaPackingContenedor[];
  totales: { cajas: number; pares: number; valor: number };
  avisos: string[];
}

const natural = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true });

export function armarPackingListContenedor(
  renglones: RenglonContenedor[],
  modelos: Map<string, DatosModelo>,
): PackingContenedor {
  const filas: FilaPackingContenedor[] = [];
  const sinCosto = new Set<string>();
  const sinCategoria = new Set<string>();
  const sinNombre = new Set<string>();
  let sinMedidas = 0;
  let sinPeso = 0;

  const ordenados = [...renglones]
    .filter((r) => r.cajas > 0)
    .sort(
      (a, b) =>
        natural(a.pedido, b.pedido) || natural(a.modelo, b.modelo) || natural(a.color, b.color) || natural(a.talla, b.talla),
    );

  let totalPares = 0;
  let totalValor = 0;
  for (const r of ordenados) {
    const m = modelos.get(r.modelo) ?? modelos.get(r.modelo.toUpperCase()) ?? null;
    const costo = m?.costoMxn != null && m.costoMxn > 0 ? m.costoMxn : null;
    const precio = costo != null && r.paresPorCaja > 0 ? Math.round(costo * r.paresPorCaja * 100) / 100 : null;
    if (precio == null) sinCosto.add(r.modelo);
    const codigoFiscal = codigoFiscalDeCategoria(m?.categoriaMeli) ?? "";
    if (!codigoFiscal) sinCategoria.add(r.modelo);
    if (!m?.titulo) sinNombre.add(r.modelo);
    if (r.largoCm == null || r.anchoCm == null || r.altoCm == null) sinMedidas += 1;
    if (r.pesoKg == null) sinPeso += 1;

    const sku = [r.pedido, r.modelo, r.color, r.talla].filter(Boolean).join("-");
    filas.push({
      lotePedido: r.pedido,
      modelo: r.modelo,
      color: r.color,
      sku,
      pares: r.paresPorCaja,
      cajas: r.cajas,
      largoCm: r.largoCm,
      altoCm: r.altoCm,
      anchoCm: r.anchoCm,
      pesoKg: r.pesoKg,
      precio,
      nombre: m?.titulo ?? "",
      codigoFiscal,
    });
    totalPares += r.paresPorCaja * r.cajas;
    if (precio != null) totalValor += precio * r.cajas;
  }

  const avisos: string[] = [];
  const lista = (s: Set<string>) => [...s].sort(natural).join(", ");
  if (sinCosto.size) {
    avisos.push(`Sin costo en Productos y costos (PRECIO en blanco): ${lista(sinCosto)}.`);
  }
  if (sinMedidas || sinPeso) {
    avisos.push(
      `${Math.max(sinMedidas, sinPeso)} renglones sin medidas o peso de la caja: el contenedor se cargó sin el packing list de la fábrica. Súbelo en Contenedores y vuelve a descargar.`,
    );
  }
  if (sinCategoria.size) {
    avisos.push(`Sin categoría de MELI reconocida (CODIGO FISCAL en blanco): ${lista(sinCategoria)}.`);
  }
  if (sinNombre.size) {
    avisos.push(`Sin publicación en MELI (NOMBRE en blanco): ${lista(sinNombre)}.`);
  }

  return {
    filas,
    totales: {
      cajas: filas.reduce((a, f) => a + f.cajas, 0),
      pares: totalPares,
      valor: Math.round(totalValor * 100) / 100,
    },
    avisos,
  };
}

/** El Excel con el packing list y, si hace falta, una hoja de avisos. */
export async function excelPackingListContenedor(
  numero: string,
  numeroNaviera: string | null,
  packing: PackingContenedor,
): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Packing list");
  hoja.columns = [
    { header: "LOTE PEDIDO", key: "lotePedido", width: 13 },
    { header: "MODELO", key: "modelo", width: 10 },
    { header: "COLOR", key: "color", width: 12 },
    { header: "SKU", key: "sku", width: 26 },
    { header: "PARES", key: "pares", width: 8 },
    { header: "CAJAS", key: "cajas", width: 8 },
    { header: "LARGO", key: "largoCm", width: 8 },
    { header: "ALTO", key: "altoCm", width: 8 },
    { header: "ANCHO", key: "anchoCm", width: 8 },
    { header: "PESO", key: "pesoKg", width: 8 },
    { header: "PRECIO", key: "precio", width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "NOMBRE", key: "nombre", width: 60 },
    { header: "CODIGO FISCAL", key: "codigoFiscal", width: 14 },
  ];
  hoja.getRow(1).font = { bold: true };
  hoja.views = [{ state: "frozen", ySplit: 1 }];

  for (const f of packing.filas) {
    hoja.addRow({
      ...f,
      largoCm: f.largoCm ?? "",
      altoCm: f.altoCm ?? "",
      anchoCm: f.anchoCm ?? "",
      pesoKg: f.pesoKg ?? "",
      precio: f.precio ?? "",
    });
  }
  // El código fiscal es texto: que Excel no lo vuelva número.
  hoja.getColumn("codigoFiscal").numFmt = "@";

  const total = hoja.addRow({ sku: "TOTAL", cajas: packing.totales.cajas });
  total.font = { bold: true };
  const pares = hoja.addRow({ sku: "PARES TOTALES", cajas: packing.totales.pares });
  pares.font = { bold: true };
  const valor = hoja.addRow({ sku: "VALOR TOTAL", precio: packing.totales.valor });
  valor.font = { bold: true };

  const encabezado = `Contenedor ${numero}${numeroNaviera ? ` · ${numeroNaviera}` : ""}`;
  hoja.headerFooter.oddHeader = `&L${encabezado}`;

  if (packing.avisos.length) {
    const av = libro.addWorksheet("Avisos");
    av.columns = [{ header: "Lo que falta para que el packing list esté completo", key: "a", width: 110 }];
    av.getRow(1).font = { bold: true };
    for (const a of packing.avisos) av.addRow({ a });
  }

  return Buffer.from(await libro.xlsx.writeBuffer());
}
