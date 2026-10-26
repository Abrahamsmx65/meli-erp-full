/**
 * La LISTA que el dueño le manda a la fábrica, pegada tal cual (pedido del
 * dueño, 11-oct-2026: «yo quiero mandarte una lista así y que se haga solo
 * todo»):
 *
 *   GT179 CTNS OF 12        <- modelo y pares por caja
 *   BROWN                   <- color
 *   26  22                  <- talla y CAJAS de esa sola talla
 *   27  26
 *
 *   GT181 BLK               <- modelo y color en la misma línea
 *   CTNS OF 12
 *   25  12
 *
 * También entiende cajas de CORRIDA:
 *
 *   GT144 BLK CTNS OF 48
 *   23 24 25 26 27          <- las tallas de la corrida
 *   5 10 11 12 10 X 20      <- pares por talla en UNA caja y 20 cajas
 *   23:5 24:10 25:11 X 20   <- o talla:pares en una sola línea
 *   MISMA CORRIDA X 20      <- la corrida del último pedido de ese color
 *
 *   GT252                   <- o el surtido debajo del color (Wenzhou
 *   BROWN 50 CTNS           <- Baike, 20-oct-2026): color y CAJAS,
 *   ASSORTMENT              <- «ASSORTMENT» = cada caja es una corrida
 *   23 3                    <- y cada línea talla y PARES por caja
 *   24 8                       (la caja lleva la suma: 24 pares)
 *
 * Motor puro: solo lee el texto. Lo que no trae la lista (fábrica, precio,
 * pares por caja que no se escribieron, la corrida «misma») lo llena el
 * servicio con la historia de pedidos; aquí queda en null.
 */
import { normalizarTalla } from "../importar/sku";

export interface RenglonLista {
  /** talla de la caja unitalla; null = caja de corrida */
  unitalla: string | null;
  cajas: number;
  /** pares por caja; null = no se escribió */
  paresPorCaja: number | null;
  /** corrida por caja (talla -> pares); null en unitalla o «misma corrida» */
  corrida: Record<string, number> | null;
  /** «misma corrida»: se toma la del último pedido de ese modelo y color */
  mismaCorrida?: boolean;
  /** la línea del texto, para enseñar de dónde salió */
  linea: string;
}

export interface ColorLista {
  color: string;
  renglones: RenglonLista[];
  /** la lista lo trae como «NEW COLOR»: no existe todavía en MELI */
  nuevo?: boolean;
}

export interface ModeloLista {
  modelo: string;
  colores: ColorLista[];
  /** el pedazo del texto de este modelo, tal cual */
  texto: string;
  avisos: string[];
}

export interface ListaLeida {
  modelos: ModeloLista[];
  /** líneas que no se entendieron (con su número de línea) */
  sinEntender: string[];
}

const RE_MODELO = /^([A-Z]{1,4}\d{2,5}(?:-\d{1,2})?[A-Z]?)(?=\s|$|[,:;(])(.*)$/;
const RE_POR_CAJA = [
  /\b(?:CTNS?|CARTONS?|CAJAS?|BOX(?:ES)?)\s*(?:OF|DE|CON|X)\s*(\d{1,3})\b(?:\s*(?:PRS|PARES|PAIRS))?/,
  /\b(\d{1,3})\s*(?:PRS|PARES|PAIRS|PR)\s*(?:\/|POR|PER|X)\s*(?:CTNS?|CAJAS?|CARTONS?|BOX)\b/,
  /\b(?:PER\s*CTN|PRS\s*\/\s*CTN|PARES\s*POR\s*CAJA)\s*[:=]?\s*(\d{1,3})\b/,
  // «SOLID SIZE 16 PRS» (cajas de una sola talla con 16 pares; GT180 y
  // GT181, 19-oct-2026: la lista no se reconocía).
  /\bSOLID\s*SIZE\s*(?:OF\s*)?(\d{1,3})\s*(?:PRS|PARES|PAIRS|PR)?\b/,
  // «CTNS 48» sin «OF» (GT128, 20-oct-2026: «PINK SOLID SIZE CTNS 48»).
  /\b(?:CTNS?|CARTONS?|CAJAS?)\s*[:=]?\s*(\d{1,3})\s*(?:PRS|PARES|PAIRS)?\b/,
];
// «LT BROWN NEW COLOR»: el color todavía no existe en MELI; se lee el color
// y se marca NUEVO (GT128, 20-oct-2026: «voy a aumentar colores nuevos […]
// que me lo pongas en el Excel marcados como nuevos»).
const RE_COLOR_NUEVO = /\s*(?:\(|\[)?\b(?:NEW\s+COLOU?R|COLOU?R\s+NUEVO|NUEVO|NEW)\b(?:\)|\])?\s*$/;
/** «16 PRS» suelto: pares por caja SOLO si en la línea no hay otro número. */
const RE_PARES_SUELTOS = /\b(\d{1,3})\s*(?:PRS|PARES|PAIRS)\b/;
/** «BROWN 50 CTNS»: color y cajas en la misma línea (sin «OF»). */
const RE_COLOR_CAJAS = /^(.*?[A-Z]{2,}.*?)\s*[:=X×-]?\s*(\d{1,4})\s*(?:CTNS?|CARTONS?|CAJAS?)$/;
/** «ASSORTMENT»: las líneas que siguen son la corrida de UNA caja. */
const RE_SURTIDO = /^(?:ASSORT(?:MENT|ED)?|ASSORTED\s+SIZES?|SURTIDO|CORRIDA)\s*[:.]?$/;
// «RED 20 CTNS ASSORTMENT» en UNA línea (el dueño pega la hoja con tabulador,
// 20-oct-2026, GT142): el letrero al final abre el surtido del color.
const RE_SURTIDO_AL_FINAL = /\s+(?:ASSORT(?:MENT|ED)?|ASSORTED\s+SIZES?|SURTIDO)\s*[:.]?$/;
// «BLK SOLID SIZE CTNS OF 48»: «solid size» solo dice que la caja es de UNA
// talla (lo normal de «talla cajas»); se quita para leer el color y la caja.
// Pero «SOLID SIZE 48» a secas (GT104, 20-oct-2026) SÍ dice los pares por
// caja: se deja para que lo lea RE_POR_CAJA.
const RE_SOLID_SIZE = /\bSOLID\s+SIZES?\b(?!\s*(?:OF\s*)?\d)/g;
// «GT104» + «5-GREEN»: el pedido y el packing list escriben el modelo
// GT104-5 color GREEN (MELI lo parte como GT104 + «5-GREEN»); se normaliza
// para que encuentre su historia (20-oct-2026: «GT104 nunca se ha pedido»).
const RE_COLOR_CON_NUMERO = /^(\d{1,2})\s*-\s*([A-Z].*)$/;

/** «GT104» + «5-GREEN» → modelo GT104-5, color GREEN; si no, tal cual. */
export function partirModeloColor(modelo: string, color: string): { modelo: string; color: string } {
  const m = color.match(RE_COLOR_CON_NUMERO);
  if (!m || /-\d{1,2}$/.test(modelo)) return { modelo, color };
  return { modelo: `${modelo}-${m[1]}`, color: m[2].trim() };
}
const RE_CAJAS_FINAL = /\s*(?:X|×|\*|=)\s*(\d{1,4})\s*(?:CTNS?|CAJAS?|CARTONS?)?\s*$/;

function esTalla(n: number): boolean {
  return Number.isFinite(n) && n >= 10 && n <= 35 && Math.round(n * 2) === n * 2;
}

function limpiar(linea: string): string {
  return linea
    .toUpperCase()
    .replace(/[\t ]+/g, " ")
    .replace(/[：]/g, ":")
    .replace(RE_SOLID_SIZE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Saca los pares por caja de la línea; devuelve el número y la línea sin eso. */
function sacarPorCaja(l: string): { porCaja: number | null; resto: string } {
  for (const re of RE_POR_CAJA) {
    const m = l.match(re);
    if (m) return { porCaja: Number(m[1]), resto: (l.slice(0, m.index) + " " + l.slice(m.index! + m[0].length)).replace(/\s+/g, " ").trim() };
  }
  const m = l.match(RE_PARES_SUELTOS);
  if (m) {
    const resto = (l.slice(0, m.index) + " " + l.slice(m.index! + m[0].length)).replace(/\s+/g, " ").trim();
    if (!/\d/.test(resto)) return { porCaja: Number(m[1]), resto };
  }
  return { porCaja: null, resto: l };
}

/** Números de la línea, en orden ("26 22", "26: 22 CTNS", "26-22"). */
function numerosDe(l: string): number[] {
  return (l.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** La línea son puros números y separadores (con «CTNS» o «CAJAS» como mucho). */
function esLineaDeNumeros(l: string): boolean {
  return /\d/.test(l) && /^[\d\s.,:;\-=X×*/]+(?:CTNS?|CAJAS?|CARTONS?|PRS|PARES)?\s*$/.test(l);
}

function limpiarColor(s: string): string {
  return s
    .replace(/^COLOU?R\s*[:=-]?\s*/, "")
    .replace(/\bSOLID\s*SIZES?\b/g, " ")
    .replace(/[,;:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function leerLista(texto: string): ListaLeida {
  const modelos: ModeloLista[] = [];
  const sinEntender: string[] = [];

  let modelo: ModeloLista | null = null;
  // el modelo como se escribió («GT104»): un color «5-GREEN» abre GT104-5
  let modeloBase = "";
  let color: ColorLista | null = null;
  // pares por caja: del color si se dio después de él, si no del modelo
  let porCajaModelo: number | null = null;
  let porCajaColor: number | null = null;
  // tallas de una corrida escritas en su propia línea, esperando sus pares
  let tallasCorrida: string[] | null = null;
  // cajas anunciadas junto al color («BROWN 50 CTNS») y, tras «ASSORTMENT»,
  // la corrida de una caja que se va juntando línea por línea
  let cajasColor: { cajas: number; linea: string } | null = null;
  let surtido: { corrida: Record<string, number>; linea: string; num: number } | null = null;

  const lineas = texto.split(/\r?\n/);

  const asegurarColor = (num: number): ColorLista | null => {
    if (!modelo) return null;
    if (color) return color;
    // Sin color escrito: el modelo lo trae vacío y se avisa.
    color = { color: "", renglones: [] };
    modelo.colores.push(color);
    modelo.avisos.push(`Línea ${num}: cajas sin color escrito.`);
    return color;
  };

  /** Cierra el surtido abierto: un renglón de corrida con las cajas del color. */
  const cerrarSurtido = () => {
    if (!surtido || !modelo) {
      surtido = null;
      return;
    }
    const s = surtido;
    surtido = null;
    const tallas = Object.keys(s.corrida);
    if (!tallas.length) {
      modelo.avisos.push(`Línea ${s.num}: «${s.linea}» sin tallas debajo.`);
      return;
    }
    if (!cajasColor) {
      modelo.avisos.push(`Línea ${s.num}: surtido sin cajas (escribe «COLOR 50 CTNS»).`);
      return;
    }
    const suma = tallas.reduce((a, t) => a + s.corrida[t], 0);
    const escrito = porCajaColor ?? porCajaModelo;
    if (escrito && escrito !== suma) {
      modelo.avisos.push(`${color?.color || "Sin color"}: la corrida suma ${suma} pares y la caja dice ${escrito}.`);
    }
    const c = asegurarColor(s.num);
    c?.renglones.push({
      unitalla: null,
      cajas: cajasColor.cajas,
      paresPorCaja: escrito ?? suma,
      corrida: s.corrida,
      linea: `${cajasColor.linea} · ${s.linea} ${tallas.map((t) => `${t}:${s.corrida[t]}`).join(" ")}`,
    });
    cajasColor = null;
  };

  lineas.forEach((cruda, i) => {
    const num = i + 1;
    let l = limpiar(cruda);
    if (!l) {
      cerrarSurtido();
      return;
    }
    if (/^(TOTAL|TTL)\b/.test(l)) return;
    // «RED 20 CTNS ASSORTMENT» en una sola línea: se lee el color con sus
    // cajas y se abre el surtido en el mismo paso.
    const surtidoAlFinal = RE_SURTIDO_AL_FINAL.test(l) && !RE_SURTIDO.test(l);
    if (surtidoAlFinal) l = l.replace(RE_SURTIDO_AL_FINAL, "").trim();
    // «… NEW COLOR» al final: el color que se abra en esta línea es nuevo.
    const colorNuevo = RE_COLOR_NUEVO.test(l) && /[A-Z]{2,}\s/.test(l);
    if (colorNuevo) l = l.replace(RE_COLOR_NUEVO, "").trim();
    const abrirColor = (nombreCrudo: string): ColorLista => {
      // «5-GREEN» bajo GT104 es el modelo GT104-5: si el bloque actual ya
      // tiene colores, se abre otro modelo con la misma caja; si está
      // vacío (la línea «GT104 5-GREEN …»), solo se renombra.
      const parte = partirModeloColor(modeloBase || modelo!.modelo, nombreCrudo);
      const nombre = parte.color;
      if (modelo && parte.modelo !== modelo.modelo) {
        if (modelo.colores.length || modelo.avisos.length) {
          modelo = { modelo: parte.modelo, colores: [], texto: cruda.trim(), avisos: [] };
          modelos.push(modelo);
          color = null;
          cajasColor = null;
          porCajaColor = null;
          tallasCorrida = null;
        } else modelo.modelo = parte.modelo;
      }
      return colorNuevo ? { color: nombre, renglones: [], nuevo: true } : { color: nombre, renglones: [] };
    };
    const abrirSurtido = () => {
      if (surtidoAlFinal) surtido = { corrida: {}, linea: cruda.trim(), num };
    };

    // ---- Dentro de un surtido: "23 3" = talla y pares de la caja ------------
    if (surtido && esLineaDeNumeros(l)) {
      const ns = numerosDe(l);
      if (ns.length === 2 && esTalla(ns[0]) && ns[1] > 0 && Number.isInteger(ns[1])) {
        surtido.corrida[normalizarTalla(String(ns[0]))] = ns[1];
        if (modelo) modelo.texto += "\n" + cruda.trim();
        return;
      }
    }
    cerrarSurtido();

    // ---- Modelo nuevo ------------------------------------------------------
    const mm = l.match(RE_MODELO);
    if (mm && !esLineaDeNumeros(l)) {
      modelo = { modelo: mm[1], colores: [], texto: cruda.trim(), avisos: [] };
      modeloBase = mm[1];
      modelos.push(modelo);
      color = null;
      cajasColor = null;
      porCajaModelo = null;
      porCajaColor = null;
      tallasCorrida = null;
      const { porCaja, resto } = sacarPorCaja(mm[2].trim());
      if (porCaja) porCajaModelo = porCaja;
      const cc = resto.match(RE_COLOR_CAJAS);
      if (cc && !/\b(?:OF|DE|CON)\b/.test(resto)) {
        const nombre = limpiarColor(cc[1]);
        if (nombre && !/\d{2,}/.test(nombre)) {
          color = abrirColor(nombre);
          modelo.colores.push(color);
          cajasColor = { cajas: Number(cc[2]), linea: cruda.trim() };
          abrirSurtido();
          return;
        }
      }
      const c = limpiarColor(resto);
      if (c && /[A-Z]/.test(c)) {
        color = abrirColor(c);
        modelo.colores.push(color);
      }
      return;
    }

    if (modelo) modelo.texto += "\n" + cruda.trim();
    if (!modelo) {
      sinEntender.push(`Línea ${num}: «${cruda.trim()}» (antes del primer modelo)`);
      return;
    }

    // ---- Pares por caja sueltos ("CTNS OF 12") -----------------------------
    const pc = sacarPorCaja(l);
    if (pc.porCaja && !/\d/.test(pc.resto)) {
      if (color && !color.renglones.length) porCajaColor = pc.porCaja;
      else if (!color) porCajaModelo = pc.porCaja;
      else porCajaColor = pc.porCaja;
      const c = limpiarColor(pc.resto);
      if (c && /[A-Z]{2,}/.test(c)) {
        color = abrirColor(c);
        modelo.colores.push(color);
        porCajaColor = pc.porCaja;
      }
      return;
    }

    // ---- «ASSORTMENT»: abre la corrida de una caja --------------------------
    if (RE_SURTIDO.test(l)) {
      surtido = { corrida: {}, linea: cruda.trim(), num };
      return;
    }

    // ---- «BROWN 50 CTNS»: color y cajas ------------------------------------
    const cc = l.match(RE_COLOR_CAJAS);
    if (cc && !/\b(?:OF|DE|CON)\b/.test(l)) {
      const nombre = limpiarColor(cc[1]);
      if (nombre && !/\d{2,}/.test(nombre)) {
        color = abrirColor(nombre);
        modelo.colores.push(color);
        porCajaColor = null;
        tallasCorrida = null;
        cajasColor = { cajas: Number(cc[2]), linea: cruda.trim() };
        abrirSurtido();
        return;
      }
    }

    // ---- «Misma corrida x 20» ------------------------------------------------
    const misma = l.match(/^(?:MISMA\s+)?CORRIDA(?:\s+ANTERIOR)?\s*(?:X|×|\*|=|:)?\s*(\d{1,4})\b/);
    if (misma) {
      const c = asegurarColor(num);
      c?.renglones.push({
        unitalla: null,
        cajas: Number(misma[1]),
        paresPorCaja: porCajaColor ?? porCajaModelo,
        corrida: null,
        mismaCorrida: true,
        linea: cruda.trim(),
      });
      return;
    }

    // ---- Corrida en una línea: "23:5 24:10 25:11 X 20" ----------------------
    const pares = [...l.matchAll(/(\d{2}(?:\.5)?)\s*[:=]\s*(\d{1,3})\b/g)];
    const finalCajas = l.match(RE_CAJAS_FINAL);
    if (pares.length >= 2 && finalCajas) {
      const corrida: Record<string, number> = {};
      for (const p of pares) corrida[normalizarTalla(p[1])] = Number(p[2]);
      const c = asegurarColor(num);
      c?.renglones.push({
        unitalla: null,
        cajas: Number(finalCajas[1]),
        paresPorCaja: porCajaColor ?? porCajaModelo,
        corrida,
        linea: cruda.trim(),
      });
      tallasCorrida = null;
      return;
    }

    if (esLineaDeNumeros(l)) {
      const ns = numerosDe(l);

      // Pares de una corrida con sus cajas al final: "5 10 11 12 10 X 20".
      if (finalCajas && ns.length >= 3) {
        const cajas = Number(finalCajas[1]);
        const porTalla = ns.slice(0, -1);
        if (tallasCorrida && tallasCorrida.length === porTalla.length) {
          const corrida: Record<string, number> = {};
          tallasCorrida.forEach((t, k) => {
            if (porTalla[k] > 0) corrida[t] = porTalla[k];
          });
          const c = asegurarColor(num);
          c?.renglones.push({
            unitalla: null,
            cajas,
            paresPorCaja: porCajaColor ?? porCajaModelo,
            corrida,
            linea: cruda.trim(),
          });
        } else {
          modelo.avisos.push(
            `Línea ${num}: «${cruda.trim()}» parece una corrida pero falta la línea con sus tallas (por ejemplo «23 24 25 26 27»).`,
          );
        }
        return;
      }

      // Tallas de una corrida en su propia línea: "23 24 25 26 27".
      if (ns.length >= 3 && ns.every(esTalla) && !finalCajas) {
        tallasCorrida = ns.map((n) => normalizarTalla(String(n)));
        return;
      }

      // Talla y cajas: "26 22", "26: 22 CTNS".
      if (ns.length === 2 && esTalla(ns[0]) && ns[1] > 0 && Number.isInteger(ns[1])) {
        const c = asegurarColor(num);
        c?.renglones.push({
          unitalla: normalizarTalla(String(ns[0])),
          cajas: ns[1],
          paresPorCaja: porCajaColor ?? porCajaModelo,
          corrida: null,
          linea: cruda.trim(),
        });
        return;
      }

      modelo.avisos.push(`Línea ${num}: «${cruda.trim()}» no se entendió.`);
      return;
    }

    // ---- Un color nuevo del mismo modelo -----------------------------------
    const c = limpiarColor(pc.resto);
    if (c && /[A-Z]{2,}/.test(c) && !/\d{2,}/.test(c)) {
      color = abrirColor(c);
      modelo.colores.push(color);
      porCajaColor = pc.porCaja ?? null;
      tallasCorrida = null;
      cajasColor = null;
      return;
    }

    modelo.avisos.push(`Línea ${num}: «${cruda.trim()}» no se entendió.`);
  });

  cerrarSurtido();

  // Colores sin cajas no sirven; se quitan y se avisa.
  for (const m of modelos) {
    const vacios = m.colores.filter((c) => !c.renglones.length);
    if (vacios.length) {
      m.avisos.push(`Sin cajas: ${vacios.map((c) => c.color || "(sin color)").join(", ")}.`);
      m.colores = m.colores.filter((c) => c.renglones.length);
    }
  }

  return { modelos: modelos.filter((m) => m.colores.length || m.avisos.length), sinEntender };
}
