/**
 * Los dos archivos que se le mandan a la BODEGA cuando viene un contenedor
 * (pedido del dueño, 14-oct-2026: «cada vez, para avisar a la bodega que
 * llega mercancía y lo ingresen al sistema, doy de alta los productos y
 * luego mando un Excel con lo que va a llegar»), calcados de los CSV que el
 * dueño mandaba a mano (S259-PRODUCTOS.csv y PACKING_LIST_S259.csv):
 *
 *   PRODUCTOS: Sku, Nombre, Enviar solo, Categoria, Codigo Fiscal, Valor
 *     reposicion, Barcode Producto, Barcode Paquetes, Atributos y ocho
 *     paquetes (Alto, Ancho, Largo, Peso); solo se llena el Paquete 1.
 *   PACKING LIST: Tipo de contenedor, Numero de contenedor, Sku, Cantidad,
 *     Informacion.
 *
 * El SKU y los dos barcodes son EXACTAMENTE el texto de la etiqueta de caja
 * que sale del ZIP de etiquetas del pedido (BOX LABEL): PEDIDO-MODELO-COLOR
 * para la corrida y PEDIDO-MODELO-COLOR-TALLA para la caja de una talla, sin
 * espacios (`codigoDeCaja`, la misma regla que `textosDeCarton`). Un producto
 * que ya viajó en un contenedor ANTERIOR con el mismo SKU completo ya se dio
 * de alta: no se repite en PRODUCTOS (sí va en el packing list, que es lo que
 * llega). Lo que falte se deja en blanco y se declara en `avisos`: nunca se
 * inventa.
 *
 * Motor puro: la ruta junta los datos y este módulo arma las filas y el CSV.
 */
import { sinAnotacion } from "../etiquetas/resolver";
import { codigoFiscalDeCategoria, CODIGOS_FISCALES, type DatosModelo } from "./packing-list-contenedor";

/** Sin espacios y en mayúsculas, como el texto del BOX LABEL. */
function pegado(s: string): string {
  return s.toUpperCase().replace(/\s+/g, "");
}

/** El texto de la etiqueta de caja: PEDIDO-MODELO-COLOR(-TALLA). */
export function codigoDeCaja(pedido: string, modelo: string, color: string, talla?: string | null): string {
  const base = `${pegado(pedido)}-${pegado(modelo)}-${pegado(sinAnotacion(color ?? ""))}`;
  return talla ? `${base}-${pegado(String(talla))}` : base;
}

/** Categoría en el sistema de la bodega: TODO el calzado es la 32 (dueño, 14-oct-2026). */
export const CATEGORIA_BODEGA = "32";

/** El valor de reposición es el DOBLE del costo (dueño, 14-oct-2026). */
export const FACTOR_VALOR_REPOSICION = 2;

/** Nombre del tipo de calzado por código fiscal, como «PANTUFLAS» del archivo del dueño. */
export const NOMBRES_BODEGA: Record<string, string> = {
  [CODIGOS_FISCALES.botas]: "BOTAS",
  [CODIGOS_FISCALES.zapatos]: "ZAPATOS",
  [CODIGOS_FISCALES.pantuflas]: "PANTUFLAS",
  [CODIGOS_FISCALES.sandalias]: "SANDALIAS",
  [CODIGOS_FISCALES.tenis]: "TENIS",
};

export interface RenglonBodega {
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

export interface ProductoBodega {
  sku: string;
  nombre: string;
  categoria: string;
  codigoFiscal: string;
  /** valor de reposición de UNA caja: el doble del costo por par × pares */
  valor: number | null;
  pares: number;
  largoCm: number | null;
  anchoCm: number | null;
  altoCm: number | null;
  pesoKg: number | null;
}

export interface ArchivosBodega {
  productos: ProductoBodega[];
  /** SKUs que ya viajaron en un contenedor anterior y no se vuelven a dar de alta */
  yaDadosDeAlta: string[];
  packing: { sku: string; cajas: number }[];
  avisos: string[];
}

const natural = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true });

export function armarArchivosBodega(
  renglones: RenglonBodega[],
  modelos: Map<string, DatosModelo>,
  /** SKUs de etiqueta de los contenedores anteriores */
  enviadosAntes: Set<string>,
): ArchivosBodega {
  const porSku = new Map<string, { r: RenglonBodega; cajas: number }>();
  const ordenados = [...renglones]
    .filter((r) => r.cajas > 0)
    .sort((a, b) => natural(a.pedido, b.pedido) || natural(a.modelo, b.modelo) || natural(a.color, b.color) || natural(a.talla, b.talla));
  for (const r of ordenados) {
    const sku = codigoDeCaja(r.pedido, r.modelo, r.color, r.talla);
    const ya = porSku.get(sku);
    if (ya) {
      ya.cajas += r.cajas;
      // Dos renglones con la misma etiqueta: las medidas del primero que las traiga.
      if (ya.r.largoCm == null && r.largoCm != null) ya.r = { ...ya.r, largoCm: r.largoCm, anchoCm: r.anchoCm, altoCm: r.altoCm, pesoKg: r.pesoKg };
    } else {
      porSku.set(sku, { r, cajas: r.cajas });
    }
  }

  const productos: ProductoBodega[] = [];
  const yaDadosDeAlta: string[] = [];
  const sinCosto = new Set<string>();
  const sinCategoria = new Set<string>();
  const sinMedidas: string[] = [];
  for (const [sku, { r }] of porSku) {
    if (enviadosAntes.has(sku)) {
      yaDadosDeAlta.push(sku);
      continue;
    }
    const m = modelos.get(r.modelo) ?? modelos.get(r.modelo.toUpperCase()) ?? null;
    const costo = m?.costoMxn != null && m.costoMxn > 0 ? m.costoMxn : null;
    const valor =
      costo != null && r.paresPorCaja > 0 ? Math.round(costo * FACTOR_VALOR_REPOSICION * r.paresPorCaja * 100) / 100 : null;
    if (valor == null) sinCosto.add(r.modelo);
    const codigoFiscal = codigoFiscalDeCategoria(m?.categoriaMeli) ?? "";
    if (!codigoFiscal) sinCategoria.add(r.modelo);
    if (r.largoCm == null || r.anchoCm == null || r.altoCm == null || r.pesoKg == null) sinMedidas.push(sku);
    productos.push({
      sku,
      nombre: (codigoFiscal && NOMBRES_BODEGA[codigoFiscal]) || "CALZADO",
      categoria: CATEGORIA_BODEGA,
      codigoFiscal,
      valor,
      pares: r.paresPorCaja,
      largoCm: r.largoCm,
      anchoCm: r.anchoCm,
      altoCm: r.altoCm,
      pesoKg: r.pesoKg,
    });
  }

  const avisos: string[] = [];
  const lista = (s: Iterable<string>) => [...s].sort(natural).join(", ");
  if (sinCosto.size) avisos.push(`Sin costo en Productos y costos (Valor reposicion en blanco): ${lista(sinCosto)}.`);
  if (sinCategoria.size) avisos.push(`Sin categoría de MELI reconocida (Codigo Fiscal en blanco y Nombre «CALZADO»): ${lista(sinCategoria)}.`);
  if (sinMedidas.length) avisos.push(`${sinMedidas.length} productos sin medidas o peso de la caja en ningún packing list: ${lista(sinMedidas)}.`);

  return {
    productos,
    yaDadosDeAlta: yaDadosDeAlta.sort(natural),
    packing: [...porSku.entries()].map(([sku, { cajas }]) => ({ sku, cajas })),
    avisos,
  };
}

/** Una celda de CSV: entre comillas solo si trae coma, comilla o salto. */
function celda(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 66 → "66", 8.50 → "8.5": como venían en el archivo del dueño. */
function numero(n: number | null): string {
  return n == null ? "" : String(Math.round(n * 100) / 100);
}

/** «2,456.60», como en el archivo del dueño. */
function dinero(n: number | null): string {
  return n == null ? "" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const csv = (filas: unknown[][]) => filas.map((f) => f.map(celda).join(",")).join("\r\n");

const PAQUETES = 8;

export function csvProductosBodega(productos: ProductoBodega[]): string {
  const encabezado = ["Sku", "Nombre", "Enviar solo", "Categoria", "Codigo Fiscal", "Valor reposicion", "Barcode Producto", "Barcode Paquetes", "Atributos"];
  for (let i = 1; i <= PAQUETES; i++) encabezado.push(`Paquete ${i} - Alto`, `Paquete ${i} - Ancho`, `Paquete ${i} - Largo`, `Paquete ${i} - Peso`);
  const vacios = Array.from({ length: (PAQUETES - 1) * 4 }, () => "");
  return csv([
    encabezado,
    ...productos.map((p) => [
      p.sku,
      p.nombre,
      "SI",
      p.categoria,
      p.codigoFiscal,
      dinero(p.valor),
      p.sku,
      p.sku,
      p.pares || "",
      // El archivo del dueño pone las medidas en el orden del packing list de
      // la fábrica («Means» 0.66 × 0.56 × 0.24 → Alto 66, Ancho 56, Largo 24).
      numero(p.largoCm),
      numero(p.anchoCm),
      numero(p.altoCm),
      numero(p.pesoKg),
      ...vacios,
    ]),
  ]);
}

export function csvPackingBodega(packing: { sku: string; cajas: number }[]): string {
  return csv([
    ["Tipo de contenedor", "Numero de contenedor", "Sku", "Cantidad", "Informacion"],
    ...packing.map((p, i) => ["X", i + 1, p.sku, p.cajas, "CAJA MASTER SELLADA"]),
  ]);
}
