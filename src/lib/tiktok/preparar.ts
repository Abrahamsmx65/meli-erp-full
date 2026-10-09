/**
 * La estación de "Preparar pedido".
 *
 * Se empieza por el PEDIDO (el número de pedido, código de barras del
 * renglón de la hoja: ese paquete exacto) o por la ETIQUETA (FNSKU: el
 * siguiente paquete sin preparar que lleve ese producto). Después se
 * escanea el PRODUCTO, una vez por par: dos pares, dos escaneos. Solo con
 * todo cuadrado queda preparado.
 *
 *   pedido (18 dígitos) → ese paquete exacto, a producto
 *   hoja (TT7-12)       → ese paquete exacto, a producto
 *   etiqueta (FNSKU)    → el siguiente paquete sin preparar que lleve ese producto
 *   producto (FNSKU)    → descuenta un par de lo que falta
 *
 * El código que se imprime es el FNSKU de Amazon, pero la misma caja puede
 * traer pegada la etiqueta de Mercado Envíos Full de cualquiera de las dos
 * cuentas de MELI. Cualquiera de esos códigos vale, siempre que sea de ESE
 * producto: la lista completa viene en `codigos` de cada par.
 *
 * Un par cuyo producto no tiene NINGÚN código conocido no se puede
 * verificar con el escáner: se queda pendiente y solo lo cierra el botón
 * "Dar por bueno sin escanear", que queda registrado como manual.
 *
 * Es una función pura sobre el estado: el navegador le manda cada código y
 * ella dice qué sigue, qué falló y cuántas veces pitar.
 */
import { codigosDeProducto } from "./codigos";
import { codigoDeHoja, parsearCodigoDeHoja, parsearCodigoDeOrden, partirSku, type PaqueteNumerado } from "./despacho";
import { avanceDeLote, detectarLotes, loteDeCodigo, loteDePaquete, type Lote } from "./lotes";

export type Paso = "inicio" | "etiqueta" | "producto" | "listo" | "lote";

export interface Faltante {
  /** FNSKU del producto (el que se imprime); null = Amazon no lo tiene */
  fnsku: string | null;
  /** TODOS los códigos que dan por bueno este par (FNSKU y códigos Full de MELI) */
  codigos: string[];
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
  /**
   * MODO LOTE (8-oct-2026): abierto al escanear el producto de un lote
   * (muchos paquetes iguales de un par). Mientras esté abierto, cada guía
   * escaneada por su código de pedido queda preparada sin volver a escanear
   * la caja: todas las cajas del lote son la misma.
   */
  lote: Lote | null;
}

export function estadoInicial(): EstadoEscaneo {
  return {
    paso: "inicio",
    paquete: null,
    faltantes: [],
    escaneos: [],
    indicacion: "Escanea el pedido en la hoja (o el FNSKU de la etiqueta).",
    error: null,
    pitidos: 0,
    lote: null,
  };
}

function indicacionDeLote(lote: Lote, yaPreparados: Set<number>): string {
  const a = avanceDeLote(lote, yaPreparados);
  return `LOTE ${lote.sku}: ${a.hechos} de ${a.total} listos (#${lote.desde}–#${lote.hasta}). Escanea el código del pedido de cada guía conforme la pegues.`;
}

/** Abrir el lote: la caja ya se escaneó una vez; de aquí en adelante solo guías. */
function abrirLote(lote: Lote, codigo: string, yaPreparados: Set<number>): EstadoEscaneo {
  return {
    paso: "lote",
    paquete: null,
    faltantes: [],
    escaneos: [codigo],
    indicacion: indicacionDeLote(lote, yaPreparados),
    error: null,
    pitidos: 2,
    lote,
  };
}

/** Cerrar el modo lote a propósito (botón de la estación). */
export function salirDeLote(estado: EstadoEscaneo): EstadoEscaneo {
  if (!estado.lote) return estado;
  return { ...estadoInicial(), indicacion: "Saliste del lote. Escanea el pedido en la hoja (o el FNSKU de la etiqueta)." };
}

/**
 * El estado con el que sigue la estación después de GUARDAR un paquete
 * preparado: limpio, pero si había un lote abierto se queda abierto.
 */
export function trasGuardar(siguiente: EstadoEscaneo, indicacion = siguiente.indicacion): EstadoEscaneo {
  if (siguiente.lote) return { ...estadoInicial(), paso: "lote", lote: siguiente.lote, indicacion };
  return { ...estadoInicial(), indicacion };
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
  return p.pares.map((x) => ({
    fnsku: x.fnsku ? limpiar(x.fnsku) : null,
    codigos: codigosDeProducto(x),
    sku: x.sku,
    faltan: x.pares,
  }));
}

/** ¿Este código es de alguno de los productos del paquete? */
function llevaCodigo(p: PaqueteNumerado, codigo: string): boolean {
  return p.pares.some((x) => codigosDeProducto(x).includes(codigo));
}

/** Al identificar el paquete (por etiqueta o por hoja + etiqueta): a escanear producto. */
function aProducto(p: PaqueteNumerado, escaneos: string[]): EstadoEscaneo {
  const faltantes = faltantesDe(p);
  const sinFnsku = faltantes.filter((f) => !f.codigos.length).map((f) => f.sku);
  const total = totalPares(p);
  return {
    paso: "producto",
    paquete: p,
    faltantes,
    escaneos,
    indicacion:
      `#${p.numero}: ${describir(p)}. Escanea el producto (${total} ${total === 1 ? "par" : "pares"})` +
      (sinFnsku.length ? `. Sin código, se cierra con "Dar por bueno": ${sinFnsku.join(", ")}` : "") +
      ".",
    error: null,
    pitidos: Math.max(1, total),
    lote: null,
  };
}

function cerrarSiListo(estado: EstadoEscaneo): EstadoEscaneo {
  const p = estado.paquete as PaqueteNumerado;
  const quedan = estado.faltantes.reduce((a, x) => a + x.faltan, 0);
  if (quedan > 0) {
    const verificables = estado.faltantes.filter((x) => x.faltan > 0 && x.codigos.length);
    const manuales = estado.faltantes.filter((x) => x.faltan > 0 && !x.codigos.length);
    const partes: string[] = [];
    if (verificables.length) {
      const n = verificables.reduce((a, x) => a + x.faltan, 0);
      partes.push(`faltan ${n} ${n === 1 ? "par" : "pares"} por escanear`);
    }
    if (manuales.length) partes.push(`sin código: ${manuales.map((x) => x.sku).join(", ")} (Dar por bueno)`);
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
  lotes?: Lote[],
): EstadoEscaneo {
  const codigo = limpiar(codigoCrudo);
  if (!codigo) return estado;
  const todosLotes = lotes ?? detectarLotes(paquetes);

  // MODO LOTE: con el lote abierto, cada guía (código del pedido o de hoja)
  // de un paquete del lote queda preparada en el acto; la caja ya se
  // escaneó al abrirlo y todas son iguales. Otro producto cierra el lote
  // (y abre el suyo si también es lote); una guía de fuera se rechaza.
  if (estado.lote && (estado.paso === "lote" || estado.paso === "listo")) {
    const lote = estado.lote;
    const ordenL = parsearCodigoDeOrden(codigo);
    const hojaL = parsearCodigoDeHoja(codigo);
    if (ordenL || hojaL) {
      const candidatos = ordenL ? paquetes.filter((x) => x.orderId === ordenL) : paquetes.filter((x) => hojaL && x.numero === hojaL.numero);
      if (!candidatos.length) return conError(estado, ordenL ? `El pedido ${ordenL} no está en este corte.` : `No hay renglón #${hojaL?.numero} en este corte.`);
      const p = candidatos.find((x) => !yaPreparados.has(x.numero)) ?? null;
      if (!p) return conError(estado, `Ese paquete ya está preparado.`);
      if (loteDePaquete(todosLotes, p.numero)?.desde !== lote.desde) {
        return conError(estado, `El #${p.numero} (${describir(p)}) no es del lote ${lote.sku}. Sal del lote para prepararlo.`);
      }
      const a = avanceDeLote(lote, yaPreparados);
      return {
        paso: "listo",
        paquete: p,
        faltantes: [],
        escaneos: [`LOTE:${lote.sku}`, codigo],
        indicacion: `#${p.numero} PREPARADO · lote ${lote.sku}: ${a.hechos + 1} de ${a.total}. Siguiente guía.`,
        error: null,
        pitidos: 1,
        lote,
      };
    }
    if (lote.codigos.includes(codigo)) {
      return { ...estado, paso: "lote", paquete: null, faltantes: [], error: null, pitidos: 1, indicacion: indicacionDeLote(lote, yaPreparados) };
    }
    const otro = loteDeCodigo(todosLotes, codigo, yaPreparados);
    if (otro) return abrirLote(otro, codigo, yaPreparados);
    // Un producto que no es de ningún lote: se cierra el lote y sigue el camino normal.
    return avanzar({ ...estado, lote: null, paso: "inicio", paquete: null }, codigoCrudo, corte, paquetes, yaPreparados, todosLotes);
  }

  // El NÚMERO DE PEDIDO (el código de barras del renglón de la hoja) elige
  // ese paquete exacto y pasa directo a pedir sus productos. Es el camino
  // principal cuando hay muchos paquetes del mismo producto: el que empaca
  // escanea la hoja del pedido que tiene enfrente, y el sistema le pide los
  // FNSKU de ESE pedido, no del "siguiente" que lleve ese producto.
  const orden = parsearCodigoDeOrden(codigo);
  if (orden) {
    const candidatos = paquetes.filter((x) => x.orderId === orden);
    if (!candidatos.length) return conError(estado, `El pedido ${orden} no está en este corte.`);
    const p = candidatos.find((x) => !yaPreparados.has(x.numero));
    if (!p) return conError(estado, `El pedido ${orden} ya está preparado.`);
    return aProducto(p, [codigo]);
  }

  // El código de hoja (TTn-m) hace lo mismo: ese paquete exacto, a producto.
  const hoja = parsearCodigoDeHoja(codigo);
  if (hoja) {
    if (hoja.corte !== corte) return conError(estado, `Ese renglón es del corte #${hoja.corte}, no del #${corte}.`);
    const p = paquetes.find((x) => x.numero === hoja.numero);
    if (!p) return conError(estado, `No hay renglón #${hoja.numero} en este corte.`);
    if (yaPreparados.has(p.numero)) return conError(estado, `El #${p.numero} ya está preparado.`);
    return aProducto(p, [codigo]);
  }

  // Sin paquete elegido: el código es una etiqueta (FNSKU). El paquete es
  // el SIGUIENTE sin preparar que lleve ese producto, en el orden de la pila.
  if (estado.paso === "inicio" || estado.paso === "listo" || !estado.paquete) {
    // Si ese producto tiene un LOTE con paquetes por preparar, se abre el lote.
    const lote = loteDeCodigo(todosLotes, codigo, yaPreparados);
    if (lote) return abrirLote(lote, codigo, yaPreparados);
    const p = paquetes.find((x) => !yaPreparados.has(x.numero) && llevaCodigo(x, codigo));
    if (!p) {
      const alguno = paquetes.some((x) => llevaCodigo(x, codigo));
      return conError(
        estado,
        alguno
          ? `Todos los paquetes con "${codigo}" ya están preparados.`
          : `"${codigo}" no es código de producto, pedido ni renglón de este corte.`,
      );
    }
    return aProducto(p, [codigo]);
  }

  const p = estado.paquete;

  if (estado.paso === "etiqueta") {
    const cuadra = llevaCodigo(p, codigo);
    if (!cuadra) return conError(estado, `Esa etiqueta no es del #${p.numero}. Escaneaste "${codigo}".`);
    return aProducto(p, [...estado.escaneos, codigo]);
  }

  if (estado.paso === "producto") {
    const f = estado.faltantes.find((x) => x.codigos.includes(codigo) && x.faltan > 0);
    if (!f) {
      const esperados = estado.faltantes
        .filter((x) => x.faltan > 0 && x.codigos.length)
        .map((x) => `${x.sku} (${x.codigos.join(" o ")})`);
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
 * verificar (sin ningún código conocido). Lo que sí tiene código sigue
 * exigiendo escáner.
 * Queda registrado como MANUAL en la constancia.
 */
export function darPorBueno(estado: EstadoEscaneo): EstadoEscaneo {
  if (estado.paso !== "producto" || !estado.paquete) return estado;
  const manuales = estado.faltantes.filter((x) => !x.codigos.length && x.faltan > 0);
  if (!manuales.length) return conError(estado, "Todo lo que falta sí tiene código: escanéalo.");
  const faltantes = estado.faltantes.map((x) => (!x.codigos.length ? { ...x, faltan: 0 } : x));
  const escaneos = [...estado.escaneos, ...manuales.map((m) => `MANUAL:${m.sku}×${m.faltan}`)];
  return cerrarSiListo({ ...estado, faltantes, escaneos, pitidos: 1 });
}

// ---------------------------------------------------------------------------
// Lo que dice la bocina
// ---------------------------------------------------------------------------

/** "GT135" → "G T 135": las letras sueltas se leen letra por letra, el número de corrido. */
export function modeloHablado(modelo: string): string {
  return modelo.replace(/([A-Z]+)(\d+)/i, (_m, letras: string, num: string) => `${letras.split("").join(" ")} ${num}`);
}

/**
 * El pedido en voz alta: sus ÚLTIMOS CUATRO dígitos, uno por uno. Leer los
 * 18 completos no lo escucha nadie; con cuatro se coteja contra la guía.
 */
export function pedidoHablado(orderId: string): string {
  const digitos = String(orderId ?? "").replace(/\D/g, "").slice(-4);
  return digitos ? `Pedido ${digitos.split("").join(", ")}` : `Pedido ${orderId}`;
}

/**
 * La frase que se lee en voz alta al identificar el paquete: PRIMERO el
 * pedido (últimos cuatro dígitos) y luego cuántos pares y de qué. Corta,
 * porque el que empaca ya tiene la caja en la mano.
 */
export function fraseParaVoz(p: PaqueteNumerado): string {
  const contenido = p.pares
    .map((x) => {
      const { modelo, color, talla } = partirSku(x.sku);
      const n = x.pares;
      const pedazos = [`${n} ${n === 1 ? "par" : "pares"}`, modeloHablado(modelo)];
      if (color) pedazos.push(color.toLowerCase());
      if (talla) pedazos.push(`talla ${talla}`);
      return pedazos.join(", ");
    })
    .join(". ");
  return `${pedidoHablado(p.orderId)}. ${contenido}`;
}

/** Al cuadrar el último escaneo: "Pedido 1, 4, 3, 3, completado". */
export function fraseDeCompletado(p: PaqueteNumerado): string {
  return `${pedidoHablado(p.orderId)}, completado`;
}
