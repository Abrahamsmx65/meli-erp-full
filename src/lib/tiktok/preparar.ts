/**
 * La estación de "Preparar pedido": tres escaneos, en orden, y solo si los
 * tres cuadran el paquete queda preparado.
 *
 *   hoja      → el código del renglón de la lista (TT7-12): dice QUÉ pedido
 *   etiqueta  → el código de la guía (FNSKU del producto): la guía es de ese producto
 *   producto  → la caja del zapato (FNSKU), una vez por par: el físico es el correcto
 *
 * Es una función pura sobre el estado: el navegador le manda cada código y
 * ella dice qué sigue o qué falló. Un código que no cuadra nunca avanza —
 * el error se muestra y se vuelve a intentar en el mismo paso.
 */
import { codigoDeHoja, parsearCodigoDeHoja, type PaqueteNumerado } from "./despacho";

export type Paso = "hoja" | "etiqueta" | "producto" | "listo";

export interface Faltante {
  fnsku: string;
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
}

export function estadoInicial(): EstadoEscaneo {
  return {
    paso: "hoja",
    paquete: null,
    faltantes: [],
    escaneos: [],
    indicacion: "Escanea el código del renglón en la lista de empaque.",
    error: null,
  };
}

function limpiar(codigo: string): string {
  return String(codigo ?? "").trim().toUpperCase();
}

function conError(estado: EstadoEscaneo, error: string): EstadoEscaneo {
  return { ...estado, error };
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

  // Desde cualquier paso, escanear una hoja nueva reinicia sobre ese paquete.
  // Salvo un caso: la etiqueta de un producto SIN FNSKU lleva el código de
  // hoja, así que en el paso "etiqueta" ese mismo código ES la etiqueta.
  const hoja = parsearCodigoDeHoja(codigo);
  const esLaEtiquetaDeHoja =
    hoja !== null &&
    estado.paso === "etiqueta" &&
    estado.paquete?.numero === hoja.numero &&
    !estado.paquete.pares.some((x) => x.fnsku);
  if (hoja && !esLaEtiquetaDeHoja) {
    if (hoja.corte !== corte) {
      return conError(estado, `Ese renglón es del corte #${hoja.corte}, no del #${corte}.`);
    }
    const paquete = paquetes.find((p) => p.numero === hoja.numero);
    if (!paquete) return conError(estado, `No hay renglón #${hoja.numero} en este corte.`);
    if (yaPreparados.has(paquete.numero)) {
      return conError(estado, `El #${paquete.numero} ya está preparado.`);
    }
    const skus = paquete.pares.map((x) => (x.pares > 1 ? `${x.sku} ×${x.pares}` : x.sku)).join(", ");
    return {
      paso: "etiqueta",
      paquete,
      faltantes: [],
      escaneos: [codigo],
      indicacion: `#${paquete.numero}: ${skus}. Ahora escanea la ETIQUETA.`,
      error: null,
    };
  }

  if (estado.paso === "hoja" || !estado.paquete) {
    return conError(estado, "Primero la hoja: ese código no es un renglón de la lista.");
  }

  const p = estado.paquete;
  const fnskus = new Set(p.pares.map((x) => limpiar(x.fnsku ?? "")).filter(Boolean));
  const codigoEtiqueta = fnskus.size ? null : limpiar(codigoDeHoja(corte, p.numero));

  if (estado.paso === "etiqueta") {
    const cuadra = fnskus.has(codigo) || (codigoEtiqueta !== null && codigo === codigoEtiqueta);
    if (!cuadra) {
      return conError(estado, `Esa etiqueta no es del #${p.numero}. Escaneaste "${codigo}".`);
    }
    // Lo que hay que escanear del producto: un FNSKU por par. Un par sin
    // FNSKU conocido no se puede verificar por escáner; se avisa y se da por
    // bueno, antes que bloquear el despacho.
    const faltantes: Faltante[] = p.pares
      .filter((x) => x.fnsku)
      .map((x) => ({ fnsku: limpiar(x.fnsku as string), sku: x.sku, faltan: x.pares }));
    const sinFnsku = p.pares.filter((x) => !x.fnsku).map((x) => x.sku);
    if (!faltantes.length) {
      return {
        paso: "listo",
        paquete: p,
        faltantes: [],
        escaneos: [...estado.escaneos, codigo],
        indicacion: `#${p.numero} listo (sin FNSKU para verificar el producto: ${sinFnsku.join(", ")}).`,
        error: null,
      };
    }
    const total = faltantes.reduce((a, f) => a + f.faltan, 0);
    return {
      paso: "producto",
      paquete: p,
      faltantes,
      escaneos: [...estado.escaneos, codigo],
      indicacion:
        `Etiqueta bien. Ahora escanea el PRODUCTO (${total} ${total === 1 ? "par" : "pares"})` +
        (sinFnsku.length ? ` — sin verificar: ${sinFnsku.join(", ")}` : "") +
        ".",
      error: null,
    };
  }

  if (estado.paso === "producto") {
    const f = estado.faltantes.find((x) => x.fnsku === codigo && x.faltan > 0);
    if (!f) {
      const esperados = estado.faltantes.filter((x) => x.faltan > 0).map((x) => `${x.sku} (${x.fnsku})`);
      return conError(
        estado,
        `Ese producto no va en el #${p.numero}. Escaneaste "${codigo}"; falta: ${esperados.join(", ")}.`,
      );
    }
    const faltantes = estado.faltantes.map((x) => (x === f ? { ...x, faltan: x.faltan - 1 } : x));
    const quedan = faltantes.reduce((a, x) => a + x.faltan, 0);
    const escaneos = [...estado.escaneos, codigo];
    if (quedan > 0) {
      return {
        ...estado,
        faltantes,
        escaneos,
        indicacion: `${f.sku} bien. Faltan ${quedan} ${quedan === 1 ? "par" : "pares"} por escanear.`,
        error: null,
      };
    }
    return {
      paso: "listo",
      paquete: p,
      faltantes,
      escaneos,
      indicacion: `#${p.numero} PREPARADO. Escanea la siguiente hoja.`,
      error: null,
    };
  }

  return conError(estado, "Escanea la siguiente hoja.");
}
