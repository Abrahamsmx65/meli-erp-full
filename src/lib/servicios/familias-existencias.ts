/**
 * Existencias POR FAMILIA (modelo): cuánto hay de cada familia en cada lugar
 * —bodega, barco, fábrica, Full, FBA y TikTok— y cuánto ha vendido, en 30
 * días y desde que el ERP registra, por canal. Puro y sin dependencias del
 * servidor: la página arma las entradas y este módulo solo suma.
 *
 * Pedido del dueño, 20-oct-2026: «en la sección de inventario una lista que
 * no sea por SKU sino por familia con sus totales de stock, y que tenga ahí
 * las ventas que ha tenido el producto».
 */
import { desglosarSku } from "./sync";
import { modeloUnificado } from "./costos-unificados";
import { esModeloDeCalzado } from "../tiktok/publicar";

/** Un SKU con lo que hay de él en cada lugar. Los pares pueden venir en fracción (barco repartido). */
export interface SkuExistencias {
  sku: string;
  /** modelo según el catálogo; si falta, se saca del SKU */
  modelo?: string | null;
  /** color según el catálogo; si falta, se saca del SKU */
  color?: string | null;
  enBodega?: number;
  enBarco?: number;
  enFabrica?: number;
  enFull?: number;
  enFba?: number;
  enTikTok?: number;
}

/** [canal, sku, unidades, importe] tal como contesta `inicio_ventas_skus`. */
export type FilaVentaSku = [canal: string, sku: string, unidades: number, importe: number];

export interface VentasPorCanal {
  meli: number;
  amazon: number;
  tiktok: number;
  total: number;
}

export interface ColorDeFamilia {
  color: string;
  enBodega: number;
  enBarco: number;
  enFabrica: number;
  enFull: number;
  enFba: number;
  enTikTok: number;
  /** bodega + barco + Full + FBA + TikTok (sin fábrica) */
  total: number;
  ventas30: VentasPorCanal;
  ventasHist: VentasPorCanal;
}

export interface FamiliaExistencias {
  modelo: string;
  /** cajas en bodega, contadas una sola vez */
  cajas: number;
  colores: ColorDeFamilia[];
  enBodega: number;
  enBarco: number;
  enFabrica: number;
  enFull: number;
  enFba: number;
  enTikTok: number;
  /** bodega + barco + Full + FBA + TikTok (sin fábrica) */
  total: number;
  ventas30: VentasPorCanal;
  ventasHist: VentasPorCanal;
  /** cuántos días alcanza el total con la venta de 30 días; null sin venta o sin stock */
  diasQueAlcanza: number | null;
}

const ventasVacias = (): VentasPorCanal => ({ meli: 0, amazon: 0, tiktok: 0, total: 0 });

function canalDe(c: string): keyof Omit<VentasPorCanal, "total"> | null {
  if (c === "meli_calzado") return "meli";
  if (c === "amazon") return "amazon";
  if (c === "tiktok") return "tiktok";
  return null;
}

/** La familia a la que pertenece un SKU: el modelo del SKU en mayúsculas. */
export function familiaDeSku(sku: string, modelo?: string | null): string | null {
  const m = (modeloUnificado(sku) || modelo || "").trim().toUpperCase();
  return m || null;
}

const ES_TALLA = /^\d{1,2}(\.\d)?$/;

/**
 * El color del SKU para el desglose. Amazon a veces pone la talla antes del
 * color (GT128-23-BLK-MX): la talla que queda al frente se quita y el color
 * es lo que sigue. Si no queda nada que no parezca talla, el par cuenta en
 * la familia pero no en ningún color.
 */
export function colorDeSku(sku: string, color?: string | null): string | null {
  const crudo = (color ?? desglosarSku(sku).color ?? "").trim().toUpperCase();
  if (!crudo) return null;
  const partes = crudo.split("-").map((p) => p.trim()).filter(Boolean);
  while (partes.length && ES_TALLA.test(partes[0])) partes.shift();
  while (partes.length && ES_TALLA.test(partes[partes.length - 1])) partes.pop();
  return partes.length ? partes.join("-") : null;
}

const redondear = (x: number) => Math.round(x);

function sumarVentas(destino: VentasPorCanal, canal: keyof Omit<VentasPorCanal, "total">, u: number) {
  destino[canal] += u;
  destino.total += u;
}

/**
 * Junta por familia (y por color adentro) lo que hay y lo que se vendió.
 * Una familia sale si tiene algo en algún lado o vendió algo alguna vez;
 * los SKU de David («D-…») y lo que no es calzado se quedan fuera.
 */
export function armarFamiliasExistencias({
  skus,
  cajasPorModelo = {},
  ventas30 = [],
  ventasHist = [],
  dias30 = 30,
}: {
  skus: SkuExistencias[];
  cajasPorModelo?: Record<string, number>;
  ventas30?: FilaVentaSku[];
  ventasHist?: FilaVentaSku[];
  dias30?: number;
}): FamiliaExistencias[] {
  const familias = new Map<string, FamiliaExistencias & { porColor: Map<string, ColorDeFamilia> }>();

  const familia = (modelo: string) => {
    let f = familias.get(modelo);
    if (!f) {
      f = {
        modelo,
        cajas: 0,
        colores: [],
        porColor: new Map(),
        enBodega: 0,
        enBarco: 0,
        enFabrica: 0,
        enFull: 0,
        enFba: 0,
        enTikTok: 0,
        total: 0,
        ventas30: ventasVacias(),
        ventasHist: ventasVacias(),
        diasQueAlcanza: null,
      };
      familias.set(modelo, f);
    }
    return f;
  };
  const colorDe = (f: ReturnType<typeof familia>, color: string) => {
    let c = f.porColor.get(color);
    if (!c) {
      c = { color, enBodega: 0, enBarco: 0, enFabrica: 0, enFull: 0, enFba: 0, enTikTok: 0, total: 0, ventas30: ventasVacias(), ventasHist: ventasVacias() };
      f.porColor.set(color, c);
    }
    return c;
  };
  const esNuestro = (sku: string, modelo: string | null): modelo is string =>
    !!modelo && !/^D-/i.test(sku) && esModeloDeCalzado(modelo);

  for (const s of skus) {
    const modelo = familiaDeSku(s.sku, s.modelo);
    if (!esNuestro(s.sku, modelo)) continue;
    const f = familia(modelo);
    const lugares = [
      ["enBodega", s.enBodega],
      ["enBarco", s.enBarco],
      ["enFabrica", s.enFabrica],
      ["enFull", s.enFull],
      ["enFba", s.enFba],
      ["enTikTok", s.enTikTok],
    ] as const;
    const color = colorDeSku(s.sku, s.color);
    const c = color ? colorDe(f, color) : null;
    for (const [lugar, n] of lugares) {
      const v = Math.max(0, Number(n ?? 0));
      if (!v) continue;
      f[lugar] += v;
      if (c) c[lugar] += v;
    }
  }

  const sumar = (filas: FilaVentaSku[], campo: "ventas30" | "ventasHist") => {
    for (const [canalCrudo, sku, u] of filas) {
      const canal = canalDe(canalCrudo);
      const unidades = Number(u) || 0;
      if (!canal || !unidades) continue;
      const modelo = familiaDeSku(sku);
      if (!esNuestro(sku, modelo)) continue;
      const f = familia(modelo);
      sumarVentas(f[campo], canal, unidades);
      const color = colorDeSku(sku);
      if (color) sumarVentas(colorDe(f, color)[campo], canal, unidades);
    }
  };
  sumar(ventas30, "ventas30");
  sumar(ventasHist, "ventasHist");

  const salida: FamiliaExistencias[] = [];
  for (const f of familias.values()) {
    const { porColor, ...resto } = f;
    const cerrar = <T extends Omit<ColorDeFamilia, "color" | "total">>(x: T) => {
      x.enBodega = redondear(x.enBodega);
      x.enBarco = redondear(x.enBarco);
      x.enFabrica = redondear(x.enFabrica);
      x.enFull = redondear(x.enFull);
      x.enFba = redondear(x.enFba);
      x.enTikTok = redondear(x.enTikTok);
      return x.enBodega + x.enBarco + x.enFull + x.enFba + x.enTikTok;
    };
    const colores = [...porColor.values()]
      .map((c) => ({ ...c, total: cerrar(c) }))
      .filter((c) => c.total > 0 || c.enFabrica > 0 || c.ventasHist.total > 0 || c.ventas30.total > 0)
      .sort((a, b) => b.total - a.total || b.ventas30.total - a.ventas30.total || a.color.localeCompare(b.color, "es"));
    const total = cerrar(resto);
    if (total <= 0 && resto.enFabrica <= 0 && resto.ventasHist.total <= 0 && resto.ventas30.total <= 0) continue;
    const ritmo = resto.ventas30.total / dias30;
    salida.push({
      ...resto,
      cajas: cajasPorModelo[f.modelo] ?? cajasPorModelo[f.modelo.toLowerCase()] ?? 0,
      colores,
      total,
      diasQueAlcanza: total > 0 && ritmo > 0 ? Math.round(total / ritmo) : null,
    });
  }
  return salida.sort((a, b) => b.total - a.total || b.ventas30.total - a.ventas30.total || a.modelo.localeCompare(b.modelo, "es"));
}

/** Cómo se ordena la tabla en la pantalla; vive aquí para probarlo. */
export type OrdenFamilias = "total-desc" | "total-asc" | "ventas30-desc" | "hist-desc" | "alcanza-asc" | "modelo-asc";

export function compararFamilias(orden: OrdenFamilias) {
  return (a: FamiliaExistencias, b: FamiliaExistencias): number => {
    switch (orden) {
      case "total-asc":
        return a.total - b.total || a.modelo.localeCompare(b.modelo, "es");
      case "ventas30-desc":
        return b.ventas30.total - a.ventas30.total || b.total - a.total || a.modelo.localeCompare(b.modelo, "es");
      case "hist-desc":
        return b.ventasHist.total - a.ventasHist.total || b.total - a.total || a.modelo.localeCompare(b.modelo, "es");
      case "alcanza-asc": {
        // Lo que se acaba primero arriba; sin venta (null) hasta el final.
        const da = a.diasQueAlcanza ?? Number.POSITIVE_INFINITY;
        const db = b.diasQueAlcanza ?? Number.POSITIVE_INFINITY;
        return da - db || b.ventas30.total - a.ventas30.total || a.modelo.localeCompare(b.modelo, "es");
      }
      case "modelo-asc":
        return a.modelo.localeCompare(b.modelo, "es", { numeric: true });
      default:
        return b.total - a.total || b.ventas30.total - a.ventas30.total || a.modelo.localeCompare(b.modelo, "es");
    }
  };
}

/** Filtro por pedazos (modelo o color), sin importar mayúsculas ni guiones. */
export function filtrarFamilias(familias: FamiliaExistencias[], busqueda: string): FamiliaExistencias[] {
  const partes = busqueda
    .toUpperCase()
    .split(/[\s,]+/)
    .map((p) => p.replace(/[-_]/g, " ").trim())
    .filter(Boolean);
  if (!partes.length) return familias;
  return familias.filter((f) => {
    const texto = [f.modelo, ...f.colores.map((c) => c.color)].join(" ").toUpperCase().replace(/[-_]/g, " ");
    return partes.every((p) => texto.includes(p));
  });
}
