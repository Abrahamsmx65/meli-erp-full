/**
 * Motor puro de la gráfica de venta por día y por hora (sin base ni
 * servidor: lo usa el componente del navegador y lo prueban las pruebas).
 */

export type CanalTiempo = "meli_calzado" | "meli_fundas" | "amazon" | "tiktok";

/** Un día: unidades, órdenes y facturación (venta al precio público). */
export interface DiaVenta {
  f: string;
  u: number;
  o: number;
  i: number;
}

/** Una hora de un día (hora de México, 0–23). */
export interface HoraVenta extends DiaVenta {
  h: number;
}

export interface VentasTiempo {
  canal: CanalTiempo;
  dias: DiaVenta[];
  horas: HoraVenta[];
}

/** Nombre y color de cada canal: el orden y los tonos de la página de inicio. */
export const CANALES_TIEMPO: { canal: CanalTiempo; nombre: string; color: string }[] = [
  { canal: "meli_calzado", nombre: "Calzado · MELI", color: "#a35f1c" },
  { canal: "amazon", nombre: "Amazon", color: "#3a72b8" },
  { canal: "meli_fundas", nombre: "Fundas · MELI", color: "#2f9c63" },
  { canal: "tiktok", nombre: "TikTok", color: "#d3a52e" },
];

export type Medida = "importe" | "unidades";

export interface SerieTiempo extends VentasTiempo {
  nombre: string;
  color: string;
}

/** Un punto de la gráfica: su etiqueta y un valor por canal. */
export interface PuntoTiempo {
  clave: string;
  valores: Record<string, number>;
  /** órdenes de todos los canales en ese punto (para el globo) */
  ordenes: number;
}

const valor = (d: DiaVenta, m: Medida) => (m === "importe" ? d.i : d.u);

function siguiente(f: string): string {
  return new Date(Date.parse(`${f}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** Un punto por día del rango, los días sin venta en cero. */
export function puntosPorDia(series: VentasTiempo[], desde: string, hasta: string, medida: Medida): PuntoTiempo[] {
  const puntos: PuntoTiempo[] = [];
  const indice = new Map<string, PuntoTiempo>();
  for (let f = desde; f <= hasta && puntos.length < 400; f = siguiente(f)) {
    const p = { clave: f, valores: {}, ordenes: 0 };
    puntos.push(p);
    indice.set(f, p);
  }
  for (const s of series) {
    for (const d of s.dias) {
      const p = indice.get(d.f);
      if (!p) continue;
      p.valores[s.canal] = (p.valores[s.canal] ?? 0) + valor(d, medida);
      p.ordenes += d.o;
    }
  }
  return puntos;
}

/**
 * Las 24 horas del día (0 a 23), cada una con lo vendido a esa hora en
 * TODO el rango. Un canal sin horas registradas no aporta nada aquí.
 */
export function puntosPorHora(series: VentasTiempo[], medida: Medida): PuntoTiempo[] {
  const puntos: PuntoTiempo[] = Array.from({ length: 24 }, (_, h) => ({ clave: String(h), valores: {}, ordenes: 0 }));
  for (const s of series) {
    for (const d of s.horas) {
      const p = puntos[d.h];
      if (!p) continue;
      p.valores[s.canal] = (p.valores[s.canal] ?? 0) + valor(d, medida);
      p.ordenes += d.o;
    }
  }
  return puntos;
}

/** Cuántos días del rango traen horas (para el promedio por día de cada hora). */
export function diasConHoras(series: VentasTiempo[]): number {
  const dias = new Set<string>();
  for (const s of series) for (const d of s.horas) dias.add(d.f);
  return dias.size;
}

/** Canales que venden en el rango pero no traen la hora (Amazon antes de guardarla). */
export function canalesSinHora(series: SerieTiempo[]): string[] {
  return series.filter((s) => s.dias.some((d) => d.u > 0) && s.horas.length === 0).map((s) => s.nombre);
}

/** «9 a. m.», «12 p. m.», «0 h» — como se lee la hora en México. */
export function etiquetaHora(h: number): string {
  if (h === 0) return "12 a. m.";
  if (h < 12) return `${h} a. m.`;
  if (h === 12) return "12 p. m.";
  return `${h - 12} p. m.`;
}
