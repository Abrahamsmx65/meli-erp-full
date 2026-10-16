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
 * El SKU es el de MERCADO LIBRE (dueño, 16-oct-2026: «los SKUs idénticos a
 * los que vienen en Mercado Libre»): PEDIDO + el SKU de la variante de MELI
 * sin la talla ni el «-MX» (IN10079-GT221-LT BROWN, IN10079-GT221-BLK), con
 * la talla si la caja es de una sola. Los dos BARCODES son la etiqueta de
 * caja que se mandó a China (el color del PEDIDO, IN10079-GT221-BLACK), y
 * como la almacenadora no acepta códigos con espacios, el espacio se vuelve
 * GUION aunque la caja de origen no venga así (IN10079-GT221-LT-BROWN). Un
 * color que no amarra con MELI lleva el color del pedido en el SKU y se
 * avisa. Un producto que ya viajó en un contenedor ANTERIOR (mismo barcode)
 * ya se dio de alta: no se repite en PRODUCTOS (sí va en el packing list,
 * que es lo que llega). Lo que falte se deja en blanco y se declara en
 * `avisos`: nunca se inventa.
 *
 * Motor puro: la ruta junta los datos y este módulo arma las filas y el CSV.
 */
import { sinAnotacion } from "../etiquetas/resolver";
import { codigoFiscalDeCategoria, CODIGOS_FISCALES, type DatosModelo } from "./packing-list-contenedor";

/** Mayúsculas y cada tramo de espacios convertido en UN guion: la almacenadora no acepta espacios. */
function conGuiones(s: string): string {
  return s.toUpperCase().trim().replace(/\s+/g, "-");
}

/** Mayúsculas y espacios sencillos, como los escribe MELI. */
function limpio(s: string): string {
  return s.toUpperCase().replace(/\s+/g, " ").trim();
}

/** El BARCODE de la caja: la etiqueta que se mandó a China, PEDIDO-MODELO-COLOR(-TALLA), sin espacios. */
export function codigoDeCaja(pedido: string, modelo: string, color: string, talla?: string | null): string {
  const base = `${conGuiones(pedido)}-${conGuiones(modelo)}-${conGuiones(sinAnotacion(color ?? ""))}`;
  return talla ? `${base}-${conGuiones(String(talla))}` : base;
}

/**
 * El SKU de la caja como lo escribe MELI: PEDIDO + el SKU de una variante de
 * MELI de ese modelo y color sin el «-MX» ni la talla (la caja de una sola
 * talla se amarró con ESA talla y la conserva). Sin variante en MELI, el
 * color del pedido.
 */
export function skuMeliDeCaja(pedido: string, modelo: string, color: string, talla: string | null | undefined, skuMeli: string | null | undefined): string {
  const t = talla ? String(talla).trim() : "";
  if (skuMeli) {
    let base = limpio(skuMeli).replace(/-(MX|ME|MEX)$/, "");
    if (!t) base = base.replace(/-[^-]+$/, "");
    return `${limpio(pedido)}-${base}`;
  }
  const base = `${limpio(pedido)}-${limpio(modelo)}-${limpio(sinAnotacion(color ?? ""))}`;
  return t ? `${base}-${limpio(t)}` : base;
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
  /** el SKU de MELI de una variante de ese modelo y color (de la talla de la caja si es unitalla) */
  skuMeli?: string | null;
}

export interface ProductoBodega {
  /** el SKU como lo escribe MELI */
  sku: string;
  /** la etiqueta de caja que se mandó a China, sin espacios */
  barcode: string;
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
  /** barcodes que ya viajaron en un contenedor anterior y no se vuelven a dar de alta */
  yaDadosDeAlta: string[];
  packing: { sku: string; cajas: number }[];
  avisos: string[];
}

const natural = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true });

export function armarArchivosBodega(
  renglones: RenglonBodega[],
  modelos: Map<string, DatosModelo>,
  /** barcodes (etiqueta de caja) de los contenedores anteriores */
  enviadosAntes: Set<string>,
): ArchivosBodega {
  const porSku = new Map<string, { r: RenglonBodega; cajas: number; sku: string }>();
  const ordenados = [...renglones]
    .filter((r) => r.cajas > 0)
    .sort((a, b) => natural(a.pedido, b.pedido) || natural(a.modelo, b.modelo) || natural(a.color, b.color) || natural(a.talla, b.talla));
  for (const r of ordenados) {
    const barcode = codigoDeCaja(r.pedido, r.modelo, r.color, r.talla);
    const ya = porSku.get(barcode);
    if (ya) {
      ya.cajas += r.cajas;
      // Dos renglones con la misma etiqueta: las medidas del primero que las traiga.
      if (ya.r.largoCm == null && r.largoCm != null) ya.r = { ...ya.r, largoCm: r.largoCm, anchoCm: r.anchoCm, altoCm: r.altoCm, pesoKg: r.pesoKg };
      if (!ya.r.skuMeli && r.skuMeli) {
        ya.r = { ...ya.r, skuMeli: r.skuMeli };
        ya.sku = skuMeliDeCaja(r.pedido, r.modelo, r.color, r.talla, r.skuMeli);
      }
    } else {
      porSku.set(barcode, { r, cajas: r.cajas, sku: skuMeliDeCaja(r.pedido, r.modelo, r.color, r.talla, r.skuMeli) });
    }
  }

  const productos: ProductoBodega[] = [];
  const yaDadosDeAlta: string[] = [];
  const sinCosto = new Set<string>();
  const sinCategoria = new Set<string>();
  const sinMedidas: string[] = [];
  const sinMeli = new Set<string>();
  for (const [barcode, { r, sku }] of porSku) {
    if (!r.skuMeli) sinMeli.add(`${r.modelo} ${sinAnotacion(r.color)}`);
    if (enviadosAntes.has(barcode)) {
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
      barcode,
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
  if (sinMeli.size) avisos.push(`Sin variante en Mercado Libre (el SKU lleva el color del pedido): ${lista(sinMeli)}.`);
  if (sinMedidas.length) avisos.push(`${sinMedidas.length} productos sin medidas o peso de la caja en ningún packing list: ${lista(sinMedidas)}.`);

  return {
    productos,
    yaDadosDeAlta: yaDadosDeAlta.sort(natural),
    packing: [...porSku.values()].map(({ sku, cajas }) => ({ sku, cajas })),
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
      p.barcode,
      p.barcode,
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
