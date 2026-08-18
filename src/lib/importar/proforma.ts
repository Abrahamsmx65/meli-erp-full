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
import { leerHoja } from "./leer-hoja";
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
}

export interface Proforma {
  pedido: string;
  proveedor: string | null;
  lineas: LineaProforma[];
  totales: { cajas: number; pares: number; importe: number | null };
  tallasDetectadas: string[];
  avisos: string[];
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
  return Number.isFinite(n) ? n : 0;
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
  return soloLatino || limpio;
}

/** "25MX=39" -> "25". También acepta "25MX", "MX25" o un número pelón. */
export function tallaDeEncabezado(crudo: string): string | null {
  const t = texto(crudo).toUpperCase().replace(/\s+/g, "");
  if (!t) return null;

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

export async function importarProforma(
  buffer: ArrayBuffer | Buffer,
  opts?: { nombre?: string; hoja?: string },
): Promise<Proforma> {
  const filas = await leerHoja(buffer, opts);

  const avisos: string[] = [];

  // --- Número de pedido ---------------------------------------------------
  let pedido = "";
  let proveedor: string | null = null;

  for (let i = 0; i < Math.min(12, filas.length); i++) {
    const linea = filas[i].join(" ").trim();
    if (!linea) continue;
    if (!proveedor && i < 3 && linea.length > 4 && !/PROFOMA|PROFORMA|INVOICE/i.test(linea)) {
      proveedor = linea.slice(0, 120);
    }
    const m = linea.match(/\bPI\s*[:：]?\s*([A-Z0-9][A-Z0-9\-_]{2,})/i);
    if (m) {
      pedido = m[1].trim().toUpperCase();
      break;
    }
  }

  if (!pedido) {
    throw new Error(
      'No encontré el número de pedido. Debe venir como "PI : IN10151" en las primeras filas.',
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

  for (let i = 0; i < Math.min(20, filas.length); i++) {
    const f = filas[i].map((c) => canonizar(c));
    const iItem = f.findIndex((c) => c === "ITEM-NO" || c === "ITEM" || c === "ITEM-NO-");
    if (iItem < 0) continue;
    filaEnc = i;
    colItem = iItem;
    colDesc = f.findIndex((c) => c.startsWith("DESCRIPTION"));
    colColor = f.findIndex((c) => c === "COLOR" || c === "COLOUR");
    colPorCaja = f.findIndex((c) => c === "PER-CTN" || c === "PERCTN" || c === "PAIRS-PER-CTN");
    colCajas = f.findIndex((c) => c === "CTNS" || c === "CTN" || c === "CARTONS");
    colPares = f.findIndex((c) => c === "PRS" || c === "PAIRS" || c === "PCS");
    colPrecio = f.findIndex((c) => c.startsWith("FOB"));
    break;
  }

  if (filaEnc < 0 || colColor < 0) {
    throw new Error(
      'No encontré la tabla del pedido. Se esperan columnas "Item No.", "COLOR" y las tallas.',
    );
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

  if (!colsTalla.length) {
    throw new Error(
      'No encontré las columnas de talla. Se esperan encabezados como "25MX=39".',
    );
  }

  // --- Renglones ----------------------------------------------------------
  const lineas: LineaProforma[] = [];
  let totalCajas = 0;
  let totalPares = 0;
  let importe = 0;

  for (let i = filaEnc + 1; i < filas.length; i++) {
    const f = filas[i];
    const modeloCrudo = texto(f[colItem]);
    const colorCrudo = colColor >= 0 ? texto(f[colColor]) : "";

    // "TTL" y las notas del pie no son renglones de producto.
    if (!modeloCrudo || /^(TTL|TOTAL)$/i.test(modeloCrudo)) continue;
    if (!colorCrudo && !colsTalla.some(({ col }) => numero(f[col]) > 0)) continue;

    const tallas: Record<string, number> = {};
    let suma = 0;
    for (const { col, talla } of colsTalla) {
      const pares = numero(f[col]);
      if (pares > 0) {
        tallas[talla] = (tallas[talla] ?? 0) + pares;
        suma += pares;
      }
    }
    if (suma <= 0) continue;

    const porCaja = colPorCaja >= 0 ? numero(f[colPorCaja]) : 0;
    const cajas = colCajas >= 0 ? numero(f[colCajas]) : 0;
    const pares = colPares >= 0 ? numero(f[colPares]) : porCaja * cajas;
    const precio = colPrecio >= 0 ? numero(f[colPrecio]) : 0;

    const cuadra = porCaja === 0 || suma === porCaja;
    if (!cuadra) {
      avisos.push(
        `${modeloCrudo}: la corrida suma ${suma} pares pero "PER CTN" dice ${porCaja}. Se usa la corrida.`,
      );
    }
    if (cajas > 0 && pares > 0 && Math.abs(cajas * suma - pares) > suma) {
      avisos.push(
        `${modeloCrudo}: ${cajas} cajas × ${suma} pares dan ${cajas * suma}, pero el archivo dice ${pares}.`,
      );
    }

    lineas.push({
      modelo: modeloCrudo.toUpperCase(),
      color: colorDeProforma(colorCrudo).toUpperCase(),
      colorCrudo,
      descripcion: colDesc >= 0 ? texto(f[colDesc]) : "",
      tallas,
      paresPorCaja: suma,
      cajas,
      pares: pares || cajas * suma,
      precioUnitario: precio > 0 ? precio : null,
      cuadra,
    });

    totalCajas += cajas;
    totalPares += pares || cajas * suma;
    importe += precio * (pares || cajas * suma);
  }

  if (!lineas.length) {
    throw new Error("No encontré ningún renglón de producto con tallas en el archivo.");
  }

  // Un mismo modelo+color repetido sería ambiguo al dar de alta la corrida.
  const vistos = new Map<string, number>();
  for (const l of lineas) {
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
    lineas,
    totales: {
      cajas: totalCajas,
      pares: totalPares,
      importe: importe > 0 ? Number(importe.toFixed(2)) : null,
    },
    tallasDetectadas: [...new Set(colsTalla.map((c) => c.talla))],
    avisos,
  };
}
