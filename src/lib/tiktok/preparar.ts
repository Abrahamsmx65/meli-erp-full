/**
 * La estación de "Preparar pedido".
 *
 * Se puede empezar por la ETIQUETA (lo normal: se toma la guía de arriba
 * de la pila, se escanea, y el sistema dice qué va adentro) o por la HOJA
 * (el renglón de la lista). Después se escanea el PRODUCTO, una vez por
 * par: dos pares, dos escaneos. Solo con todo cuadrado queda preparado.
 *
 *   etiqueta (FNSKU)  → el siguiente paquete sin preparar que lleve ese producto
 *   hoja (TT7-12)     → ese paquete exacto
 *   producto (FNSKU)  → descuenta un par de lo que falta
 *
 * Un par cuyo producto no tiene FNSKU en Amazon no se puede verificar con
 * el escáner: se queda pendiente y solo lo cierra el botón "Dar por bueno
 * sin escanear", que queda registrado como manual.
 *
 * Es una función pura sobre el estado: el navegador le manda cada código y
 * ella dice qué sigue, qué falló y cuántas veces pitar.
 */
import { codigoDeHoja, parsearCodigoDeHoja, type PaqueteNumerado } from "./despacho";

export type Paso = "inicio" | "etiqueta" | "producto" | "listo";

export interface Faltante {
  /** null = no se puede verificar por escáner */
  fnsku: string | null;
  sku: string;
  faltan: number;
}

export interface EstadoEscaneo {
  paso: Paso;
  paquete: PaqueteNumerado | null;
  faltantes: Faltante[];
  escaneos: string[];
  /** qué se espera ahora, en palabras */
  indicacion: string;
  error: string | null;
  /** cuántos pitidos toca dar por este escaneo (1 normal; N = pares del paquete al identificarlo) */
  pitidos: number;
}

export function estadoInicial(): EstadoEscaneo {
  return {
    paso: "inicio",
    paquete: null,
    faltantes: [],
    escaneos: [],
    indicacion: "Escanea la etiqueta (o el renglón de la hoja).",
    error: null,
    pitidos: 0,
  };
}

function limpiar(codigo: string): string {
  return String(codigo ?? "").trim().toUpperCase();
}

function conError(estado: EstadoEscaneo, error: string): EstadoEscaneo {
  return { ...estado, error, pitidos: 0 };
}

function describir(p: PaqueteNumerado): string {
  return p.pares.map((x) => (x.pares > 1 ? `${x.sku} ×${x.pares}` : x.sku)).join(", ");
}

function totalPares(p: PaqueteNumerado): number {
  return p.pares.reduce((a, x) => a + x.pares, 0);
}

function faltantesDe(p: PaqueteNumerado): Faltante[] {
  return p.pares.map((x) => ({ fnsku: x.fnsku ? limpiar(x.fnsku) : null, sku: x.sku, faltan: x.pares }));
}

/** Al identificar el paquete (por etiqueta o por hoja + etiqueta): a escanear producto. */
function aProducto(p: PaqueteNumerado, escaneos: string[]): EstadoEscaneo {
  const faltantes = faltantesDe(p);
  const sinFnsku = faltantes.filter((f) => !f.fnsku).map((f) => f.sku);
  const total = totalPares(p);
  return {
    paso: "producto",
    paquete: p,
    faltantes,
    escaneos,
    indicacion:
      `#${p.numero}: ${describir(p)}. Escanea el producto (${total} ${total === 1 ? "par" : "pares"})` +
      (sinFnsku.length ? `. Sin FNSKU, se cierra con "Dar por bueno": ${sinFnsku.join(", ")}` : "") +
      ".",
    error: null,
    pitidos: Math.max(1, total),
  };
}

function cerrarSiListo(estado: EstadoEscaneo): EstadoEscaneo {
  const p = estado.paquete as PaqueteNumerado;
  const quedan = estado.faltantes.reduce((a, x) => a + x.faltan, 0);
  if (quedan > 0) {
    const verificables = estado.faltantes.filter((x) => x.faltan > 0 && x.fnsku);
    const manuales = estado.faltantes.filter((x) => x.faltan > 0 && !x.fnsku);
    const partes: string[] = [];
    if (verificables.length) {
      const n = verificables.reduce((a, x) => a + x.faltan, 0);
      partes.push(`faltan ${n} ${n === 1 ? "par" : "pares"} por escanear`);
    }
    if (manuales.length) partes.push(`sin FNSKU: ${manuales.map((x) => x.sku).join(", ")} (Dar por bueno)`);
    return { ...estado, indicacion: `#${p.numero}: ${partes.join("; ")}.`, error: null };
  }
  return {
    ...estado,
    paso: "listo",
    indicacion: `#${p.numero} PREPARADO. Escanea la siguiente etiqueta.`,
    error: null,
  };
}

export function avanzar(
  estado: EstadoEscaneo,
  codigoCrudo: string,
  corte: number,
  paquetes: PaqueteNumerado[],
  yaPreparados: Set<number>,
): EstadoEscaneo {
  const codigo = limpiar(codigoCrudo);
  if (!codigo) return estado;

  const hoja = parsearCodigoDeHoja(codigo);

  // La etiqueta de un producto SIN FNSKU lleva el código de hoja: en el paso
  // "etiqueta" ese código ES la etiqueta del paquete ya elegido.
  if (
    hoja &&
    estado.paso === "etiqueta" &&
    estado.paquete?.numero === hoja.numero &&
    !estado.paquete.pares.some((x) => x.fnsku)
  ) {
    return aProducto(estado.paquete, [...estado.escaneos, codigo]);
  }

  // Un renglón de la hoja elige ese paquete exacto, desde cualquier paso.
  if (hoja) {
    if (hoja.corte !== corte) return conError(estado, `Ese renglón es del corte #${hoja.corte}, no del #${corte}.`);
    const p = paquetes.find((x) => x.numero === hoja.numero);
    if (!p) return conError(estado, `No hay renglón #${hoja.numero} en este corte.`);
    if (yaPreparados.has(p.numero)) return conError(estado, `El #${p.numero} ya está preparado.`);
    return {
      paso: "etiqueta",
      paquete: p,
      faltantes: [],
      escaneos: [codigo],
      indicacion: `#${p.numero}: ${describir(p)}. Ahora escanea la ETIQUETA.`,
      error: null,
      pitidos: 1,
    };
  }

  // Sin paquete elegido: el código es una etiqueta (FNSKU). El paquete es
  // el SIGUIENTE sin preparar que lleve ese producto, en el orden de la pila.
  if (estado.paso === "inicio" || estado.paso === "listo" || !estado.paquete) {
    const p = paquetes.find(
      (x) => !yaPreparados.has(x.numero) && x.pares.some((y) => y.fnsku && limpiar(y.fnsku) === codigo),
    );
    if (!p) {
      const alguno = paquetes.some((x) => x.pares.some((y) => y.fnsku && limpiar(y.fnsku) === codigo));
      return conError(
        estado,
        alguno
          ? `Todos los paquetes con "${codigo}" ya están preparados.`
          : `"${codigo}" no es etiqueta ni renglón de este corte.`,
      );
    }
    return aProducto(p, [codigo]);
  }

  const p = estado.paquete;

  if (estado.paso === "etiqueta") {
    const cuadra = p.pares.some((x) => x.fnsku && limpiar(x.fnsku) === codigo);
    if (!cuadra) return conError(estado, `Esa etiqueta no es del #${p.numero}. Escaneaste "${codigo}".`);
    return aProducto(p, [...estado.escaneos, codigo]);
  }

  if (estado.paso === "producto") {
    const f = estado.faltantes.find((x) => x.fnsku === codigo && x.faltan > 0);
    if (!f) {
      const esperados = estado.faltantes
        .filter((x) => x.faltan > 0 && x.fnsku)
        .map((x) => `${x.sku} (${x.fnsku})`);
      return conError(
        estado,
        `Ese producto no va en el #${p.numero}. Escaneaste "${codigo}"` +
          (esperados.length ? `; falta: ${esperados.join(", ")}.` : "."),
      );
    }
    const faltantes = estado.faltantes.map((x) => (x === f ? { ...x, faltan: x.faltan - 1 } : x));
    return cerrarSiListo({ ...estado, faltantes, escaneos: [...estado.escaneos, codigo], pitidos: 1 });
  }

  return conError(estado, "Escanea la siguiente etiqueta.");
}

/**
 * "Dar por bueno sin escanear": cierra SOLO los pares que no se pueden
 * verificar (sin FNSKU). Lo que sí tiene FNSKU sigue exigiendo escáner.
 * Queda registrado como MANUAL en la constancia.
 */
export function darPorBueno(estado: EstadoEscaneo): EstadoEscaneo {
  if (estado.paso !== "producto" || !estado.paquete) return estado;
  const manuales = estado.faltantes.filter((x) => !x.fnsku && x.faltan > 0);
  if (!manuales.length) return conError(estado, "Todo lo que falta sí tiene FNSKU: escanéalo.");
  const faltantes = estado.faltantes.map((x) => (!x.fnsku ? { ...x, faltan: 0 } : x));
  const escaneos = [...estado.escaneos, ...manuales.map((m) => `MANUAL:${m.sku}×${m.faltan}`)];
  return cerrarSiListo({ ...estado, faltantes, escaneos, pitidos: 1 });
}
