/**
 * Lectura del PACKING LIST que manda la fábrica al embarcar.
 *
 * Es la lista de lo que de verdad subió al contenedor, y de ahí sale, sin
 * capturar nada a mano, qué cajas de qué pedido viajan en qué contenedor.
 *
 * La forma del archivo (visto en S259-2026, JIAXING, contenedor MIEU3920536):
 *
 *   S259-2026 Packing List (Container :MIEU3920536 / Seal :CN8033803 )
 *   | Photo | Invoice No. | Style | color   | Size | Prs/size/ctn | Pairs/ctn | Means | Ctns | Prs | CBM | …
 *   |       | IN10079-3   | GT221 | M Brown | 23   | 4            | 24        | …     | 40   | 960 |
 *   |       |             |       |         | 24   | 7            |           |       |      |     |
 *   |       |             |       |         | 25   | 7            |           |       |      |     |
 *   |       |             |       | Tan     | 23   | 4            | 24        | …     | 40   | 960 |
 *
 * Cada COLOR es un bloque: la primera fila trae cajas y pares, y las filas de
 * abajo (sin color) completan la corrida talla por talla. El pedido y el
 * modelo se heredan hacia abajo. "IN10079-3" es el pedido IN10079 en su
 * tercer embarque parcial: el sufijo se quita para amarrar con el ERP.
 *
 * También se acepta el packing list del propio ERP (SKU | Cajas) y el
 * formato de proforma con una columna por talla, por si alguna fábrica lo
 * manda así.
 */
import { leerHoja } from "./leer-hoja";
import { canonizar, normalizarTalla } from "./sku";
import { colorDeProforma, tallaDeEncabezado } from "./proforma";
import { desglosarSku } from "../servicios/sync";

export interface LineaPacking {
  /** como viene en el archivo: "IN10079-3" */
  pedidoCrudo: string | null;
  /** el pedido del ERP: "IN10079" */
  pedido: string | null;
  /**
   * Solo en el formato SKU | Cajas: el SKU tal cual. Un modelo con guion
   * (GT104-1-BLK) no se puede partir sin adivinar, así que el amarre contra
   * el pedido se hace comparando SKUs completos, no pedazos.
   */
  sku?: string;
  modelo: string;
  color: string;
  colorCrudo: string;
  /** la talla si la caja es de UNA sola talla; null si es corrida */
  talla: string | null;
  /** talla -> pares por caja */
  tallas: Record<string, number>;
  paresPorCaja: number;
  cajas: number;
  pares: number;
  fila: number;
}

export interface PackingList {
  /** número de contenedor que trae el archivo (ISO 6346: MIEU3920536) */
  contenedor: string | null;
  sello: string | null;
  /** referencia del embarque: "S259-2026" */
  referencia: string | null;
  lineas: LineaPacking[];
  totales: { cajas: number; pares: number };
  pedidos: string[];
  avisos: string[];
}

function texto(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function numero(v: unknown): number {
  const t = texto(v);
  if (!t || t === "-") return 0;
  const n = Number(t.replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** "IN10079-3" -> "IN10079". El sufijo es el número de embarque parcial. */
export function pedidoBase(crudo: string): string {
  const p = texto(crudo).toUpperCase();
  const m = p.match(/^([A-Z]{1,4}\d{3,})(?:-\d{1,2})?$/);
  return m ? m[1] : p;
}

/** "23", "23MX", "23MX=39" -> "23"; "MM" o texto -> null. */
function tallaDeCelda(v: unknown): string | null {
  const t = texto(v).toUpperCase();
  if (!t) return null;
  if (/^\d{1,2}(\.\d)?$/.test(t)) {
    const n = Number(t);
    return n >= 14 && n <= 50 ? normalizarTalla(t) : null;
  }
  return tallaDeEncabezado(t);
}

/**
 * Número de contenedor: cuatro letras y siete dígitos (ISO 6346). Se busca
 * primero después de la palabra "Container"; si no, cualquier celda de
 * arriba que tenga esa forma.
 */
export function contenedorDeTexto(s: string): string | null {
  const t = texto(s).toUpperCase();
  const m =
    t.match(/CONT(?:AINER|ENEDOR)?\s*(?:NO\.?|#)?\s*[:：]?\s*([A-Z]{4}\s?\d{7})/) ??
    t.match(/\b([A-Z]{4}\s?\d{7})\b/);
  return m ? m[1].replace(/\s+/g, "") : null;
}

export async function importarPackingList(
  buffer: ArrayBuffer | Buffer,
  opts?: { nombre?: string; hoja?: string },
): Promise<PackingList> {
  const filas = await leerHoja(buffer, opts);
  const avisos: string[] = [];

  // --- Datos del embarque, en las filas de arriba ---------------------------
  let contenedor: string | null = null;
  let sello: string | null = null;
  let referencia: string | null = null;
  for (let i = 0; i < Math.min(15, filas.length); i++) {
    for (const celda of filas[i]) {
      const t = texto(celda);
      if (!t) continue;
      if (!contenedor) contenedor = contenedorDeTexto(t);
      if (!sello) {
        const m = t.toUpperCase().match(/SEAL\s*(?:NO\.?)?\s*[:：]?\s*([A-Z0-9-]{4,})/);
        if (m) sello = m[1];
      }
      if (!referencia) {
        const m = t.match(/^\s*([A-Z0-9][A-Z0-9-]{2,})\s+PACKING\s+LIST/i);
        if (m) referencia = m[1].toUpperCase();
      }
    }
  }
  if (!contenedor && opts?.nombre) contenedor = contenedorDeTexto(opts.nombre);

  // --- Fila de encabezados --------------------------------------------------
  let filaEnc = -1;
  const col = {
    pedido: -1,
    modelo: -1,
    color: -1,
    talla: -1,
    prsPorTalla: -1,
    porCaja: -1,
    cajas: -1,
    pares: -1,
    sku: -1,
    contenedor: -1,
  };

  for (let i = 0; i < Math.min(25, filas.length); i++) {
    const f = filas[i].map((c) => canonizar(texto(c)));
    const iModelo = f.findIndex(
      (c) => c === "STYLE" || c === "ITEM-NO" || c === "ITEM" || c === "MODELO" || c === "MODEL" || c === "STYLE-NO",
    );
    const iSku = f.findIndex((c) => c === "SKU");
    if (iModelo < 0 && iSku < 0) continue;

    filaEnc = i;
    col.modelo = iModelo;
    col.sku = iSku;
    col.pedido = f.findIndex(
      (c) => c.startsWith("INVOICE") || c === "PI" || c === "PI-NO" || c === "PEDIDO" || c === "PO" || c === "PO-NO" || c === "ORDER" || c === "ORDER-NO",
    );
    col.color = f.findIndex((c) => c === "COLOR" || c === "COLOUR" || c === "COLORS");
    col.talla = f.findIndex((c) => c === "SIZE" || c === "TALLA" || c === "SIZES");
    col.prsPorTalla = f.findIndex(
      (c) => /^(PRS|PAIRS|PCS)-(PER-)?SIZE/.test(c) || c === "PRS-SIZE-CTN" || c === "PARES-TALLA",
    );
    col.porCaja = f.findIndex(
      (c) => c === "PAIRS-CTN" || c === "PRS-CTN" || c === "PER-CTN" || c === "PAIRS-PER-CTN" || c === "PRS-PER-CTN" || c === "PARES-CAJA",
    );
    col.cajas = f.findIndex((c) => c === "CTNS" || c === "CTN" || c === "CARTONS" || c === "CAJAS" || c === "TOTAL-CTNS");
    col.pares = f.findIndex(
      (c) => c === "PRS" || c === "PAIRS" || c === "PCS" || c === "PARES" || c === "QUANTITY" || c === "TOTAL-PRS" || c === "QTY",
    );
    col.contenedor = f.findIndex((c) => c === "CONTAINER" || c === "CONTENEDOR" || c === "CONTAINER-NO");
    break;
  }

  if (filaEnc < 0) {
    throw new Error(
      'No encontré la tabla del packing list. Se esperan columnas "Style" (o "Item No."), "Color", "Size" y "Ctns", o bien "SKU" y "Cajas".',
    );
  }

  // Columnas de talla al estilo proforma ("23MX=39"), por si la fábrica
  // manda el packing con una columna por talla en vez de una fila por talla.
  const colsTalla: { col: number; talla: string }[] = [];
  if (col.talla < 0) {
    const excluidas = new Set(Object.values(col));
    filas[filaEnc].forEach((celda, c) => {
      if (excluidas.has(c)) return;
      const t = tallaDeEncabezado(texto(celda));
      if (t) colsTalla.push({ col: c, talla: t });
    });
  }

  // --- Renglones --------------------------------------------------------------
  const lineas: LineaPacking[] = [];
  let pedidoActual = "";
  let modeloActual = "";
  let colorAnterior = "";
  let bloque: LineaPacking | null = null;

  for (let i = filaEnc + 1; i < filas.length; i++) {
    const f = filas[i];
    const primeras = f.slice(0, 4).map((c) => texto(c).toUpperCase());
    if (primeras.some((c) => /^(TTL|TOTAL|GRAND TOTAL)\b/.test(c))) break;

    // ---- Formato del ERP: SKU | Cajas ----------------------------------------
    if (col.sku >= 0 && col.modelo < 0) {
      const sku = texto(f[col.sku]).toUpperCase();
      const cajas = col.cajas >= 0 ? numero(f[col.cajas]) : 0;
      if (!sku || cajas <= 0) continue;
      const d = desglosarSku(sku);
      if (!d.modelo) continue;
      const pedidoCelda = col.pedido >= 0 ? texto(f[col.pedido]).toUpperCase() : "";
      lineas.push({
        pedidoCrudo: pedidoCelda || null,
        pedido: pedidoCelda ? pedidoBase(pedidoCelda) : null,
        sku,
        modelo: d.modelo.toUpperCase(),
        color: (d.color ?? "").toUpperCase(),
        colorCrudo: d.color ?? "",
        talla: d.talla ? normalizarTalla(d.talla) : null,
        tallas: {},
        paresPorCaja: 0,
        cajas,
        pares: col.pares >= 0 ? numero(f[col.pares]) : 0,
        fila: i + 1,
      });
      continue;
    }

    const modeloCrudo = texto(f[col.modelo]);
    const colorCrudo = col.color >= 0 ? texto(f[col.color]) : "";
    const pedidoCrudo = col.pedido >= 0 ? texto(f[col.pedido]) : "";
    const cajasFila = col.cajas >= 0 ? numero(f[col.cajas]) : 0;
    const paresFila = col.pares >= 0 ? numero(f[col.pares]) : 0;
    const porCajaFila = col.porCaja >= 0 ? numero(f[col.porCaja]) : 0;

    if (pedidoCrudo && /\d{3,}/.test(pedidoCrudo)) pedidoActual = pedidoCrudo.toUpperCase();
    if (modeloCrudo) modeloActual = modeloCrudo.toUpperCase();

    // ¿Empieza un bloque? Trae color o cajas propias.
    const empieza = Boolean(colorCrudo) || cajasFila > 0;

    if (empieza) {
      if (!modeloActual) {
        avisos.push(`Fila ${i + 1}: trae cajas pero ningún modelo arriba; se brincó.`);
        bloque = null;
        continue;
      }
      const colorDelBloque = colorCrudo || colorAnterior;
      colorAnterior = colorDelBloque;
      bloque = {
        pedidoCrudo: pedidoActual || null,
        pedido: pedidoActual ? pedidoBase(pedidoActual) : null,
        modelo: modeloActual,
        color: colorDeProforma(colorDelBloque).toUpperCase(),
        colorCrudo: colorDelBloque,
        talla: null,
        tallas: {},
        paresPorCaja: porCajaFila,
        cajas: cajasFila,
        pares: paresFila,
        fila: i + 1,
      };
      lineas.push(bloque);

      // Columnas de talla (formato proforma): la corrida viene en la misma fila.
      for (const { col: c, talla } of colsTalla) {
        const v = numero(f[c]);
        if (v > 0) bloque.tallas[talla] = (bloque.tallas[talla] ?? 0) + v;
      }
    }

    if (!bloque) continue;

    // Fila de talla (propia o de continuación): Size + Prs/size/ctn.
    if (col.talla >= 0) {
      const talla = tallaDeCelda(f[col.talla]);
      const prs = col.prsPorTalla >= 0 ? numero(f[col.prsPorTalla]) : 0;
      if (talla && prs > 0) {
        bloque.tallas[talla] = (bloque.tallas[talla] ?? 0) + prs;
      } else if (talla && prs <= 0 && !empieza) {
        avisos.push(`Fila ${i + 1}: talla ${talla} sin pares por caja; se ignoró.`);
      }
    }
  }

  if (!lineas.length) {
    throw new Error("No encontré ningún renglón con cajas en el packing list.");
  }

  // --- Cierre de cada bloque: pares por caja, unitalla y cuadres ------------
  let totalCajas = 0;
  let totalPares = 0;
  for (const l of lineas) {
    const suma = Object.values(l.tallas).reduce((a, b) => a + b, 0);
    const tallasDistintas = Object.keys(l.tallas);

    if (suma > 0) {
      if (l.paresPorCaja > 0 && l.paresPorCaja !== suma) {
        avisos.push(
          `${l.modelo} ${l.color}: la corrida suma ${suma} pares pero "Pairs/ctn" dice ${l.paresPorCaja}. Se usa la corrida.`,
        );
      }
      l.paresPorCaja = suma;
    } else if (!l.paresPorCaja && l.cajas > 0 && l.pares > 0 && l.pares % l.cajas === 0) {
      l.paresPorCaja = l.pares / l.cajas;
    }

    // Una sola talla en la caja: es una caja unitalla, no la corrida del modelo.
    if (tallasDistintas.length === 1) l.talla = tallasDistintas[0];

    if (!l.pares && l.paresPorCaja) l.pares = l.cajas * l.paresPorCaja;
    if (l.cajas > 0 && l.pares > 0 && l.paresPorCaja > 0 && l.cajas * l.paresPorCaja !== l.pares) {
      avisos.push(
        `${l.modelo} ${l.color}: ${l.cajas} cajas × ${l.paresPorCaja} pares dan ${l.cajas * l.paresPorCaja}, pero el archivo dice ${l.pares}.`,
      );
    }
    if (!l.pedido) {
      avisos.push(`${l.modelo} ${l.color} (fila ${l.fila}): sin número de pedido; se buscará en los pedidos vivos.`);
    }

    totalCajas += l.cajas;
    totalPares += l.pares;
  }

  return {
    contenedor,
    sello,
    referencia,
    lineas,
    totales: { cajas: totalCajas, pares: totalPares },
    pedidos: [...new Set(lineas.map((l) => l.pedido).filter((p): p is string => Boolean(p)))],
    avisos,
  };
}
