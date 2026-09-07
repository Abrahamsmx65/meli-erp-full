/**
 * Conteo cíclico del almacén de TikTok.
 *
 * Es el mismo escáner de la estación de preparar, pero contando: cada
 * escaneo del FNSKU (o del SKU tecleado) suma UN par a ese SKU. Al terminar
 * se compara contra el saldo del kardex y la diferencia se guarda como
 * `ajuste` (el conteo siempre gana, `kardex.ts`), con referencia
 * `conteo:<fecha>` para poder rastrearlo y no repetirlo.
 *
 * Lo que se cuenta es lo FÍSICO: los pares apartados (pagados sin
 * despachar) siguen en la bodega, así que se comparan contra el SALDO, no
 * contra el disponible.
 *
 * Se puede contar un modelo COMPLETO: entonces los SKU de ese modelo que no
 * aparecieron en el escáner quedan en cero (así es como se descubre lo que
 * falta). Fuera de esa opción, un SKU que no se escaneó no se toca.
 *
 * Todo puro: el navegador manda códigos y aquí se dice qué pasó.
 */
import { claveAplastada, claveComparacion } from "../importar/sku";
import { partirSku } from "./despacho";
import { modeloHablado } from "./preparar";

export interface ProductoConteo {
  sku: string;
  /** null = no se puede escanear: se captura a mano */
  fnsku: string | null;
  saldo: number;
  apartado: number;
  titulo?: string | null;
}

export interface EstadoConteo {
  /** sku → pares contados */
  contados: Record<string, number>;
  escaneos: string[];
  /** el último SKU que se contó, para decirlo en voz alta */
  ultimo: string | null;
  error: string | null;
}

export interface RenglonConteo {
  sku: string;
  fnsku: string | null;
  saldo: number;
  apartado: number;
  contado: number;
  /** contado - saldo */
  diferencia: number;
  /** true si nunca se escaneó y se está dando por cero (modelo completo) */
  supuestoCero: boolean;
}

export interface AjusteDeConteo {
  sku: string;
  tipo: "ajuste";
  cantidad: number;
  motivo: string;
  referencia: string;
  nota: string;
  fecha: string;
}

export function estadoInicialConteo(): EstadoConteo {
  return { contados: {}, escaneos: [], ultimo: null, error: null };
}

function limpiar(codigo: string): string {
  return String(codigo ?? "").trim().toUpperCase();
}

/**
 * Códigos que reconoce el escáner → SKU: el FNSKU, el SKU tal cual y el
 * SKU canónico o aplastado (por si se teclea con espacios o guiones distintos). Si dos
 * SKU comparten FNSKU se queda el que tiene saldo, que es el que existe.
 */
export function indexarParaConteo(productos: ProductoConteo[]): Map<string, string> {
  const porCodigo = new Map<string, string>();
  const ordenados = [...productos].sort((a, b) => b.saldo - a.saldo);
  for (const p of ordenados) {
    const claves = [limpiar(p.sku), claveComparacion(p.sku).toUpperCase(), claveAplastada(p.sku).toUpperCase()];
    if (p.fnsku) claves.push(limpiar(p.fnsku));
    for (const k of claves) if (k && !porCodigo.has(k)) porCodigo.set(k, p.sku);
  }
  return porCodigo;
}

/** Un escaneo: +1 par al SKU del código. Un código desconocido no cuenta y avisa. */
export function escanearConteo(estado: EstadoConteo, codigoCrudo: string, indice: Map<string, string>): EstadoConteo {
  const codigo = limpiar(codigoCrudo);
  if (!codigo) return estado;
  const sku =
    indice.get(codigo) ??
    indice.get(claveComparacion(codigo).toUpperCase()) ??
    indice.get(claveAplastada(codigo).toUpperCase());
  if (!sku) {
    return { ...estado, error: `"${codigo}" no es FNSKU ni SKU del almacén de TikTok.` };
  }
  return {
    contados: { ...estado.contados, [sku]: (estado.contados[sku] ?? 0) + 1 },
    escaneos: [...estado.escaneos, codigo],
    ultimo: sku,
    error: null,
  };
}

/** Corrige a mano la cantidad de un SKU (un producto sin FNSKU, o un dedazo). */
export function fijarConteo(estado: EstadoConteo, sku: string, cantidad: number): EstadoConteo {
  const n = Math.max(0, Math.round(Number(cantidad) || 0));
  return {
    ...estado,
    contados: { ...estado.contados, [sku]: n },
    escaneos: [...estado.escaneos, `MANUAL:${sku}=${n}`],
    ultimo: sku,
    error: null,
  };
}

/** Los modelos que hay en el almacén, para elegir cuál se cuenta completo. */
export function modelosDeConteo(productos: ProductoConteo[]): string[] {
  const set = new Set<string>();
  for (const p of productos) {
    const { modelo } = partirSku(p.sku);
    if (modelo) set.add(modelo);
  }
  return [...set].sort();
}

function ordenNatural(a: string, b: string): number {
  return a.localeCompare(b, "es", { numeric: true });
}

/**
 * Lo contado contra el kardex. Con `modeloCompleto`, los SKU de ese modelo
 * con saldo que no se escanearon entran con contado 0 y `supuestoCero`.
 */
export function renglonesDeConteo(
  estado: EstadoConteo,
  productos: ProductoConteo[],
  modeloCompleto?: string | null,
): RenglonConteo[] {
  const porSku = new Map(productos.map((p) => [p.sku, p]));
  const renglones: RenglonConteo[] = [];
  const vistos = new Set<string>();

  for (const [sku, contado] of Object.entries(estado.contados)) {
    const p = porSku.get(sku);
    const saldo = p?.saldo ?? 0;
    renglones.push({
      sku,
      fnsku: p?.fnsku ?? null,
      saldo,
      apartado: p?.apartado ?? 0,
      contado,
      diferencia: contado - saldo,
      supuestoCero: false,
    });
    vistos.add(sku);
  }

  if (modeloCompleto) {
    const modelo = modeloCompleto.toUpperCase();
    for (const p of productos) {
      if (vistos.has(p.sku) || partirSku(p.sku).modelo.toUpperCase() !== modelo || p.saldo <= 0) continue;
      renglones.push({
        sku: p.sku,
        fnsku: p.fnsku,
        saldo: p.saldo,
        apartado: p.apartado,
        contado: 0,
        diferencia: -p.saldo,
        supuestoCero: true,
      });
    }
  }

  return renglones.sort((a, b) => ordenNatural(a.sku, b.sku));
}

/**
 * Los ajustes que hay que escribir en el kardex: SOLO donde el conteo no
 * cuadra. Un SKU que cuadra no genera movimiento (sí queda en la
 * constancia de escaneos). Todos comparten la referencia del conteo.
 */
export function ajustesDeConteo(renglones: RenglonConteo[], fecha: string): AjusteDeConteo[] {
  return renglones
    .filter((r) => r.diferencia !== 0)
    .map((r) => ({
      sku: r.sku,
      tipo: "ajuste" as const,
      cantidad: r.contado,
      motivo: "Conteo cíclico",
      referencia: `conteo:${fecha}`,
      nota: r.supuestoCero
        ? `No apareció al contar el modelo completo; el kardex decía ${r.saldo}.`
        : `Contado ${r.contado}, el kardex decía ${r.saldo} (${r.diferencia > 0 ? "+" : ""}${r.diferencia}).`,
      fecha,
    }));
}

/** Lo que dice la bocina al contar: qué es y cuántos van. */
export function fraseDeConteo(sku: string, contado: number): string {
  const { modelo, color, talla } = partirSku(sku);
  const pedazos = [modeloHablado(modelo)];
  if (color) pedazos.push(color.toLowerCase());
  if (talla) pedazos.push(`talla ${talla}`);
  return `${pedazos.join(", ")}: ${contado === 1 ? "va 1" : `van ${contado}`}`;
}
