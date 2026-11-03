/**
 * Almacén TikTok POR FAMILIA (modelo): cuánto hay de cada familia en la
 * bodega de TikTok —saldo, apartado, disponible, lo que TikTok tiene
 * publicado— y cuánto vendió en TikTok, en 30 días y desde que el ERP
 * registra. Puro: la página arma las entradas y aquí solo se suma.
 *
 * Dueño, 20-oct-2026: «quiero uno [por familia] que esté en la sección de
 * inventario TikTok aparte».
 */
import { colorDeSku, familiaDeSku } from "../servicios/familias-existencias";
import { esModeloDeCalzado } from "./publicar";

export interface SkuTikTokParaFamilia {
  sku: string;
  saldo: number;
  apartado: number;
  disponible: number;
  /** lo que TikTok dice tener publicado; null si no se sabe */
  publicado?: number | null;
  /** tiene publicación ACTIVA y está contado: su stock está en línea */
  publicable?: boolean;
}

export interface VentaTikTokPorSku {
  sku: string;
  ventas30: number;
  ventasHist: number;
}

export interface ColorTikTok {
  color: string;
  skus: number;
  saldo: number;
  apartado: number;
  disponible: number;
  /** disponible de SKU sin publicación activa: stock que no está en línea */
  sinLinea: number;
  ventas30: number;
  ventasHist: number;
  diasQueAlcanza: number | null;
}

export interface FamiliaTikTok extends Omit<ColorTikTok, "color"> {
  modelo: string;
  colores: ColorTikTok[];
}

export type OrdenFamiliasTikTok = "disponible-desc" | "disponible-asc" | "ventas30-desc" | "hist-desc" | "alcanza-asc" | "modelo-asc";

function vacio(): Omit<ColorTikTok, "color"> {
  return { skus: 0, saldo: 0, apartado: 0, disponible: 0, sinLinea: 0, ventas30: 0, ventasHist: 0, diasQueAlcanza: null };
}

function alcanza(disponible: number, ventas30: number, dias30: number): number | null {
  const ritmo = ventas30 / dias30;
  return disponible > 0 && ritmo > 0 ? Math.round(disponible / ritmo) : null;
}

/**
 * Junta por familia (y por color adentro). Una familia sale si tiene algo en
 * la bodega o vendió algo alguna vez; lo de David («D-…») y lo que no es
 * calzado quedan fuera.
 */
export function armarFamiliasTikTok({
  renglones,
  ventas = [],
  dias30 = 30,
}: {
  renglones: SkuTikTokParaFamilia[];
  ventas?: VentaTikTokPorSku[];
  dias30?: number;
}): FamiliaTikTok[] {
  type Acum = Omit<ColorTikTok, "color"> & { modelo: string; porColor: Map<string, Omit<ColorTikTok, "color">> };
  const familias = new Map<string, Acum>();
  const nuestro = (sku: string): string | null => {
    if (/^D-/i.test(sku)) return null;
    const m = familiaDeSku(sku);
    return m && esModeloDeCalzado(m) ? m : null;
  };
  const familia = (modelo: string): Acum => {
    let f = familias.get(modelo);
    if (!f) {
      f = { ...vacio(), modelo, porColor: new Map() };
      familias.set(modelo, f);
    }
    return f;
  };
  const color = (f: Acum, c: string | null) => {
    if (!c) return null;
    let x = f.porColor.get(c);
    if (!x) {
      x = vacio();
      f.porColor.set(c, x);
    }
    return x;
  };

  for (const r of renglones) {
    const modelo = nuestro(r.sku);
    if (!modelo) continue;
    const f = familia(modelo);
    const c = color(f, colorDeSku(r.sku));
    const sinLinea = r.publicable === false ? Math.max(0, r.disponible) : 0;
    for (const x of c ? [f, c] : [f]) {
      x.skus += 1;
      x.saldo += r.saldo;
      x.apartado += r.apartado;
      x.disponible += r.disponible;
      x.sinLinea += sinLinea;
    }
  }
  for (const v of ventas) {
    const modelo = nuestro(v.sku);
    if (!modelo) continue;
    const f = familia(modelo);
    const c = color(f, colorDeSku(v.sku));
    for (const x of c ? [f, c] : [f]) {
      x.ventas30 += v.ventas30;
      x.ventasHist += v.ventasHist;
    }
  }

  const salida: FamiliaTikTok[] = [];
  for (const f of familias.values()) {
    const { porColor, ...resto } = f;
    if (resto.saldo === 0 && resto.apartado === 0 && resto.ventasHist === 0 && resto.ventas30 === 0) continue;
    const colores: ColorTikTok[] = [...porColor.entries()]
      .map(([c, x]) => ({ color: c, ...x, diasQueAlcanza: alcanza(x.disponible, x.ventas30, dias30) }))
      .filter((x) => x.saldo !== 0 || x.apartado !== 0 || x.ventasHist !== 0)
      .sort((a, b) => b.disponible - a.disponible || b.ventas30 - a.ventas30 || a.color.localeCompare(b.color, "es"));
    salida.push({ ...resto, colores, diasQueAlcanza: alcanza(resto.disponible, resto.ventas30, dias30) });
  }
  return salida.sort(compararFamiliasTikTok("disponible-desc"));
}

export function compararFamiliasTikTok(orden: OrdenFamiliasTikTok) {
  return (a: FamiliaTikTok, b: FamiliaTikTok): number => {
    switch (orden) {
      case "disponible-asc":
        return a.disponible - b.disponible || a.modelo.localeCompare(b.modelo, "es");
      case "ventas30-desc":
        return b.ventas30 - a.ventas30 || b.disponible - a.disponible || a.modelo.localeCompare(b.modelo, "es");
      case "hist-desc":
        return b.ventasHist - a.ventasHist || b.disponible - a.disponible || a.modelo.localeCompare(b.modelo, "es");
      case "alcanza-asc": {
        const da = a.diasQueAlcanza ?? Number.POSITIVE_INFINITY;
        const db = b.diasQueAlcanza ?? Number.POSITIVE_INFINITY;
        return da - db || b.ventas30 - a.ventas30 || a.modelo.localeCompare(b.modelo, "es");
      }
      case "modelo-asc":
        return a.modelo.localeCompare(b.modelo, "es", { numeric: true });
      default:
        return b.disponible - a.disponible || b.ventas30 - a.ventas30 || a.modelo.localeCompare(b.modelo, "es");
    }
  };
}

/** Filtro por pedazos (modelo o color), sin importar mayúsculas ni guiones. */
export function filtrarFamiliasTikTok(familias: FamiliaTikTok[], busqueda: string): FamiliaTikTok[] {
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
