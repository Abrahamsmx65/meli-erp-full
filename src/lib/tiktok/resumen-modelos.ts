/**
 * Resumen POR MODELO para el dueño (pedido del 2-oct-2026: «un Excel que
 * tenga el SKU, por ejemplo GT142, el número de ID de publicación de
 * TikTok, el stock que tengo en mi bodega de TikTok, el stock en mi bodega
 * en general entre todas (Industher y EnvioPack), cuántas ventas tengo en
 * Mercado Libre en total de ese producto, el tipo de producto y la foto»).
 *
 * Motor puro: recibe lo ya leído de la base y arma un renglón por modelo.
 * Entran los modelos que están en TikTok (catálogo o kardex) o que tienen
 * pares en alguna bodega de cajas; un modelo que solo vendió en MELI y ya
 * no tiene nada en ningún lado no es un producto que decidir.
 */

import { partirSku } from "./despacho";

export interface SkuTikTokResumen {
  sku: string;
  productId: string | null;
  estado: string | null;
  titulo?: string | null;
}

export interface KardexTikTokResumen {
  sku: string;
  saldo: number;
  apartado: number;
}

export interface ExistenciaResumen {
  almacen: string;
  modelo: string;
  pares: number;
}

export interface VentaMeliResumen {
  sku: string;
  /** pares de toda la historia */
  unidades: number;
  /** órdenes de toda la historia */
  ordenes: number;
  /** pares de los últimos 30 días */
  unidades30: number;
}

export interface EntradaResumenModelos {
  tiktok: SkuTikTokResumen[];
  kardex: KardexTikTokResumen[];
  /** pares disponibles por bodega de cajas (la bodega TikTok NO va aquí) */
  existencias: ExistenciaResumen[];
  ventasMeli: VentaMeliResumen[];
  /** modelo → categoría de Productos y costos */
  categorias: Map<string, string>;
  /** modelo → URL de la foto (TikTok primero, si no Amazon) */
  fotos: Map<string, string>;
}

export interface ProductoTikTokResumen {
  productId: string;
  estado: string | null;
  skus: number;
}

export interface RenglonResumenModelo {
  modelo: string;
  categoria: string | null;
  titulo: string | null;
  foto: string | null;
  /** productos de TikTok que llevan SKUs de este modelo, con su estado */
  productos: ProductoTikTokResumen[];
  /** kardex de la bodega TikTok */
  saldoTikTok: number;
  apartadoTikTok: number;
  disponibleTikTok: number;
  /** pares por bodega de cajas, en el orden de `almacenes` */
  porBodega: Record<string, number>;
  totalBodegas: number;
  ventasMeli: number;
  ordenesMeli: number;
  ventasMeli30: number;
}

export interface ResumenModelos {
  /** bodegas de cajas con pares, en orden fijo (Industher, Caseshop, EnvioPack, las demás) */
  almacenes: string[];
  renglones: RenglonResumenModelo[];
}

const ORDEN_ALMACENES = ["Industher", "Caseshop", "EnvioPack"];

export function modeloDeSku(sku: string): string {
  return partirSku(sku).modelo.trim().toUpperCase();
}

function limpiarModelo(m: string): string {
  return String(m ?? "").trim().toUpperCase();
}

export function armarResumenModelos(e: EntradaResumenModelos): ResumenModelos {
  const filas = new Map<string, RenglonResumenModelo>();
  const fila = (modelo: string): RenglonResumenModelo => {
    let f = filas.get(modelo);
    if (!f) {
      f = {
        modelo,
        categoria: null,
        titulo: null,
        foto: null,
        productos: [],
        saldoTikTok: 0,
        apartadoTikTok: 0,
        disponibleTikTok: 0,
        porBodega: {},
        totalBodegas: 0,
        ventasMeli: 0,
        ordenesMeli: 0,
        ventasMeli30: 0,
      };
      filas.set(modelo, f);
    }
    return f;
  };

  // Catálogo de TikTok: un producto por renglón, con cuántos SKUs del modelo lleva.
  const porProducto = new Map<string, Map<string, ProductoTikTokResumen>>();
  for (const s of e.tiktok) {
    const modelo = modeloDeSku(s.sku);
    if (!modelo || !s.productId) continue;
    const f = fila(modelo);
    if (!f.titulo && s.titulo) f.titulo = s.titulo;
    let m = porProducto.get(modelo);
    if (!m) {
      m = new Map();
      porProducto.set(modelo, m);
    }
    const p = m.get(s.productId) ?? { productId: s.productId, estado: s.estado, skus: 0 };
    p.skus += 1;
    if (s.estado === "ACTIVATE") p.estado = "ACTIVATE";
    m.set(s.productId, p);
  }
  for (const [modelo, m] of porProducto) {
    fila(modelo).productos = [...m.values()].sort((a, b) => rangoEstado(a.estado) - rangoEstado(b.estado) || a.productId.localeCompare(b.productId));
  }

  for (const k of e.kardex) {
    const modelo = modeloDeSku(k.sku);
    if (!modelo) continue;
    const f = fila(modelo);
    f.saldoTikTok += k.saldo;
    f.apartadoTikTok += k.apartado;
  }

  const almacenesVistos = new Set<string>();
  for (const x of e.existencias) {
    const modelo = limpiarModelo(x.modelo);
    if (!modelo || !(x.pares > 0)) continue;
    almacenesVistos.add(x.almacen);
    const f = fila(modelo);
    f.porBodega[x.almacen] = (f.porBodega[x.almacen] ?? 0) + x.pares;
    f.totalBodegas += x.pares;
  }

  // Ventas de MELI solo se CUELGAN de los modelos que ya están: no abren renglón.
  const ventas = new Map<string, { u: number; o: number; u30: number }>();
  for (const v of e.ventasMeli) {
    const modelo = modeloDeSku(v.sku);
    if (!modelo) continue;
    const t = ventas.get(modelo) ?? { u: 0, o: 0, u30: 0 };
    t.u += v.unidades;
    t.o += v.ordenes;
    t.u30 += v.unidades30;
    ventas.set(modelo, t);
  }

  const almacenes = [
    ...ORDEN_ALMACENES.filter((a) => almacenesVistos.has(a)),
    ...[...almacenesVistos].filter((a) => !ORDEN_ALMACENES.includes(a)).sort(),
  ];

  const renglones = [...filas.values()]
    .map((f) => {
      const v = ventas.get(f.modelo);
      f.disponibleTikTok = Math.max(0, f.saldoTikTok - f.apartadoTikTok);
      f.categoria = e.categorias.get(f.modelo) ?? null;
      f.foto = e.fotos.get(f.modelo) ?? null;
      if (v) {
        f.ventasMeli = v.u;
        f.ordenesMeli = v.o;
        f.ventasMeli30 = v.u30;
      }
      return f;
    })
    .sort((a, b) => a.modelo.localeCompare(b.modelo, "es", { numeric: true, sensitivity: "base" }));

  return { almacenes, renglones };
}

/** ACTIVATE primero; lo borrado al final. */
function rangoEstado(estado: string | null): number {
  if (estado === "ACTIVATE") return 0;
  if (estado === "DELETED") return 9;
  return 1;
}

export const NOMBRE_ESTADO_TIKTOK: Record<string, string> = {
  ACTIVATE: "Activo",
  DRAFT: "Borrador",
  SELLER_DEACTIVATED: "Desactivado",
  PLATFORM_DEACTIVATED: "Desactivado por TikTok",
  DELETED: "Borrado",
  PENDING: "En revisión",
  FAILED: "Rechazado",
  FREEZE: "Congelado",
};

export function nombreEstadoTikTok(estado: string | null): string {
  if (!estado) return "";
  return NOMBRE_ESTADO_TIKTOK[estado] ?? estado;
}
