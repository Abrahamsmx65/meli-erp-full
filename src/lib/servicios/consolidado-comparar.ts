/**
 * El mes contra el mes anterior (pedido del dueño, 25-sep-2026: «que en cada
 * mes vea si creció o decreció contra el mes pasado, más que nada en
 * unidades y ganancia»). Motor puro: recibe los dos consolidados ya
 * masticados y devuelve las cifras con su cambio.
 *
 * Un mes EN CURSO no se compara contra uno completo (el 10 del mes siempre
 * «decrecería»): se compara contra LOS MISMOS DÍAS del mes anterior
 * (decisión del dueño, 25-sep-2026), que el fondo calcula aparte. Mientras
 * ese cálculo no exista, queda el RITMO por día como respaldo.
 */
import type { Canal, Consolidado } from "./consolidado";

export interface Comparada {
  actual: number;
  anterior: number;
  /** actual − anterior */
  diferencia: number;
  /** (actual − anterior) ÷ |anterior|; null si el anterior es 0 */
  cambio: number | null;
}

export interface RenglonComparado {
  canal: Canal | "total";
  nombre: string;
  unidades: Comparada;
  utilidad: Comparada;
  ventaBruta: Comparada;
}

export interface ComparacionMensual {
  periodo: string;
  periodoAnterior: string;
  /** días del mes que ya pasaron (el mes completo si ya cerró) */
  diasActual: number;
  diasAnterior: number;
  enCurso: boolean;
  /** contra qué se comparó: el mes anterior completo o sus mismos días */
  base: "mes-completo" | "mismos-dias";
  /** último día del mes anterior que entra en la comparación */
  hastaAnterior: number;
  /** totales: unidades, utilidad antes de gastos empresariales y venta, por canal y total */
  renglones: RenglonComparado[];
  /** la utilidad neta FINAL (después de gastos empresariales) */
  utilidadNeta: Comparada;
  /** lo mismo pero por día: solo tiene sentido con el mes en curso */
  ritmo: { unidades: Comparada; utilidadNeta: Comparada } | null;
}

const r2 = (x: number) => Math.round(x * 100) / 100 || 0;

export function comparar(actual: number, anterior: number): Comparada {
  const a = Number(actual) || 0;
  const b = Number(anterior) || 0;
  return { actual: r2(a), anterior: r2(b), diferencia: r2(a - b), cambio: b === 0 ? null : (a - b) / Math.abs(b) };
}

/** Días de un periodo YYYY-MM. */
export function diasDelPeriodo(periodo: string): number {
  const [y, m] = periodo.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Días transcurridos del periodo a la fecha `hoy` (YYYY-MM-DD, México):
 * el mes completo si ya cerró. El día de hoy va a medias, así que cuenta
 * como transcurrido solo lo que ya pasó (ayer) — mínimo 1.
 */
export function diasTranscurridos(periodo: string, hoy: string): number {
  const total = diasDelPeriodo(periodo);
  if (hoy.slice(0, 7) > periodo) return total;
  if (hoy.slice(0, 7) < periodo) return 0;
  const dia = Number(hoy.slice(8, 10));
  return Math.max(1, Math.min(total, dia - 1));
}

export function compararMeses(actual: Consolidado, anteriorCompleto: Consolidado, hoy: string, mismosDias?: Consolidado | null): ComparacionMensual {
  const diasActual = diasTranscurridos(actual.periodo, hoy);
  const enCurso = diasActual < diasDelPeriodo(actual.periodo);
  const usarMismosDias = enCurso && mismosDias != null;
  const anterior = usarMismosDias ? mismosDias! : anteriorCompleto;
  const diasAnterior = diasDelPeriodo(anteriorCompleto.periodo);
  const hastaAnterior = usarMismosDias ? Number(mismosDias!.hasta.slice(8, 10)) : diasAnterior;

  const previos = new Map(anterior.canales.map((k) => [k.canal, k]));
  const renglones: RenglonComparado[] = actual.canales.map((k) => {
    const p = previos.get(k.canal);
    return {
      canal: k.canal,
      nombre: k.nombre,
      unidades: comparar(k.unidades, p?.unidades ?? 0),
      utilidad: comparar(k.utilidadNeta, p?.utilidadNeta ?? 0),
      ventaBruta: comparar(k.ventaBruta, p?.ventaBruta ?? 0),
    };
  });
  // Un canal que el mes pasado tenía y este no, también se enseña (cayó a 0).
  for (const p of anterior.canales) {
    if (actual.canales.some((k) => k.canal === p.canal)) continue;
    renglones.push({
      canal: p.canal,
      nombre: p.nombre,
      unidades: comparar(0, p.unidades),
      utilidad: comparar(0, p.utilidadNeta),
      ventaBruta: comparar(0, p.ventaBruta),
    });
  }
  const antes = (t: Consolidado["total"]) => t.utilidadAntesGastosEmpresariales ?? t.utilidadNeta;
  renglones.push({
    canal: "total",
    nombre: "Total",
    unidades: comparar(actual.total.unidades, anterior.total.unidades),
    utilidad: comparar(antes(actual.total), antes(anterior.total)),
    ventaBruta: comparar(actual.total.ventaBruta, anterior.total.ventaBruta),
  });

  const porDia = (x: number, dias: number) => (dias > 0 ? x / dias : 0);
  return {
    periodo: actual.periodo,
    periodoAnterior: anterior.periodo,
    diasActual,
    diasAnterior,
    enCurso,
    base: usarMismosDias ? "mismos-dias" : "mes-completo",
    hastaAnterior,
    renglones,
    utilidadNeta: comparar(actual.total.utilidadNeta, anterior.total.utilidadNeta),
    ritmo: enCurso && !usarMismosDias
      ? {
          unidades: comparar(porDia(actual.total.unidades, diasActual), porDia(anterior.total.unidades, diasAnterior)),
          utilidadNeta: comparar(porDia(actual.total.utilidadNeta, diasActual), porDia(anterior.total.utilidadNeta, diasAnterior)),
        }
      : null,
  };
}
