/**
 * Lectura de la Proforma Invoice que manda la fábrica.
 *
 * Este archivo es más valioso de lo que parece: además del pedido, YA TRAE LA
 * CORRIDA. Los números por talla de cada renglón suman exactamente los pares
 * por caja. O sea que cargar un pedido nuevo también da de alta sus corridas,
 * sin capturar nada a mano.
 *
 * La forma del archivo (visto en IN10151):
 *
 *   PI : IN10151                        <- número de pedido
 *   ...
 *   | Item No. | DESCRIPTION | COLOR | SIZE ...          | PER CTN | CTNS | PRS |
 *   |          |             |       | 25MX=39 | 26MX=40 ...
 *   | GT104-1  | MENS SLIPPER| BLK 黑 NEGRO | 3 | 6 | 15 | 12 | 12 | 0 | 48 | 70 | 3360 |
 *
 * Las tallas vienen como "25MX=39": la de México es la que importa. Y el
 * color viene en tres idiomas, "BLK 黑 NEGRO", del que solo sirve el primero.
 */
import { formatosDeHoja, leerHoja } from "./leer-hoja";
import { canonizar, normalizarTalla } from "./sku";

export interface LineaProforma {
  modelo: string;
  color: string;
  colorCrudo: string;
  descripcion: string;
  /** talla mexicana -> pares por caja */
  tallas: Record<string, number>;
  paresPorCaja: number;
  cajas: number;
  pares: number;
  precioUnitario: number | null;
  /** la corrida suma lo mismo que "PER CTN" */
  cuadra: boolean;
  /**
   * Si la línea es de cajas de UNA sola talla, cuál. En ese formato la caja
   * trae PER CTN pares de la misma talla, y el número bajo la columna de la
   * talla son las CAJAS, no los pares. Estas líneas no definen la corrida
   * del modelo: son un pedido aparte de esa talla.
   */
  unitalla: string | null;
  /**
   * Precio por talla cuando la fábrica cobra distinto según la talla dentro
   * de la misma corrida (JINJIANG: 9.6 hasta la 26 y 10.1 de la 27 arriba,
   * en una fila de continuación con su propio precio). null si es uno solo.
   */
  preciosTalla?: Record<string, number> | null;
  /** metros cúbicos de UNA caja (columna CBM ÷ CTNS), si la proforma lo trae */
  cbmCaja?: number | null;
}

export type Moneda = "USD" | "RMB";

export interface Proforma {
  pedido: string;
  proveedor: string | null;
  /**
   * En qué moneda cobra la fábrica, leída del encabezado del precio
   * ("FOB Xiamen RMB", "(USD)", "US$1.030"). Cada fábrica es distinta y
   * hasta el 11-oct-2026 todo se guardaba como RMB. null si no lo dice.
   */
  moneda: Moneda | null;
  lineas: LineaProforma[];
  totales: { cajas: number; pares: number; importe: number | null };
  tallasDetectadas: string[];
  avisos: string[];
}

/** Ajustes por renglón que el usuario hace en la ventana de confirmación. */
export interface OverrideLinea {
  indice: number;
  /**
   * El renglón es de CAJAS COMPLETAS por color-modelo: cada columna de talla
   * trae las CAJAS de esa sola talla (46 cajas de la 23, 88 de la 24…), no
   * pares. Al aplicarlo, el renglón se parte en una línea unitalla por talla.
   */
  esCajaCompleta?: boolean;
  modelo?: string;
  color?: string;
}

/**
 * Aplica los ajustes del usuario sobre la proforma recién leída, ANTES de
 * guardar. Nada se estima: los pares por caja de un renglón de cajas
 * completas salen del propio archivo (PRS ÷ CTNS), y si los números no
 * cuadran exacto se rechaza con el detalle en lugar de adivinar.
 */
export function aplicarOverridesProforma(proforma: Proforma, overrides: OverrideLinea[]): void {
  const porIndice = new Map(overrides.map((o) => [o.indice, o]));
  const resultado: LineaProforma[] = [];

  proforma.lineas.forEach((l, i) => {
    const o = porIndice.get(i);
    if (o) {
      if (typeof o.modelo === "string" && o.modelo.trim()) l.modelo = o.modelo.trim().toUpperCase();
      if (typeof o.color === "string" && o.color.trim()) {
        l.color = o.color.trim().toUpperCase();
        l.colorCrudo = o.color.trim();
      }
    }

    // Las líneas que el archivo ya trae como unitalla no se tocan.
    if (!o?.esCajaCompleta || l.unitalla) {
      resultado.push(l);
      return;
    }

    const etiqueta = `${l.modelo} ${l.color}`;
    const sumaTallas = Object.values(l.tallas).reduce((a, b) => a + (Number(b) || 0), 0);

    if (!(l.cajas > 0) || !(l.pares > 0)) {
      throw new Error(
        `${etiqueta}: para leerlo como cajas completas el archivo necesita CTNS y PRS, y trae ${l.cajas} cajas y ${l.pares} pares.`,
      );
    }
    if (l.pares % l.cajas !== 0) {
      throw new Error(
        `${etiqueta}: ${l.pares} pares no es múltiplo de ${l.cajas} cajas; no se pueden deducir los pares por caja sin adivinar.`,
      );
    }
    if (sumaTallas !== l.cajas) {
      throw new Error(
        `${etiqueta}: las columnas de talla suman ${sumaTallas} cajas pero CTNS dice ${l.cajas}. Revisa el renglón antes de marcarlo como cajas completas.`,
      );
    }

    // Pares por caja EXACTOS del archivo: PRS ÷ CTNS (7,200 / 300 = 24).
    const porCaja = l.pares / l.cajas;

    for (const [talla, cajasTalla] of Object.entries(l.tallas)) {
      const cajasT = Number(cajasTalla) || 0;
      if (cajasT <= 0) continue;
      resultado.push({
        ...l,
        tallas: { [talla]: cajasT },
        paresPorCaja: porCaja,
        cajas: cajasT,
        pares: cajasT * porCaja,
        cuadra: true,
        unitalla: talla,
      });
    }
  });

  proforma.lineas = resultado;
  proforma.totales.cajas = resultado.reduce((a, l) => a + l.cajas, 0);
  proforma.totales.pares = resultado.reduce((a, l) => a + l.pares, 0);
  // El importe NO se recalcula: es el que dice la Proforma Invoice.
}

function texto(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return texto(o.result);
    if ("text" in o) return texto(o.text);
    if ("richText" in o && Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
    }
  }
  return String(v).trim();
}

function numero(v: unknown): number {
  const t = texto(v);
  if (!t || t === "-") return 0;
  const n = Number(t.replace(/[, ]/g, ""));
  if (Number.isFinite(n)) return n;
  // "US$1.030", "US$11,618.400" (FUZHOU pone la moneda en la celda).
  const pelado = Number(t.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(pelado) && /\d/.test(t) ? pelado : 0;
}

/**
 * "BLK 黑 NEGRO" -> "BLK".
 *
 * La fábrica escribe el color en inglés, chino y español. El inglés es el que
 * coincide con los SKUs de las publicaciones, así que se corta en cuanto
 * aparece un carácter que no es del alfabeto latino.
 */
export function colorDeProforma(crudo: string): string {
  const limpio = texto(crudo);
  if (!limpio) return "";
  // Corta ante el primer carácter fuera de ASCII (el chino).
  const soloLatino = limpio.split(/[^\x20-\x7E]/)[0]?.trim() ?? limpio;
  // "M BROWN -RED" (IN10172) es el "M BROWN-RED" de MELI: los espacios
  // alrededor del guion y los dobles espacios son dedazos de la fábrica.
  return (soloLatino || limpio).replace(/\s*-\s*/g, "-").replace(/\s{2,}/g, " ");
}

/** "25MX=39" -> "25". También acepta "25MX", "MX25" o un número pelón. */
export function tallaDeEncabezado(crudo: string): string | null {
  const conEspacios = texto(crudo).toUpperCase();
  if (!conEspacios) return null;

  // FUZHOU: "Mex 23   36/37   (24cm)" — la talla mexicana va después de
  // "MEX" y la celda trae además la europea y los centímetros.
  const mex = conEspacios.match(/\bMEX\s*(\d{1,2}(?:\.\d)?)\b/);
  if (mex) return normalizarTalla(mex[1]);

  const t = conEspacios.replace(/\s+/g, "");

  const conMx = t.match(/(\d{1,2}(?:\.\d)?)MX/);
  if (conMx) return normalizarTalla(conMx[1]);

  const mxAntes = t.match(/MX(\d{1,2}(?:\.\d)?)/);
  if (mxAntes) return normalizarTalla(mxAntes[1]);

  // Un número solo, en el rango de tallas de calzado.
  const solo = t.match(/^(\d{1,2}(?:\.\d)?)(?:=\d+)?$/);
  if (solo) {
    const n = Number(solo[1]);
    if (n >= 14 && n <= 50) return normalizarTalla(solo[1]);
  }
  return null;
}

/**
 * La moneda del precio: se busca en el encabezado de la columna de precio y
 * las filas de abajo ("FOB Xiamen RMB", "U./PRICE" + "(USD)", "FOB Shanghai"
 * + "USD"), en las celdas de precio ("US$1.030", "¥9.6") y, al último, en el
 * nombre del archivo ("USD PI for boot order…"). Nada se supone.
 */
export function monedaDeProforma(filas: unknown[][], filaEnc: number, colPrecio: number, nombre?: string): Moneda | null {
  const de = (t: string): Moneda | null => {
    const u = t.toUpperCase();
    if (/\bUSD\b|US\$|U\.S\.D|DOLLAR/.test(u)) return "USD";
    if (/\bRMB\b|\bCNY\b|YUAN|¥|￥|人民币/.test(u)) return "RMB";
    return null;
  };
  if (colPrecio >= 0) {
    for (let i = filaEnc; i < Math.min(filaEnc + 4, filas.length); i++) {
      for (const c of [colPrecio, colPrecio + 1]) {
        const m = de(texto(filas[i]?.[c]));
        if (m) return m;
      }
    }
    // Las celdas de precio de la tabla.
    for (let i = filaEnc + 1; i < Math.min(filaEnc + 40, filas.length); i++) {
      const m = de(texto(filas[i]?.[colPrecio]));
      if (m) return m;
    }
  }
  // Cualquier celda del encabezado (algunas fábricas la ponen en otra columna).
  for (let i = Math.max(0, filaEnc); i < Math.min(filaEnc + 3, filas.length); i++) {
    for (const celda of filas[i] ?? []) {
      const m = de(texto(celda));
      if (m) return m;
    }
  }
  return nombre ? de(nombre) : null;
}

export async function importarProforma(
  buffer: ArrayBuffer | Buffer,
  opts?: { nombre?: string; hoja?: string },
): Promise<Proforma> {
  const filas = await leerHoja(buffer, opts);

  const avisos: string[] = [];

  // --- Número de pedido ---------------------------------------------------
  // Cada fábrica lo escribe donde quiere: "PI :IN10152" en una celda,
  // "INVOICE NO.: (IN10157)" en otra, o la etiqueta "Invoice No." en una
  // celda y el "IN10160" en la celda de junto o de abajo.
  let pedido = "";
  let proveedor: string | null = null;

  for (let i = 0; i < Math.min(15, filas.length) && !pedido; i++) {
    const linea = filas[i].join(" ").trim();
    if (!proveedor && i < 3 && linea.length > 4 && !/PROFOMA|PROFORMA|INVOICE/i.test(linea)) {
      proveedor = linea.slice(0, 120);
    }
    for (const celda of filas[i]) {
      const m = texto(celda).match(
        /\b(?:PI|INVOICE\s*NO)\s*\.?\s*[:：]?\s*\(?\s*([A-Z]{1,4}\d{3,}[A-Z0-9\-_]*)/i,
      );
      if (m) {
        pedido = m[1].trim().toUpperCase();
        break;
      }
    }
  }

  // Etiqueta y valor en celdas separadas.
  if (!pedido) {
    busqueda: for (let i = 0; i < Math.min(15, filas.length); i++) {
      for (let c = 0; c < filas[i].length; c++) {
        if (!/INVOICE\s*NO/i.test(texto(filas[i][c]))) continue;
        const candidatos = [filas[i][c + 1], filas[i][c + 2], filas[i + 1]?.[c], filas[i + 2]?.[c]];
        for (const cand of candidatos) {
          const m = texto(cand)
            .toUpperCase()
            .match(/^\(?\s*([A-Z]{1,4}\d{3,}[A-Z0-9\-_]*)\s*\)?$/);
          if (m) {
            pedido = m[1];
            break busqueda;
          }
        }
      }
    }
  }

  // Los pedidos del negocio SIEMPRE empiezan con "IN": si las etiquetas
  // conocidas no aparecieron, se busca un IN##### pelón en cualquier celda
  // de arriba — BAIKE lo esconde como "S/C NO.:BK26-0527 (IN10105)".
  if (!pedido) {
    busquedaIn: for (let i = 0; i < Math.min(15, filas.length); i++) {
      for (const celda of filas[i]) {
        const m = texto(celda).toUpperCase().match(/\bIN\d{3,}\b/);
        if (m) {
          pedido = m[0];
          break busquedaIn;
        }
      }
    }
  }

  // Última red: el nombre del archivo (los pedidos se llaman IN10157_GT144).
  if (!pedido && opts?.nombre) {
    const m = opts.nombre.toUpperCase().match(/\b([A-Z]{2,4}\d{4,})\b/);
    if (m) {
      pedido = m[1];
      avisos.push("El número de pedido no venía dentro del archivo: salió del nombre.");
    }
  }

  if (!pedido) {
    throw new Error(
      'No encontré el número de pedido. Debe venir como "PI : IN10151" o "INVOICE NO.: IN10157" en las primeras filas.',
    );
  }

  // --- Fila de encabezados ------------------------------------------------
  let filaEnc = -1;
  let colItem = -1;
  let colDesc = -1;
  let colColor = -1;
  let colPorCaja = -1;
  let colCajas = -1;
  let colPares = -1;
  let colPrecio = -1;
  let colCbm = -1;

  for (let i = 0; i < Math.min(20, filas.length); i++) {
    const f = filas[i].map((c) => canonizar(c));
    // "Item No." (la mayoría), "Article no" (FUZHOU), "Style" (packing).
    const iItem = f.findIndex(
      (c) =>
        c === "ITEM-NO" || c === "ITEM" || c === "ITEM-NO-" ||
        c === "ARTICLE-NO" || c === "ARTICLE" || c === "STYLE" || c === "STYLE-NO" ||
        c === "MODELO" || c === "MODEL",
    );
    if (iItem < 0) continue;
    filaEnc = i;
    colItem = iItem;
    colDesc = f.findIndex((c) => c.startsWith("DESCRIPTION"));
    colColor = f.findIndex((c) => c === "COLOR" || c === "COLOUR" || c === "COLORS");
    colPorCaja = f.findIndex(
      (c) =>
        c === "PER-CTN" || c === "PERCTN" || c === "PAIRS-PER-CTN" ||
        c === "PRS-CTN" || c === "PRS-PER-CTN" || c === "PAIRS-CTN" || c === "PCS-CTN",
    );
    colCajas = f.findIndex(
      (c) => c === "CTNS" || c === "CTN" || c === "CARTONS" || c === "TOTAL-CTNS" || c === "TOTAL-CTN",
    );
    colPares = f.findIndex(
      (c) =>
        c === "PRS" || c === "PAIRS" || c === "PCS" || c === "QUANTITY" ||
        c === "TOTAL-PRS" || c === "TOTAL-PAIRS" || c === "TOTAL-PCS",
    );
    colPrecio = f.findIndex((c) => c.startsWith("FOB") || c.includes("PRICE"));
    colCbm = f.findIndex((c) => c === "CBM" || c === "CBMS");
    break;
  }

  if (filaEnc < 0 || colColor < 0) {
    throw new Error(
      'No encontré la tabla del pedido. Se esperan columnas "Item No.", "COLOR" y las tallas.',
    );
  }

  let moneda = monedaDeProforma(filas, filaEnc, colPrecio, opts?.nombre);
  if (!moneda && colPrecio >= 0) {
    const formatos = await formatosDeHoja(buffer, opts).catch(() => [] as string[][]);
    moneda = monedaDeProforma(formatos, filaEnc, colPrecio);
  }

  // --- Columnas de talla --------------------------------------------------
  // Van en la fila del encabezado o en las dos siguientes ("25MX=39").
  const colsTalla: { col: number; talla: string }[] = [];
  for (let i = filaEnc; i < Math.min(filaEnc + 4, filas.length); i++) {
    const encontradas: { col: number; talla: string }[] = [];
    filas[i].forEach((celda, col) => {
      if (col <= colColor) return;
      if ([colPorCaja, colCajas, colPares, colPrecio].includes(col)) return;
      const t = tallaDeEncabezado(celda);
      if (t) encontradas.push({ col, talla: t });
    });
    if (encontradas.length >= 3) {
      colsTalla.push(...encontradas);
      break;
    }
  }

  // Todas las tallas que la hoja llegue a usar: las del encabezado y las de
  // cualquier RE-encabezado a mitad de hoja (ver abajo).
  const tallasVistas = new Set(colsTalla.map((c) => c.talla));

  // BAIKE (Wenzhou): no hay una columna por talla — TODAS vienen juntas en
  // una sola celda ("23MX  24MX  25MX  26MX") y la corrida por caja en esa
  // misma columna dos filas abajo ("3  8  8  5", la fila de "mm" en medio).
  let colTallasJuntas = -1;
  if (!colsTalla.length) {
    for (let i = filaEnc + 1; i < Math.min(filaEnc + 8, filas.length) && colTallasJuntas < 0; i++) {
      filas[i].forEach((celda, col) => {
        const tokens = texto(celda).toUpperCase().match(/\d{1,2}(?:\.\d)?\s*MX/g);
        if (colTallasJuntas < 0 && tokens && tokens.length >= 2) colTallasJuntas = col;
      });
    }
    if (colTallasJuntas < 0) {
      throw new Error(
        'No encontré las columnas de talla. Se esperan encabezados como "25MX=39".',
      );
    }
  }

  // --- Renglones ----------------------------------------------------------
  // Tres formas de renglón conviven, según la fábrica:
  //   1. Clásico: modelo, color y toda la corrida en una fila.
  //   2. Continuación: la corrida no cupo en las columnas y sigue en la fila
  //      de abajo, SIN modelo ni color. Ignorarla pierde tallas y pares.
  //   3. Unitalla: cajas de una sola talla. El número bajo la columna de la
  //      talla son las CAJAS (coincide con CTNS y PRS = CTNS × PER CTN).
  const lineas: LineaProforma[] = [];
  const declaradoDe = new Map<LineaProforma, number>();
  let importe = 0;
  let modeloActual = "";
  let colorActual = "";
  let ultima: LineaProforma | null = null;
  // Precio del último renglón de cada modelo: FUZHOU pone el precio SOLO en
  // el primer color del modelo (celda combinada) y los demás colores salían
  // sin precio — el IN10163 decía $1,483 de importe y la proforma $11,618.
  const precioDeModelo = new Map<string, number>();

  // El modelo puede no venir en NINGÚN renglón (CHAOZHOU a veces lo deja
  // solo en la foto, y la celda "ITEM NO." queda vacía): última red, el
  // nombre del archivo — los pedidos se llaman IN10148_GT114.xls.
  let modeloDeArchivo = "";
  if (opts?.nombre) {
    const tokens = opts.nombre
      .toUpperCase()
      .replace(/\.[A-Z0-9]+$/, "")
      .split(/[^A-Z0-9]+/);
    modeloDeArchivo = tokens.find((t) => t !== pedido && /^[A-Z]{1,4}\d{2,5}$/.test(t)) ?? "";
  }

  for (let i = filaEnc + 1; i < filas.length; i++) {
    const f = filas[i];
    const modeloCrudo = texto(f[colItem]);
    const colorCrudo = colColor >= 0 ? texto(f[colColor]) : "";

    // "TTL" y "TOTAL" cierran la tabla: lo que siga ya no continúa nada.
    if (/^(TTL|TOTAL)/i.test(modeloCrudo)) {
      ultima = null;
      continue;
    }

    // --- ¿La fila REDEFINE las tallas de las columnas? --------------------
    // A mitad de hoja el pedido puede cambiar de corrida (damas 23–27 →
    // caballeros 26–30, como el IN10079): la fábrica repite el encabezado
    // con "26MX 265MM…" en las MISMAS columnas. Se reconoce porque las
    // celdas de talla traen texto con "MX" — un renglón de datos trae puros
    // números. Desde aquí, las columnas significan las tallas nuevas.
    if (colsTalla.length) {
      const redefinidas: { col: number; talla: string }[] = [];
      let conTexto = 0;
      for (const { col } of colsTalla) {
        const celda = texto(f[col]);
        if (!celda) continue;
        conTexto++;
        if (/\d\s*MX/i.test(celda)) {
          const t = tallaDeEncabezado(celda);
          if (t) redefinidas.push({ col, talla: t });
        }
      }
      if (redefinidas.length >= 2 && redefinidas.length === conTexto) {
        for (const r of redefinidas) {
          const c = colsTalla.find((x) => x.col === r.col);
          if (c) c.talla = r.talla;
          tallasVistas.add(r.talla);
        }
        ultima = null;
        continue;
      }
    }

    // Lo que viene debajo de la tabla (los datos del banco de CHAOZHOU:
    // «BANK'S NAME:THE BANK OF EAST ASIA,LIMITED»), un encabezado repetido
    // que no redefine tallas («ITEM NO.») o un color suelto en la columna del modelo NO es un
    // renglón: se leía como modelo nuevo con el color de arriba y un número
    // del pie como talla, y daba de alta corridas basura (IN10154, IN10155,
    // IN10170, IN10171, IN10181–IN10183; 18-oct-2026).
    if (modeloCrudo && !pareceModelo(modeloCrudo)) {
      ultima = null;
      continue;
    }

    const tallasFila = colsTalla
      .map(({ col, talla }) => ({ talla, valor: numero(f[col]) }))
      .filter((x) => x.valor > 0);
    if (!tallasFila.length) continue;

    const porCajaFila = colPorCaja >= 0 ? numero(f[colPorCaja]) : 0;
    const cajasFila = colCajas >= 0 ? numero(f[colCajas]) : 0;
    const paresFila = colPares >= 0 ? numero(f[colPares]) : 0;
    let precioFila = colPrecio >= 0 ? numero(f[colPrecio]) : 0;
    const cbmFila = colCbm >= 0 ? numero(f[colCbm]) : 0;

    if (modeloCrudo) modeloActual = modeloCrudo.toUpperCase();
    if (colorCrudo) colorActual = colorCrudo;
    if (!modeloActual && modeloDeArchivo && colorCrudo) {
      // Renglón con color y tallas pero sin modelo por ningún lado: antes se
      // descartaba y la proforma entera salía "sin renglones".
      modeloActual = modeloDeArchivo;
      avisos.push(
        `Ningún renglón trae "Item No.": el modelo ${modeloDeArchivo} salió del nombre del archivo.`,
      );
    }
    if (!modeloActual) continue;
    if (precioFila > 0) precioDeModelo.set(modeloActual, precioFila);
    else if (precioDeModelo.has(modeloActual) && (modeloCrudo || colorCrudo || !ultima)) {
      precioFila = precioDeModelo.get(modeloActual)!;
    }
    const cbmCajaFila = cbmFila > 0 && cajasFila > 0 ? Number((cbmFila / cajasFila).toFixed(5)) : null;

    // ---- Unitalla: una sola talla con cajas y pares propios ---------------
    // Dos formas. (a) El número bajo la talla son las CAJAS (coincide con
    // CTNS). (b) El número bajo la talla son los PARES POR CAJA (coincide
    // con PER CTN) y cada talla va en su propia fila con sus CTNS y PRS:
    // así vino el IN10172 de GT148 (48 pares de una sola talla por caja,
    // 20 cajas de la 23, 35 de la 24…). Antes esas filas se tomaban como
    // continuación de la corrida y el pedido salía con 71 cajas de 240
    // pares en vez de 379 cajas de 48.
    const unaTalla = tallasFila.length === 1 && porCajaFila > 0 && cajasFila > 0 && paresFila === cajasFila * porCajaFila;
    const esUnitalla =
      unaTalla &&
      ((tallasFila[0].valor === cajasFila && tallasFila[0].valor !== porCajaFila) ||
        tallasFila[0].valor === porCajaFila);

    if (esUnitalla) {
      const t = tallasFila[0].talla;
      const linea: LineaProforma = {
        modelo: modeloActual,
        color: colorDeProforma(colorActual).toUpperCase(),
        colorCrudo: colorActual,
        descripcion: colDesc >= 0 ? texto(f[colDesc]) : "",
        tallas: { [t]: porCajaFila },
        paresPorCaja: porCajaFila,
        cajas: cajasFila,
        pares: paresFila,
        precioUnitario: precioFila > 0 ? precioFila : null,
        cuadra: true,
        unitalla: t,
        cbmCaja: cbmCajaFila,
      };
      lineas.push(linea);
      importe += precioFila * paresFila;
      ultima = null;
      continue;
    }

    // ---- Continuación: sin modelo ni color propios, sigue la de arriba ----
    if (!modeloCrudo && !colorCrudo && ultima) {
      // Con su propio precio distinto al del renglón: precio por talla.
      const precioBase = ultima.precioUnitario ?? 0;
      if (precioFila > 0 && precioBase > 0 && precioFila !== precioBase) {
        const porTalla: Record<string, number> = { ...(ultima.preciosTalla ?? {}) };
        for (const t of Object.keys(ultima.tallas)) if (porTalla[t] == null) porTalla[t] = precioBase;
        for (const { talla } of tallasFila) porTalla[talla] = precioFila;
        ultima.preciosTalla = porTalla;
      }
      for (const { talla, valor } of tallasFila) {
        ultima.tallas[talla] = (ultima.tallas[talla] ?? 0) + valor;
      }
      ultima.paresPorCaja = Object.values(ultima.tallas).reduce((a, b) => a + b, 0);
      if (paresFila > 0) ultima.pares += paresFila;
      if (cajasFila > 0 && !ultima.cajas) ultima.cajas = cajasFila;
      importe += precioFila * paresFila;
      continue;
    }

    // ---- Línea nueva -------------------------------------------------------
    const tallas: Record<string, number> = {};
    let suma = 0;
    for (const { talla, valor } of tallasFila) {
      tallas[talla] = (tallas[talla] ?? 0) + valor;
      suma += valor;
    }

    const linea: LineaProforma = {
      modelo: modeloActual,
      color: colorDeProforma(colorActual).toUpperCase(),
      colorCrudo: colorActual,
      descripcion: colDesc >= 0 ? texto(f[colDesc]) : "",
      tallas,
      paresPorCaja: suma,
      cajas: cajasFila,
      pares: paresFila,
      precioUnitario: precioFila > 0 ? precioFila : null,
      cuadra: true,
      unitalla: null,
      cbmCaja: cbmCajaFila,
    };
    if (porCajaFila > 0) declaradoDe.set(linea, porCajaFila);
    lineas.push(linea);
    importe += precioFila * paresFila;
    ultima = linea;
  }

  // ---- Renglones BAIKE: tallas juntas en una celda -------------------------
  // El bucle clásico de arriba no encuentra nada en este formato (no hay
  // columnas de talla), así que se recorre aparte por bloques de tres filas:
  // línea, milímetros (se ignora) y corrida.
  if (colTallasJuntas >= 0) {
    let modeloB = "";
    for (let i = filaEnc + 1; i < filas.length; i++) {
      const f = filas[i];
      const celdaTallas = texto(f[colTallasJuntas]);
      if (/^(TTL|TOTAL)/i.test(celdaTallas) || /^(TTL|TOTAL)/i.test(texto(f[colItem]))) break;

      const tokens = celdaTallas.toUpperCase().match(/\d{1,2}(?:\.\d)?(?=\s*MX)/g) ?? [];
      if (tokens.length < 2) continue;
      const tallasLinea = tokens.map((t) => normalizarTalla(t));

      const modeloCrudo = texto(f[colItem]);
      if (modeloCrudo) modeloB = modeloCrudo.toUpperCase();
      const colorCrudo = colColor >= 0 ? texto(f[colColor]) : "";
      if (!modeloB || !colorCrudo) continue;

      const paresFila = colPares >= 0 ? numero(f[colPares]) : 0;
      const precioFila = colPrecio >= 0 ? numero(f[colPrecio]) : 0;
      const cbmFila = colCbm >= 0 ? numero(f[colCbm]) : 0;
      // Las cajas no traen encabezado propio (la celda combinada se lo come):
      // son el número que vive entre las tallas y los pares.
      let cajasFila = colCajas >= 0 ? numero(f[colCajas]) : 0;
      if (!cajasFila) {
        for (let c = colTallasJuntas + 1; c < colPares; c++) {
          const n = numero(f[c]);
          if (n > 0) {
            cajasFila = n;
            break;
          }
        }
      }

      // La corrida vive en las filas de abajo, misma columna: puros números
      // separados por espacios. La fila de "###mm" se brinca sola.
      let corrida: number[] | null = null;
      for (let j = i + 1; j <= i + 3 && j < filas.length; j++) {
        const c = texto(filas[j]?.[colTallasJuntas]);
        if (!c || /mm|mx/i.test(c)) continue;
        const nums = c
          .split(/\s+/)
          .map((x) => Number(x))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (nums.length && nums.length <= tallasLinea.length) {
          corrida = nums;
          break;
        }
      }
      if (!corrida) continue;

      const tallas: Record<string, number> = {};
      corrida.forEach((n, k) => {
        tallas[tallasLinea[k]] = (tallas[tallasLinea[k]] ?? 0) + n;
      });

      const linea: LineaProforma = {
        modelo: modeloB,
        color: colorDeProforma(colorCrudo).toUpperCase(),
        colorCrudo,
        descripcion: colDesc >= 0 ? texto(f[colDesc]) : "",
        tallas,
        paresPorCaja: corrida.reduce((a, b) => a + b, 0),
        cajas: cajasFila,
        pares: paresFila,
        precioUnitario: precioFila > 0 ? precioFila : null,
        cuadra: true,
        unitalla: null,
        cbmCaja: cbmFila > 0 && cajasFila > 0 ? Number((cbmFila / cajasFila).toFixed(5)) : null,
      };
      // El cuadre declarado sale de PRS ÷ cajas (aquí no hay "PER CTN").
      if (cajasFila > 0 && paresFila > 0 && paresFila % cajasFila === 0) {
        declaradoDe.set(linea, paresFila / cajasFila);
      }
      lineas.push(linea);
      importe += precioFila * paresFila;
      for (const t of tallasLinea) colsTalla.push({ col: colTallasJuntas, talla: t });
    }
  }

  if (!lineas.length) {
    throw new Error("No encontré ningún renglón de producto con tallas en el archivo.");
  }

  // --- Cajas completas por talla, detectadas solas --------------------------
  // CHAOZHOU también manda renglones donde el número bajo cada talla son las
  // CAJAS de esa sola talla (10+10+15+20 = 55 = CTNS) y no una corrida.
  // Leerlo como corrida inventa "55 pares por caja". La firma es inequívoca:
  // las tallas suman EXACTO las cajas, los pares son múltiplo exacto de las
  // cajas, y la lectura como corrida NO cuadra. Se parte en unitallas con la
  // misma regla que el ajuste manual (PRS ÷ CTNS), avisado.
  const comoCajasCompletas: OverrideLinea[] = [];
  lineas.forEach((l, i) => {
    if (l.unitalla || !(l.cajas > 0) || !(l.pares > 0)) return;
    const suma = Object.values(l.tallas).reduce((a, b) => a + (Number(b) || 0), 0);
    if (
      suma === l.cajas &&
      l.pares % l.cajas === 0 &&
      l.pares / l.cajas > 1 &&
      l.cajas * suma !== l.pares
    ) {
      comoCajasCompletas.push({ indice: i, esCajaCompleta: true });
      avisos.push(
        `${l.modelo} ${l.color}: las tallas suman ${suma} = CTNS, así que son CAJAS por talla (${l.pares / l.cajas} pares por caja). Se partió en unitallas.`,
      );
      declaradoDe.delete(l);
    }
  });
  let lineasFinales = lineas;
  if (comoCajasCompletas.length) {
    const temporal: Proforma = {
      pedido,
      proveedor,
      moneda,
      lineas,
      totales: { cajas: 0, pares: 0, importe: null },
      tallasDetectadas: [],
      avisos,
    };
    aplicarOverridesProforma(temporal, comoCajasCompletas);
    lineasFinales = temporal.lineas;
  }

  // --- Cuadres, ya con las continuaciones sumadas ---------------------------
  let totalCajas = 0;
  let totalPares = 0;
  for (const l of lineasFinales) {
    if (!l.pares) l.pares = l.cajas * l.paresPorCaja;

    const declarado = declaradoDe.get(l) ?? 0;
    l.cuadra = declarado === 0 || l.paresPorCaja === declarado;
    if (!l.cuadra) {
      avisos.push(
        `${l.modelo} ${l.color}: la corrida suma ${l.paresPorCaja} pares pero "PER CTN" dice ${declarado}. Se usa la corrida.`,
      );
    }
    if (l.cajas > 0 && l.pares > 0 && Math.abs(l.cajas * l.paresPorCaja - l.pares) > l.paresPorCaja) {
      avisos.push(
        `${l.modelo} ${l.color}: ${l.cajas} cajas × ${l.paresPorCaja} pares dan ${l.cajas * l.paresPorCaja}, pero el archivo dice ${l.pares}.`,
      );
    }

    totalCajas += l.cajas;
    totalPares += l.pares;
  }

  // Un mismo modelo+color repetido sería ambiguo al dar de alta la corrida.
  // Las líneas unitalla no cuentan: es normal que un color tenga varias.
  const vistos = new Map<string, number>();
  for (const l of lineasFinales) {
    if (l.unitalla) continue;
    const k = `${canonizar(l.modelo)}|${canonizar(l.color)}`;
    vistos.set(k, (vistos.get(k) ?? 0) + 1);
  }
  for (const [k, veces] of vistos) {
    if (veces > 1) {
      avisos.push(`${k.replace("|", " / ")} aparece ${veces} veces; se sumarán las cajas.`);
    }
  }

  return {
    pedido,
    proveedor,
    moneda,
    lineas: lineasFinales,
    totales: {
      cajas: totalCajas,
      pares: totalPares,
      importe: importe > 0 ? Number(importe.toFixed(2)) : null,
    },
    tallasDetectadas: [...new Set([...tallasVistas, ...colsTalla.map((c) => c.talla)])],
    avisos,
  };
}

/**
 * ¿La celda de «Item No.» trae un modelo? Un modelo es un código con
 * número (GT114, GT104-1, MY2304, GT148G, 686), de una a tres palabras y sin
 * «:» — así se descartan el pie del banco, los encabezados repetidos y un
 * color escrito en la columna equivocada.
 */
export function pareceModelo(celda: string): boolean {
  const t = celda.trim();
  if (!t || t.includes(":")) return false;
  if (t.split(/\s+/).length > 3) return false;
  return /^[A-Z]{0,5}[-\s]?\d{2,6}/i.test(t);
}
