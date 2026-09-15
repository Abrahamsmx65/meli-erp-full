import type { FilaModelo } from "./ventas-monitor";

export type ClaveTablaVentas =
  | "modelo"
  | "categoria"
  | "colores"
  | "unidadesHoy"
  | "unidades7"
  | "unidades7Prev"
  | "cambio"
  | "importe7"
  | "neto7"
  | "publicidad7"
  | "ganancia7";

export const FILAS_POR_PAGINA_VENTAS = 100;

/**
 * Contrato compacto entre el servidor y la tabla cliente. Conserva únicamente
 * los campos que la tabla presenta y evita repetir diez nombres por renglón en
 * el payload RSC.
 */
export type FilaModeloCompacta = readonly [
  modelo: string,
  categoria: string | null,
  colores: number,
  unidadesHoy: number,
  unidades7: number,
  unidades7Prev: number,
  importe7: number,
  neto7: number,
  publicidad7: number | null,
  ganancia7: number | null,
];

export interface TotalesTablaVentas {
  unidades7: number;
  unidades7Prev: number;
  importe7: number;
  neto7: number;
  publicidad7: number;
  conAds: boolean;
  ganancia7: number;
  conCosto: boolean;
}

export interface ConsultaTablaVentas {
  busqueda: string;
  categoria: string;
  orden: { clave: ClaveTablaVentas; desc: boolean };
  pagina: number;
}

/**
 * Respuesta reutilizable de la tabla. `filas` contiene solamente la página
 * pedida; `totales` siempre corresponde al conjunto filtrado completo.
 */
export interface PaginaTablaVentas {
  filas: FilaModeloCompacta[];
  categorias: string[];
  pagina: number;
  paginas: number;
  filasPorPagina: number;
  totalFiltrado: number;
  totalCatalogo: number;
  totales: TotalesTablaVentas;
}

export function compactarFilasModelo(filas: readonly FilaModelo[]): FilaModeloCompacta[] {
  return filas.map((f) => [
    f.modelo,
    f.categoria,
    f.colores,
    f.unidadesHoy,
    f.unidades7,
    f.unidades7Prev,
    f.importe7,
    f.neto7,
    f.publicidad7,
    f.ganancia7,
  ]);
}

export function expandirFilaModelo(f: FilaModeloCompacta): FilaModelo {
  return {
    modelo: f[0],
    categoria: f[1],
    colores: f[2],
    unidadesHoy: f[3],
    unidades7: f[4],
    unidades7Prev: f[5],
    importe7: f[6],
    neto7: f[7],
    publicidad7: f[8],
    ganancia7: f[9],
  };
}

function valor(f: FilaModelo, clave: ClaveTablaVentas): string | number | null {
  if (clave === "cambio") return f.unidades7 - f.unidades7Prev;
  return f[clave];
}

export function prepararFilasTabla(
  filas: readonly FilaModeloCompacta[],
  busqueda: string,
  categoria: string,
  orden: { clave: ClaveTablaVentas; desc: boolean },
): FilaModelo[] {
  const q = busqueda.trim().toUpperCase();
  const lista: FilaModelo[] = [];
  for (const compacta of filas) {
    const f = expandirFilaModelo(compacta);
    if (categoria && (f.categoria ?? "Sin categoría") !== categoria) continue;
    if (q && !f.modelo.toUpperCase().includes(q) && !q.startsWith(f.modelo.toUpperCase() + "-")) continue;
    lista.push(f);
  }

  const dir = orden.desc ? -1 : 1;
  lista.sort((a, b) => {
    const va = valor(a, orden.clave);
    const vb = valor(b, orden.clave);
    if (va == null && vb == null) return a.modelo.localeCompare(b.modelo, "es");
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string" || typeof vb === "string") return dir * String(va).localeCompare(String(vb), "es");
    return dir * (va - vb) || a.modelo.localeCompare(b.modelo, "es");
  });
  return lista;
}

export function totalizarFilasTabla(filas: readonly FilaModelo[]): TotalesTablaVentas {
  const t: TotalesTablaVentas = {
    unidades7: 0,
    unidades7Prev: 0,
    importe7: 0,
    neto7: 0,
    publicidad7: 0,
    conAds: false,
    ganancia7: 0,
    conCosto: false,
  };
  for (const f of filas) {
    t.unidades7 += f.unidades7;
    t.unidades7Prev += f.unidades7Prev;
    t.importe7 += f.importe7;
    t.neto7 += f.neto7;
    if (f.publicidad7 != null) {
      t.publicidad7 += f.publicidad7;
      t.conAds = true;
    }
    if (f.ganancia7 != null) {
      t.ganancia7 += f.ganancia7;
      t.conCosto = true;
    }
  }
  return t;
}

export function paginarFilasTabla(
  filas: readonly FilaModeloCompacta[],
  consulta: ConsultaTablaVentas,
): PaginaTablaVentas {
  const filtradas = prepararFilasTabla(
    filas,
    consulta.busqueda,
    consulta.categoria,
    consulta.orden,
  );
  const paginas = Math.max(1, Math.ceil(filtradas.length / FILAS_POR_PAGINA_VENTAS));
  const paginaPedida = Number.isFinite(consulta.pagina) ? Math.trunc(consulta.pagina) : 1;
  const pagina = Math.min(paginas, Math.max(1, paginaPedida));
  const inicio = (pagina - 1) * FILAS_POR_PAGINA_VENTAS;
  const categorias = [
    ...new Set(filas.map((f) => expandirFilaModelo(f).categoria ?? "Sin categoría")),
  ].sort((a, b) => a.localeCompare(b, "es"));

  return {
    filas: compactarFilasModelo(filtradas.slice(inicio, inicio + FILAS_POR_PAGINA_VENTAS)),
    categorias,
    pagina,
    paginas,
    filasPorPagina: FILAS_POR_PAGINA_VENTAS,
    totalFiltrado: filtradas.length,
    totalCatalogo: filas.length,
    totales: totalizarFilasTabla(filtradas),
  };
}