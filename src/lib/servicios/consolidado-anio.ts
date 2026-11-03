/**
 * CÓMO VA EL AÑO del negocio (dueño, 15-oct-2026: «ver cómo va el año en
 * total, mi cuenta es de mayo a abril»).
 *
 * Suma los estados de resultados MENSUALES ya masticados (`consolidado_cache`,
 * los mantiene el cron del corte general cada 10 min) del ejercicio de mayo a
 * abril (`rangoEjercicio` de la Cuenta del año). No recalcula nada: un año es
 * leer doce renglones. Un mes sin estado guardado (antes de enero 2026, o
 * todavía no llega) se enseña como «sin datos» y no suma; el mes en curso
 * va con lo que lleva. Todo en CENTAVOS enteros, como el corte.
 */
import type { Canal, Consolidado } from "./consolidado";

const c = (x: number | null | undefined): number => Math.round((Number(x) || 0) * 100);
const p = (cent: number): number => Math.round(cent) / 100;

/** Los doce periodos YYYY-MM del ejercicio que empieza en mayo de `ejercicio`. */
export function periodosDelEjercicio(ejercicio: number): string[] {
  const lista: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = 5 + i;
    const anio = ejercicio + (m > 12 ? 1 : 0);
    const mes = ((m - 1) % 12) + 1;
    lista.push(`${anio}-${String(mes).padStart(2, "0")}`);
  }
  return lista;
}

export interface CifrasAnio {
  unidades: number;
  ventaBruta: number;
  neto: number;
  costoProducto: number;
  publicidad: number;
  gastosGenerales: number;
  /** utilidad de las plataformas, antes de los gastos del negocio */
  utilidadPlataformas: number;
  gastosEmpresariales: number;
  utilidadNeta: number;
  /** utilidad neta ÷ venta con neto leído (la de los canales calculables) */
  margen: number | null;
}

export interface MesDelAnio extends CifrasAnio {
  periodo: string;
  /** sin estado guardado: no suma */
  sinDatos: boolean;
  /** el mes de hoy: va con lo que lleva */
  enCurso: boolean;
  /** el corte del mes ya es exacto (todo leído y cuadrado) */
  exacto: boolean;
}

export interface CanalDelAnio {
  canal: Canal;
  nombre: string;
  unidades: number;
  ventaBruta: number;
  neto: number;
  costoProducto: number;
  publicidad: number;
  gastosGenerales: number;
  utilidadNeta: number;
  margen: number | null;
  /** meses en que el canal no se pudo calcular (su venta se declara, no suma) */
  mesesSinCalcular: string[];
}

export interface CategoriaDelAnio {
  categoria: string;
  unidades: number;
  importe: number;
  /** null si en ningún mes tuvo ganancia calculable */
  ganancia: number | null;
  /** algún mes la tuvo sin costo (ganancia incompleta) */
  parcial: boolean;
}

export interface ModeloDelAnio {
  modelo: string;
  categoria: string;
  unidades: number;
  importe: number;
  ganancia: number | null;
  parcial: boolean;
}

export interface Anio {
  ejercicio: number;
  meses: MesDelAnio[];
  total: CifrasAnio;
  canales: CanalDelAnio[];
  categorias: CategoriaDelAnio[];
  modelos: ModeloDelAnio[];
  /** meses con datos / meses ya transcurridos del ejercicio */
  mesesConDatos: number;
  mesesTranscurridos: number;
  /** promedio de utilidad neta por mes CERRADO con datos */
  promedioMensual: number | null;
  /** el estado más viejo que entró a la suma */
  generadoEn: string | null;
}

interface Acum {
  unidades: number;
  ventaBruta: number;
  ventaCubierta: number;
  neto: number;
  costoProducto: number;
  publicidad: number;
  gastosGenerales: number;
  utilidadPlataformas: number;
  gastosEmpresariales: number;
  utilidadNeta: number;
}

const acumVacio = (): Acum => ({
  unidades: 0,
  ventaBruta: 0,
  ventaCubierta: 0,
  neto: 0,
  costoProducto: 0,
  publicidad: 0,
  gastosGenerales: 0,
  utilidadPlataformas: 0,
  gastosEmpresariales: 0,
  utilidadNeta: 0,
});

function acumDeMes(cns: Consolidado): Acum {
  const t = cns.total;
  return {
    unidades: Number(t.unidades) || 0,
    ventaBruta: c(t.ventaBruta),
    ventaCubierta: c(t.ventaCubierta ?? t.ventaBruta),
    neto: c(t.neto),
    costoProducto: c(t.costoProducto),
    publicidad: c(t.publicidad),
    gastosGenerales: c(t.gastosGenerales),
    utilidadPlataformas: c(t.utilidadAntesGastosEmpresariales ?? t.utilidadNeta),
    gastosEmpresariales: c(t.gastosEmpresariales),
    utilidadNeta: c(t.utilidadNeta),
  };
}

function sumar(a: Acum, b: Acum): Acum {
  const r = acumVacio();
  for (const k of Object.keys(r) as (keyof Acum)[]) r[k] = a[k] + b[k];
  return r;
}

function cifras(a: Acum): CifrasAnio {
  return {
    unidades: a.unidades,
    ventaBruta: p(a.ventaBruta),
    neto: p(a.neto),
    costoProducto: p(a.costoProducto),
    publicidad: p(a.publicidad),
    gastosGenerales: p(a.gastosGenerales),
    utilidadPlataformas: p(a.utilidadPlataformas),
    gastosEmpresariales: p(a.gastosEmpresariales),
    utilidadNeta: p(a.utilidadNeta),
    margen: a.ventaCubierta > 0 ? a.utilidadNeta / a.ventaCubierta : null,
  };
}

/**
 * Suma el año (pura). `estados` trae un renglón por periodo del ejercicio
 * (null = sin estado guardado); `periodoHoy` es el mes en curso (YYYY-MM).
 */
export function sumarAnio(
  ejercicio: number,
  estados: { periodo: string; cns: Consolidado | null }[],
  periodoHoy: string,
): Anio {
  const porPeriodo = new Map(estados.map((e) => [e.periodo, e.cns]));
  const meses: MesDelAnio[] = [];
  let total = acumVacio();
  let mesesConDatos = 0;
  let mesesTranscurridos = 0;
  let sumaCerrados = 0;
  let cerrados = 0;
  let generadoEn: string | null = null;

  const canales = new Map<Canal, { nombre: string; a: Acum; sinCalcular: string[] }>();
  const categorias = new Map<string, { unidades: number; importe: number; ganancia: number; conGanancia: boolean; parcial: boolean }>();
  const modelos = new Map<string, { categoria: string; unidades: number; importe: number; ganancia: number; conGanancia: boolean; parcial: boolean }>();

  for (const periodo of periodosDelEjercicio(ejercicio)) {
    const cns = porPeriodo.get(periodo) ?? null;
    const futuro = periodo > periodoHoy;
    if (!futuro) mesesTranscurridos++;
    const enCurso = periodo === periodoHoy;
    if (!cns) {
      meses.push({ periodo, sinDatos: true, enCurso, exacto: false, ...cifras(acumVacio()), margen: null });
      continue;
    }
    mesesConDatos++;
    if (!generadoEn || cns.generadoEn < generadoEn) generadoEn = cns.generadoEn;
    const a = acumDeMes(cns);
    total = sumar(total, a);
    if (!enCurso && !futuro) {
      sumaCerrados += a.utilidadNeta;
      cerrados++;
    }
    meses.push({ periodo, sinDatos: false, enCurso, exacto: !!cns.exacto, ...cifras(a) });

    for (const k of cns.canales ?? []) {
      const g = canales.get(k.canal) ?? { nombre: k.nombre, a: acumVacio(), sinCalcular: [] };
      if (k.calculable === false) {
        g.sinCalcular.push(periodo);
      } else {
        g.a = sumar(g.a, {
          unidades: Number(k.unidades) || 0,
          ventaBruta: c(k.ventaBruta),
          ventaCubierta: c(k.ventaCubierta ?? k.ventaBruta),
          neto: c(k.neto),
          costoProducto: c(k.costoProducto),
          publicidad: c(k.publicidad),
          gastosGenerales: c(k.gastosGenerales),
          utilidadPlataformas: c(k.utilidadNeta),
          gastosEmpresariales: 0,
          utilidadNeta: c(k.utilidadNeta),
        });
      }
      canales.set(k.canal, g);
    }

    for (const f of cns.porCategoria ?? []) {
      const g = categorias.get(f.categoria) ?? { unidades: 0, importe: 0, ganancia: 0, conGanancia: false, parcial: false };
      g.unidades += Number(f.unidades) || 0;
      g.importe += c(f.importe);
      if (f.ganancia == null) {
        if ((Number(f.unidades) || 0) > 0) g.parcial = true;
      } else {
        g.ganancia += c(f.ganancia);
        g.conGanancia = true;
      }
      categorias.set(f.categoria, g);
    }

    for (const f of cns.porModelo ?? []) {
      const g = modelos.get(f.modelo) ?? { categoria: f.categoria, unidades: 0, importe: 0, ganancia: 0, conGanancia: false, parcial: false };
      g.unidades += Number(f.unidades) || 0;
      g.importe += c(f.importe);
      if (f.ganancia == null) {
        if ((Number(f.unidades) || 0) > 0) g.parcial = true;
      } else {
        g.ganancia += c(f.ganancia);
        g.conGanancia = true;
      }
      modelos.set(f.modelo, g);
    }
  }

  const listaCanales: CanalDelAnio[] = [...canales.entries()].map(([canal, g]) => {
    const x = cifras(g.a);
    return {
      canal,
      nombre: g.nombre,
      unidades: x.unidades,
      ventaBruta: x.ventaBruta,
      neto: x.neto,
      costoProducto: x.costoProducto,
      publicidad: x.publicidad,
      gastosGenerales: x.gastosGenerales,
      utilidadNeta: x.utilidadNeta,
      margen: x.margen,
      mesesSinCalcular: g.sinCalcular,
    };
  });

  return {
    ejercicio,
    meses,
    total: cifras(total),
    canales: listaCanales.sort((a, b) => b.ventaBruta - a.ventaBruta),
    categorias: [...categorias.entries()]
      .map(([categoria, g]) => ({
        categoria,
        unidades: g.unidades,
        importe: p(g.importe),
        ganancia: g.conGanancia ? p(g.ganancia) : null,
        parcial: g.parcial,
      }))
      .sort((a, b) => b.importe - a.importe),
    modelos: [...modelos.entries()]
      .map(([modelo, g]) => ({
        modelo,
        categoria: g.categoria,
        unidades: g.unidades,
        importe: p(g.importe),
        ganancia: g.conGanancia ? p(g.ganancia) : null,
        parcial: g.parcial,
      }))
      .sort((a, b) => (b.ganancia ?? -Infinity) - (a.ganancia ?? -Infinity)),
    mesesConDatos,
    mesesTranscurridos,
    promedioMensual: cerrados > 0 ? p(sumaCerrados / cerrados) : null,
    generadoEn,
  };
}
