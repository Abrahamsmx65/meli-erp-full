/**
 * Los contenedores PENDIENTES (borrador o en tránsito, todavía no recibidos)
 * en el FORMATO DE INDUSTHER para darlos de alta como BORRADOR de llegada
 * (`GET /api/integracion/contenedores`; dueño, 22-oct-2026: «que también le
 * mande los contenedores pendientes como borradores», «este es el formato
 * que ocupa en su sistema»; calcado de su archivo S260.xlsx):
 *
 *   PARES POR CAJA | Cantidad | NUMERO DE CONTENEDOR | Sku | PRECIO | TITULO
 *
 * Es el mismo armado que «Bodega: productos» (`armarArchivosBodega`): Sku =
 * PEDIDO + SKU de MELI sin -MX (con talla si la caja es de una sola), Cantidad
 * = cajas, PRECIO = el valor de reposición de UNA caja (el doble del costo por
 * par × pares; S260: GT217 24 pares → 2,456.60) y TITULO = el tipo por código
 * fiscal (PANTUFLAS, BOTAS…). Es un aviso de lo que viene, NUNCA existencia:
 * recibir sigue siendo de Industher al contar las cajas.
 */
import type { ArchivosBodega } from "./bodega-contenedor";
import type { TablaIndusther } from "./corridas-integracion";

/** Estados del ERP que todavía no llegan a la bodega. */
export const ESTADOS_PENDIENTES = ["borrador", "en_transito"] as const;

export const COLUMNAS_CONTENEDOR = ["PARES POR CAJA", "Cantidad", "NUMERO DE CONTENEDOR", "Sku", "PRECIO", "TITULO"];

export interface FilaContenedor {
  id: string;
  numero: string;
  numero_naviera: string | null;
  naviera: string | null;
  estado: string;
  fecha_salida: string | null;
  fecha_llegada_est: string | null;
  cajas_bl: number | null;
  otros: unknown;
}

export interface OtroArticulo {
  descripcion: string;
  color: string | null;
  cajas: number;
  piezas: number | null;
}

export interface ContenedorIndusther {
  /** NUESTRO ID sin el año, como en NUMERO DE CONTENEDOR: S271 */
  numero: string;
  /** el ISO de la naviera: MIEU3920536 */
  numeroNaviera: string | null;
  naviera: string | null;
  /** borrador = el ERP aún lo revisa; en_transito = confirmado, viene en camino */
  estadoErp: string;
  fechaSalida: string | null;
  fechaLlegadaEstimada: string | null;
  /** cajas que dice el BL de la naviera (número de control; incluye «otros») */
  cajasBl: number | null;
  cajas: number;
  pares: number;
  /** las filas del archivo de Industher */
  tabla: TablaIndusther;
  /** lo que NO es calzado (bolsas de empaque…): viaja y cuenta contra el BL, no es producto */
  otros: OtroArticulo[];
  avisos: string[];
}

export const numeroSinAnio = (numero: string) => numero.trim().replace(/-\d{4}$/, "");

/** Los renombrados «DUPLICADO S26x-2026» son basura de una limpieza y no viajan. */
export function esContenedorVivo(numero: string): boolean {
  return !/^DUPLICADO/i.test(numero.trim());
}

function otrosDe(crudo: unknown): OtroArticulo[] {
  if (!Array.isArray(crudo)) return [];
  return crudo
    .map((o: any) => ({
      descripcion: String(o?.descripcion ?? "").trim(),
      color: o?.color ? String(o.color) : null,
      cajas: Number(o?.cajas) || 0,
      piezas: o?.piezas == null ? null : Number(o.piezas) || null,
    }))
    .filter((o) => o.cajas > 0 || o.descripcion);
}

/**
 * `armado` sale de `armarArchivosBodega(renglones, modelos, new Set())`: sin
 * quitar lo que viajó antes, así productos y packing son la misma lista en el
 * mismo orden (una entrada por etiqueta de caja).
 */
export function contenedorParaIndusther(c: FilaContenedor, armado: ArchivosBodega): ContenedorIndusther {
  const numero = numeroSinAnio(c.numero);
  const filas = armado.productos.map((p, i) => ({
    "PARES POR CAJA": p.pares,
    Cantidad: armado.packing[i]?.cajas ?? 0,
    "NUMERO DE CONTENEDOR": numero,
    Sku: p.sku,
    PRECIO: p.valor,
    TITULO: p.nombre,
  }));
  return {
    numero,
    numeroNaviera: c.numero_naviera,
    naviera: c.naviera,
    estadoErp: c.estado,
    fechaSalida: c.fecha_salida,
    fechaLlegadaEstimada: c.fecha_llegada_est,
    cajasBl: c.cajas_bl,
    cajas: filas.reduce((s, f) => s + f.Cantidad, 0),
    pares: filas.reduce((s, f) => s + f.Cantidad * f["PARES POR CAJA"], 0),
    tabla: { columnas: COLUMNAS_CONTENEDOR, filas },
    otros: otrosDe(c.otros),
    avisos: armado.avisos.filter((a) => !a.includes("sin medidas")),
  };
}
