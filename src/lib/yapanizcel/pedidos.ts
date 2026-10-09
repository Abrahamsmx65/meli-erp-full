/**
 * Pedidos a China ya hechos o en camino.
 *
 * Se cargan de un Excel (una línea por SKU con cantidad y, si viene, costo)
 * o se capturan a mano. Un pedido pasa por creado → en camino → recibido.
 * Mientras no esté recibido cuenta como "en camino desde China" en la
 * pantalla de compras. Recibirlo NO crea existencias: el inventario lo
 * dice el sheet.
 */
import type { DB } from "../datos/repos";
import { leerHoja as leerCeldas } from "../importar/leer-hoja";
import { conCacheYz, recalcularCacheYz } from "./cache";
import { agruparGemelas, amarreConGemelas } from "./gemelas";
import { amarrar, canonizar, claveCanonica, construirIndice, desglosar, FAMILIAS_COLOR } from "./sku";
import { todo } from "./db";

export interface LineaPedido {
  skuBodega: string;
  diseno: string;
  modelo: string;
  color: string;
  cantidad: number;
  costoUnitario: number | null;
  /** El SKU de MELI con el que amarra (lo llena `amarrarLineas`); null = no contará como en camino. */
  skuMeli?: string | null;
  /** Fila del archivo de donde salió (para los avisos). */
  fila?: number;
}

/** Una columna del archivo cuyo encabezado es un COLOR y cuyas celdas son cantidades. */
const COLOR_DESCONOCIDO = "?";

export interface PedidoLeido {
  folio: string | null;
  /** El diseño del pedido, si el archivo lo dice arriba ("款號 #499"). */
  diseno: string | null;
  fechaPedido: string | null;
  lineas: LineaPedido[];
  avisos: string[];
  unidades: number;
}

/**
 * Encabezados que se reconocen. Los pedidos reales de la fábrica vienen
 * bilingües y NO todos iguales:
 *
 * - Fundas (fixture `yz-pedido.xls`, el 499): "款號 #499" arriba (el diseño),
 *   "Model", "Total" (la CANTIDAD), "壳Case RMB" (la funda sola), "一套 Set"
 *   (funda + caja: el costo que cuenta) y "Amount" (el importe, no se lee).
 * - Micas (fixture `yz-pedido-462.xls`): "#462" arriba, la columna del
 *   modelo SIN encabezado (la primera trae la marca: Iphone, Samsung,
 *   Redmi), "Qty" (la cantidad), "RMB" (la mica sola), "Tools Kit" y
 *   "Total" que aquí es el COSTO unitario (mica + kit), no la cantidad.
 *
 * Por eso "Total" solo es cantidad cuando no hay otra columna de cantidad,
 * y cuando no lo es cuenta como costo del conjunto (después de "Set").
 * Lo chino se canoniza fuera y quedan "CASE-RMB" y "SET".
 */
const ENC = {
  sku: ["SKU", "CLAVE", "CODIGO", "CODE", "ITEM", "ITEM NO", "MODEL NO", "REF"],
  diseno: ["DISENO", "DISEÑO", "DESIGN"],
  modelo: ["MODELO", "MODEL", "PHONE MODEL", "CELULAR"],
  marca: ["MARCA", "BRAND"],
  color: ["COLOR", "COLOUR"],
  cantidad: ["CANTIDAD", "CANT", "QTY", "QUANTITY", "PCS", "PIEZAS", "PZAS", "UNIDADES"],
  // Primero el costo del conjunto; el de la funda sola solo si no hay otro.
  costo: ["SET", "COST OF SET", "SET COST", "TOTAL", "COSTO", "COSTO UNITARIO", "UNIT PRICE RMB", "UNIT PRICE", "PRECIO", "PRECIO UNITARIO", "USD", "COSTO USD", "PRICE", "CASE RMB", "CASE", "RMB"],
  folio: ["PEDIDO", "FOLIO", "ORDER", "ORDER NO", "ORDER NUMBER", "PO", "INVOICE", "INVOICE NO"],
};

/** "Total" vale como cantidad solo si no hay otra columna de cantidad. */
const CANTIDAD_RESPALDO = ["TOTAL"];

/**
 * Colores con los que la fábrica titula las columnas de cantidad, en inglés
 * (como MELI los escribe: BLK, GREEN, FUCHSIA, CREAM…) y en chino
 * (黑色, 綠, 桃紅, 米, 紫色, 透明…), a veces mezclados ("purple 紫色",
 * "Transparent透明"). La palabra en inglés manda; si solo viene en chino,
 * se traduce aquí. Lo que no está en esta lista NO es color.
 */
const COLORES_EN: readonly string[] = [
  "BLK", "BLACK", "GREEN", "FUCHSIA", "CREAM", "BEIGE", "PURPLE", "PINK", "GREY", "GRAY", "NAVY", "BLUE",
  "TRANSPARENT", "CLEAR", "WHITE", "RED", "GOLD", "SILVER", "BROWN", "YELLOW", "ORANGE", "MINT", "LILAC", "LAVENDER",
];
const COLORES_ZH: readonly [RegExp, string][] = [
  [/透明/, "TRANSPARENT"],
  [/桃紅|桃红|玫紅|玫红|玫瑰紅|玫瑰红/, "FUCHSIA"],
  [/深藍|深蓝|海軍藍|海军蓝|藏青/, "NAVY"],
  [/天藍|天蓝|淺藍|浅蓝/, "BLUE"],
  [/米白|米色|米/, "CREAM"],
  [/黑/, "BLK"],
  [/綠|绿/, "GREEN"],
  [/紫/, "PURPLE"],
  [/粉/, "PINK"],
  [/灰/, "GREY"],
  [/藍|蓝/, "BLUE"],
  [/白/, "WHITE"],
  [/紅|红/, "RED"],
  [/金/, "GOLD"],
  [/銀|银/, "SILVER"],
  [/棕|咖啡|啡/, "BROWN"],
  [/黃|黄/, "YELLOW"],
  [/橙|橘/, "ORANGE"],
];

/** El color que nombra un encabezado ("purple 紫色", "黑色", "BLK"), o null si no es un color. */
export function colorDeEncabezado(celda: string): string | null {
  const texto = String(celda ?? "").trim();
  if (!texto) return null;
  const partes = canonizar(texto).split("-").filter(Boolean);
  // Un encabezado de color es UNA palabra de color (con o sin chino pegado):
  // "Transparent透明" sí; "Cost of Set" o "Unit price" no.
  const en = partes.filter((w) => COLORES_EN.includes(w));
  if (en.length === 1 && partes.length === 1) return en[0];
  if (partes.length) return null;
  // Solo chino: tiene que ser SOLO el color (黑色, 桃紅, 深藍), no una nota
  // que lo mencione ("小單箱子用黃色膠布": cinta amarilla para la caja).
  const soloChino = texto.replace(/[\s\p{P}]/gu, "");
  if (soloChino.length > 3) return null;
  for (const [re, color] of COLORES_ZH) if (re.test(soloChino)) return color;
  return null;
}

/**
 * El modelo como lo escribe MELI, según la marca que la fábrica pone en la
 * primera columna (catálogo del 462 a la vista): iPhone lleva la "i" pegada
 * (XR → ixr, SE 2022 → ise2022, Air → iAir; I18 Pro ya la trae); iPad igual
 * (10 → iPad10); Redmi Note es Rmn CON su red, porque MELI distingue 4G y
 * 5G (Note 13 Pro 4G → Rmn13pro-4g); Redmi a secas es Rm (12C → Rm12c); Poco
 * va SIN red (Poco X8 Pro 5G → PocoX8pro, MELI no la pone). Samsung y lo
 * demás van tal cual (A57, S23 Ultra → S23ULTRA). Todo pegado sin espacios
 * ni guiones, que es como lo escriben en bodega y en MELI.
 */
export function modeloSegunMarca(marca: string, modelo: string): string {
  const pegado = canonizar(modelo).replace(/-/g, "");
  if (!pegado) return pegado;
  const m = canonizar(marca);
  if (m.startsWith("IPAD")) return pegado.startsWith("IPAD") ? pegado : `IPAD${pegado}`;
  if (/^(IPHONE|APPLE)/.test(m)) return pegado.startsWith("I") ? pegado : `I${pegado}`;
  if (/^(REDMI|XIAOMI|POCO)/.test(m)) {
    if (pegado.startsWith("POCO")) return pegado.replace(/[45]G$/, "");
    if (pegado.startsWith("NOTE")) return `RMN${pegado.slice(4)}`;
    if (/^RMN?\d/.test(pegado)) return pegado;
    return `RM${pegado}`;
  }
  return pegado;
}

/** "款號 #499", "#499", "DISEÑO 499", "Design: 499N" -> "499" / "499N". */
function disenoEnTexto(texto: string): string | null {
  const m = texto.match(/(?:#|款號|DISE[ÑN]O|DESIGN|MODELO)\s*#?\s*:?\s*(\d{2,}[A-Z]?)\b/i);
  return m ? m[1].toUpperCase() : null;
}

/** "Order number 訂單號 : 821", "PEDIDO: IN10151" -> "821" / "IN10151". */
function folioEnTexto(texto: string): string | null {
  const m = texto.match(/(?:ORDER\s*(?:NUMBER|NO\.?|#)?|PEDIDO|FOLIO|PO|INVOICE(?:\s*NO\.?)?)[^A-Z0-9]*([A-Z0-9][A-Z0-9\-\/]{1,})/i);
  return m ? m[1].toUpperCase() : null;
}

/** "Date : 20/7/2026" -> "2026-07-20". Día/mes/año, como escribe la fábrica. */
function fechaEnTexto(texto: string): string | null {
  const m = texto.match(/(?:DATE|FECHA)\s*:?\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/i);
  if (!m) return null;
  const [, d, mes, y] = m;
  return `${y}-${mes.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** Una celda que es solo la fecha ("16/9/2026"), cuando el archivo no la etiqueta. */
function fechaSuelta(celda: string): string | null {
  const m = String(celda ?? "").trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (!m) return null;
  const [, d, mes, y] = m;
  return `${y}-${mes.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function es(celda: string, opciones: string[]): boolean {
  const c = canonizar(celda);
  return opciones.some((o) => c === canonizar(o));
}

function numero(s: string): number | null {
  const limpio = String(s ?? "").replace(/[$,\s]/g, "").replace(/^USD|MXN$/i, "");
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/**
 * Las columnas, antes de `hasta`, que en los renglones de datos que siguen
 * al encabezado traen TEXTO (no números): ahí van marca y modelo.
 */
function columnasDeTexto(celdas: string[][], filaEnc: number, hasta: number): number[] {
  const out = new Set<number>();
  let vistas = 0;
  for (let r = filaEnc + 1; r < celdas.length && vistas < 6; r++) {
    const f = celdas[r] ?? [];
    if (!f.some(Boolean)) continue;
    if (/^total/i.test((f[0] ?? "").trim())) break;
    vistas++;
    for (let i = 0; i < hasta; i++) {
      const v = (f[i] ?? "").trim();
      if (v && numero(v) == null) out.add(i);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Lee el Excel del pedido por nombre de columna. */
export function leerPedidoDeCeldas(celdas: string[][]): PedidoLeido {
  let cols: Record<keyof typeof ENC, number> | null = null;
  /** Columnas cuyo encabezado es un color y cuyas celdas son cantidades. */
  let coloresQty: { col: number; color: string }[] = [];
  let filaEnc = -1;
  let folio: string | null = null;
  let disenoArchivo: string | null = null;
  let fechaPedido: string | null = null;

  // Lo que va suelto en las celdas de arriba y a la derecha: diseño, folio
  // y fecha. Se busca en TODO el archivo porque la fábrica los pone al lado
  // de la tabla, no encima.
  for (const f of celdas) {
    const texto = f.filter(Boolean).join("  ");
    if (!texto) continue;
    disenoArchivo ??= disenoEnTexto(texto);
    folio ??= folioEnTexto(texto);
    fechaPedido ??= fechaEnTexto(texto);
  }
  // Sin "Date :", una celda que es solo la fecha (el 714 la pone suelta).
  if (!fechaPedido) {
    for (const f of celdas.slice(0, 25)) {
      for (const celda of f) {
        fechaPedido ??= fechaSuelta(celda);
      }
    }
  }

  // Se evalúan TODOS los renglones de arriba y gana el que más columnas
  // reconoce: el 662 trae la fila de encabezados en chino (黑 / 綠 / 桃紅 /
  // 米 / 數量) justo arriba de la inglesa (BLK / GREEN / … / Qty / RMB /
  // Cost of Set), y una nota suelta puede parecer un encabezado de uno.
  let mejorPuntos = 0;
  for (let r = 0; r < Math.min(celdas.length, 25); r++) {
    const f = celdas[r] ?? [];
    const c = { sku: -1, diseno: -1, modelo: -1, marca: -1, color: -1, cantidad: -1, costo: -1, folio: -1 };
    f.forEach((celda, i) => {
      if (!celda) return;
      for (const k of Object.keys(ENC) as (keyof typeof ENC)[]) {
        if (c[k] >= 0 || !es(celda, ENC[k])) continue;
        // Para el costo gana el encabezado que aparece PRIMERO en la lista
        // (SET antes que CASE), no el que aparece primero en el archivo.
        if (k === "costo" && c.costo >= 0) continue;
        c[k] = i;
        return;
      }
    });
    // "Total" es la cantidad solo cuando no hay Qty / Cantidad / Pcs.
    if (c.cantidad < 0) c.cantidad = f.findIndex((celda) => celda && es(celda, CANTIDAD_RESPALDO));

    // Columnas por COLOR: la fábrica reparte la cantidad en una columna por
    // color (662: BLK / GREEN / FUCHSIA / CREAM, con "Qty" como suma) o en
    // una sola columna titulada con el único color (714, 648: "Transparent").
    const asignadas = new Set(Object.values(c).filter((i) => i >= 0));
    const colores: { col: number; color: string }[] = [];
    f.forEach((celda, i) => {
      if (asignadas.has(i)) return;
      const color = colorDeEncabezado(celda);
      if (color) colores.push({ col: i, color });
    });
    if (c.cantidad < 0 && !colores.length) continue;

    // Hasta dónde buscar texto (marca, modelo): antes de la primera columna numérica.
    const numericas = [c.cantidad, c.costo, ...colores.map((x) => x.col)].filter((i) => i >= 0);
    const limite = Math.min(...numericas);

    // Sin encabezado de SKU ni de modelo (el 462 pone "#462" arriba de la
    // marca y deja la columna del modelo sin título): el modelo es la
    // columna de TEXTO más a la derecha antes de la primera numérica, y la
    // marca la de texto anterior. Se mira en los renglones de datos.
    const deTexto = columnasDeTexto(celdas, r, limite).filter((i) => !asignadas.has(i));
    if (c.sku < 0 && c.modelo < 0) {
      if (!deTexto.length) continue;
      c.modelo = deTexto[deTexto.length - 1];
      deTexto.pop();
    }
    // La marca: la columna de texto inmediatamente a la izquierda del modelo
    // (o del SKU), si no tiene otro encabezado reconocido.
    const ancla = c.modelo >= 0 ? c.modelo : c.sku;
    if (c.marca < 0) {
      const izq = deTexto.filter((i) => i < ancla);
      if (izq.length) c.marca = izq[izq.length - 1];
    }

    // Una columna de cantidades SIN encabezado en medio de las de color (el
    // 686 trae 黑色 | (nada) | purple | Pink | Grey): es un color que el
    // archivo no nombra; se deduce al amarrar o lo escribe el usuario.
    if (colores.length) {
      const desde = Math.min(...colores.map((x) => x.col));
      const hasta = c.cantidad >= 0 ? c.cantidad : Math.max(...colores.map((x) => x.col)) + 1;
      for (let i = desde; i < hasta; i++) {
        if (asignadas.has(i) || colores.some((x) => x.col === i) || (f[i] ?? "").trim()) continue;
        if (columnaNumerica(celdas, r, i)) colores.push({ col: i, color: COLOR_DESCONOCIDO });
      }
      colores.sort((a, b) => a.col - b.col);
    }

    // Si hay varias columnas de costo, prefiere la mejor de la lista; con
    // varias iguales (648: RMB mica, RMB caja, RMB set) gana la de más a la
    // DERECHA, que es el conjunto. La columna de la cantidad nunca es costo.
    let mejor = -1;
    let mejorPos = Infinity;
    f.forEach((celda, i) => {
      if (!celda || i === c.cantidad) return;
      const pos = ENC.costo.findIndex((e) => es(celda, [e]));
      if (pos >= 0 && pos <= mejorPos) {
        mejorPos = pos;
        mejor = i;
      }
    });
    c.costo = mejor;
    const puntos = [c.sku, c.diseno, c.modelo, c.color, c.cantidad, c.costo, c.folio].filter((i) => i >= 0).length + colores.length;
    if (puntos > mejorPuntos) {
      mejorPuntos = puntos;
      cols = c;
      coloresQty = colores;
      filaEnc = r;
    }
  }

  if (!cols) {
    throw new Error("No se encontró el renglón de encabezados. Se esperan columnas como SKU (o MODELO / Model) y CANTIDAD (o Total / Qty / una columna por color).");
  }

  const lineas: LineaPedido[] = [];
  const avisos: string[] = [];
  const vistos = new Map<string, number>();
  // Con UNA sola columna de color el SKU va sin color (714-A37, 648-A07);
  // la mayoría de esos modelos en MELI no lo llevan y, si alguno sí
  // (714-G05-transparent), el amarre lo prueba con el color.
  const colorEnSku = coloresQty.length > 1;

  const agregar = (fila: number, skuBodega: string, diseno: string, modelo: string, color: string, cantidad: number, costo: number | null) => {
    const d = desglosar(skuBodega);
    const i = vistos.get(skuBodega);
    if (i != null) {
      lineas[i].cantidad += Math.round(cantidad);
      avisos.push(`Fila ${fila + 1}: ${skuBodega} repetido; se sumó.`);
      return;
    }
    vistos.set(skuBodega, lineas.length);
    lineas.push({
      skuBodega,
      diseno: diseno || d.diseno,
      modelo: modelo || d.modelo,
      color: color || d.color,
      cantidad: Math.max(0, Math.round(cantidad)),
      costoUnitario: costo,
      fila,
    });
  };

  for (let r = filaEnc + 1; r < celdas.length; r++) {
    const f = celdas[r] ?? [];
    const sku = cols.sku >= 0 ? (f[cols.sku] ?? "").trim() : "";
    const modelo = cols.modelo >= 0 ? (f[cols.modelo] ?? "").trim() : "";
    const marca = cols.marca >= 0 ? (f[cols.marca] ?? "").trim() : "";
    const color = cols.color >= 0 ? (f[cols.color] ?? "").trim() : "";
    const disenoCol = cols.diseno >= 0 ? (f[cols.diseno] ?? "").trim() : "";
    if (!sku && !modelo) continue;
    if (/^total/i.test(sku) || /^total/i.test(modelo) || /^total/i.test((f[0] ?? "").trim())) continue;
    if (cols.folio >= 0 && !folio && (f[cols.folio] ?? "").trim()) folio = (f[cols.folio] ?? "").trim().toUpperCase();

    // El modelo se pega sin espacios ni guiones ("I17 Pro Max" -> I17PROMAX),
    // que es como lo escriben en bodega y en MELI (499-i17promax), y la
    // marca le pone lo que MELI le pone (XR -> IXR, Note 13 -> RMN13).
    const modeloPegado = modeloSegunMarca(marca, modelo);
    const diseno = canonizar(disenoCol) || disenoArchivo || "";
    const costo = cols.costo >= 0 ? numero(f[cols.costo] ?? "") : null;
    const base = sku ? claveCanonica(sku) : [diseno, modeloPegado, canonizar(color)].filter(Boolean).join("-");
    if (!base) continue;

    if (coloresQty.length) {
      // Una línea por color con cantidad; la columna de suma (Qty / Total)
      // solo sirve para avisar si no cuadra.
      let suma = 0;
      for (const { col, color: nombre } of coloresQty) {
        const txt = (f[col] ?? "").trim();
        if (!txt) continue;
        const n = numero(txt);
        if (n == null) {
          avisos.push(`Fila ${r + 1}: cantidad no numérica "${txt}" en la columna ${nombre}.`);
          continue;
        }
        if (n <= 0) continue;
        suma += n;
        const skuBodega = colorEnSku ? `${base}-${nombre}` : base;
        agregar(r, skuBodega, diseno, modeloPegado, nombre, n, costo);
      }
      if (cols.cantidad >= 0) {
        const total = numero(f[cols.cantidad] ?? "");
        if (total != null && suma && Math.round(total) !== Math.round(suma)) {
          avisos.push(`Fila ${r + 1}: los colores suman ${suma} pero la columna de total dice ${total}; se tomaron los colores.`);
        }
      }
      continue;
    }

    const cantTxt = f[cols.cantidad] ?? "";
    const cantidad = numero(cantTxt);
    if (cantidad == null) {
      if (cantTxt.trim()) avisos.push(`Fila ${r + 1}: cantidad no numérica "${cantTxt}".`);
      continue;
    }
    agregar(r, base, diseno, modeloPegado, canonizar(color), cantidad, costo);
  }

  if (!lineas.length) throw new Error("El archivo se leyó pero no traía ninguna línea con modelo y cantidad.");
  if (!disenoArchivo && lineas.some((l) => !l.diseno)) {
    avisos.push("El archivo no dice de qué diseño es (se esperaba algo como \"#499\" arriba): revisa los SKUs antes de confirmar.");
  }
  const sinColor = lineas.filter((l) => l.color === COLOR_DESCONOCIDO);
  if (sinColor.length) {
    avisos.push(
      `El archivo trae una columna de cantidades sin nombre de color (${sinColor.reduce((a, l) => a + l.cantidad, 0)} piezas): si en MELI solo falta un color del modelo, se toma ese; si no, escribe el SKU en el renglón.`,
    );
  }
  return { folio, diseno: disenoArchivo, fechaPedido, lineas, avisos, unidades: lineas.reduce((a, l) => a + l.cantidad, 0) };
}

/** true si la columna trae algún número en los renglones de datos. */
function columnaNumerica(celdas: string[][], filaEnc: number, col: number): boolean {
  let vistas = 0;
  for (let r = filaEnc + 1; r < celdas.length && vistas < 12; r++) {
    const f = celdas[r] ?? [];
    if (!f.some(Boolean)) continue;
    vistas++;
    const v = (f[col] ?? "").trim();
    if (v && numero(v) != null) return true;
  }
  return false;
}

export async function leerPedido(buffer: ArrayBuffer | Buffer, nombre?: string): Promise<PedidoLeido> {
  const celdas = await leerCeldas(buffer, { nombre });
  return leerPedidoDeCeldas(celdas);
}

/**
 * Amarra SKUs de bodega contra el catálogo de MELI (mismos niveles que el
 * sheet de bodega y que `cargarPedidosEnCamino`): SKU → SKU de MELI o null.
 */
export async function amarrarSkus(db: DB, accountId: string, skus: string[]): Promise<Map<string, string | null>> {
  const [catalogo, mapeos] = await Promise.all([
    todo<{ sku: string; estado: string | null }>(db, "yz_skus", "sku, estado", (q) => q.eq("account_id", accountId)),
    todo<{ sku_bodega: string; sku_meli: string }>(db, "yz_mapeo_skus", "sku_bodega, sku_meli", (q) => q.eq("account_id", accountId)),
  ]);
  const indice = construirIndice(catalogo.map((s) => s.sku));
  const manual = new Map(mapeos.map((m) => [m.sku_bodega, m.sku_meli]));
  // El pedido dice "462-A57"; lo que cuenta es la gemela principal (N-462-A57).
  const gemelas = agruparGemelas(catalogo);
  return new Map(skus.map((sku) => [sku, amarreConGemelas(amarrar(sku, indice, manual), gemelas).skuMeli]));
}

/**
 * Amarra cada línea leída y avisa de las que no amarran: esas se guardarían
 * igual pero NUNCA contarían como en camino, y antes nadie se enteraba
 * hasta que el plan salía corto. La pantalla las pinta en rojo y deja
 * corregir el SKU ahí mismo.
 */
export async function amarrarLineas(db: DB, accountId: string, pedido: PedidoLeido): Promise<PedidoLeido> {
  const [catalogo, mapeos] = await Promise.all([
    todo<{ sku: string; estado: string | null }>(db, "yz_skus", "sku, estado", (q) => q.eq("account_id", accountId)),
    todo<{ sku_bodega: string; sku_meli: string }>(db, "yz_mapeo_skus", "sku_bodega, sku_meli", (q) => q.eq("account_id", accountId)),
  ]);
  return amarrarLineasCon(pedido, catalogo, mapeos);
}

/** La parte pura de `amarrarLineas`, con el catálogo ya en mano (para probarla). */
export function amarrarLineasCon(
  pedido: PedidoLeido,
  catalogo: { sku: string; estado?: string | null }[],
  mapeos: { sku_bodega: string; sku_meli: string }[] = [],
): PedidoLeido {
  const indice = construirIndice(catalogo.map((s) => s.sku));
  const manual = new Map(mapeos.map((m) => [m.sku_bodega, m.sku_meli]));
  const gemelas = agruparGemelas(catalogo);
  const resolver = (sku: string) => amarreConGemelas(amarrar(sku, indice, manual), gemelas).skuMeli;
  const avisos = [...pedido.avisos];

  // Colores que MELI tiene por diseño + modelo, para deducir la columna sin nombre.
  const coloresMeli = new Map<string, Set<string>>();
  for (const { sku } of catalogo) {
    const d = desglosar(sku);
    if (!d.color) continue;
    const k = `${canonizar(d.diseno)}|${canonizar(d.modelo).replace(/-/g, "")}`;
    coloresMeli.set(k, (coloresMeli.get(k) ?? new Set()).add(d.color));
  }

  const lineas = pedido.lineas.map((l) => {
    let skuBodega = l.skuBodega;
    let color = l.color;
    if (color === COLOR_DESCONOCIDO) {
      // El único color del modelo en MELI que las hermanas del archivo no nombran.
      const k = `${canonizar(l.diseno)}|${canonizar(l.modelo).replace(/-/g, "")}`;
      const nombrados = new Set(
        pedido.lineas.filter((h) => h.diseno === l.diseno && h.modelo === l.modelo && h.color !== COLOR_DESCONOCIDO).map((h) => claveColorFamilia(h.color)),
      );
      const faltan = [...(coloresMeli.get(k) ?? [])].filter((c) => !nombrados.has(claveColorFamilia(c)));
      if (faltan.length === 1) {
        color = faltan[0].toUpperCase();
        skuBodega = skuBodega.replace(/-\?$/, `-${color}`);
        avisos.push(`Fila ${(l.fila ?? 0) + 1}: la columna sin nombre se tomó como ${color}, el único color de ${l.diseno}-${l.modelo} en MELI que el archivo no nombra.`);
      }
    }
    let skuMeli = resolver(skuBodega);
    // Con una sola columna de color el SKU va sin color; si MELI sí lo lleva
    // (714-G05-transparent), se prueba con él y se adopta.
    if (!skuMeli && color && color !== COLOR_DESCONOCIDO && !skuBodega.toUpperCase().endsWith(`-${color.toUpperCase()}`)) {
      const conColor = `${skuBodega}-${color}`;
      const m = resolver(conColor);
      if (m) {
        skuBodega = conColor;
        skuMeli = m;
      }
    }
    return { ...l, skuBodega, color, skuMeli };
  });

  const sueltas = lineas.filter((l) => !l.skuMeli);
  if (sueltas.length) {
    avisos.push(
      `${sueltas.length} línea(s) en rojo no amarran con ningún SKU de MELI y no contarán como en camino: corrige el SKU en el renglón (o amárralo en SKUs).`,
    );
  }
  return { ...pedido, lineas, avisos };
}

/** BLACK y BLK, NAVY y BLUE son el mismo color para comparar. */
function claveColorFamilia(color: string): string {
  const c = canonizar(color);
  for (const familia of FAMILIAS_COLOR) if (familia.includes(c)) return familia[0];
  return c;
}

export interface PedidoResumen {
  id: string;
  folio: string;
  proveedor: string | null;
  estado: string;
  fecha_pedido: string | null;
  fecha_estimada: string | null;
  nota: string | null;
  creado_en: string;
  unidades: number;
  recibidas: number;
  lineas: number;
  disenos: string[];
}

async function calcularListaPedidos(db: DB, accountId: string): Promise<PedidoResumen[]> {
  const { data: cab } = await db
    .from("yz_pedidos")
    .select("id, folio, proveedor, estado, fecha_pedido, fecha_estimada, nota, creado_en")
    .eq("account_id", accountId)
    .order("creado_en", { ascending: false })
    .limit(200);
  const ids = (cab ?? []).map((c) => c.id);
  const lineas = ids.length
    ? await todo<{ pedido_id: string; cantidad: number; recibido: number; diseno: string | null }>(db, "yz_pedido_lineas", "pedido_id, cantidad, recibido, diseno", (q) => q.in("pedido_id", ids))
    : [];

  const porPedido = new Map<string, { pedido_id: string; cantidad: number; recibido: number; diseno: string | null }[]>();
  for (const l of lineas) porPedido.set(l.pedido_id, [...(porPedido.get(l.pedido_id) ?? []), l]);

  return (cab ?? []).map((c) => {
    const suyas = porPedido.get(c.id) ?? [];
    return {
      ...c,
      unidades: suyas.reduce((a, l) => a + l.cantidad, 0),
      recibidas: suyas.reduce((a, l) => a + (l.recibido ?? 0), 0),
      lineas: suyas.length,
      disenos: [...new Set(suyas.map((l) => l.diseno).filter(Boolean) as string[])].sort(),
    };
  });
}

/**
 * La lista masticada desde `yz_cache` ("pedidos"), aunque esté vieja; la
 * invalidan las rutas que escriben pedidos y el cron la refresca.
 */
export async function listarPedidos(db: DB, accountId: string): Promise<PedidoResumen[]> {
  return conCacheYz(db, accountId, "pedidos", () => calcularListaPedidos(db, accountId));
}

/** Recalcula y guarda la lista (lo llama el cron de netos). */
export async function recalcularListaPedidos(db: DB, accountId: string): Promise<PedidoResumen[]> {
  return recalcularCacheYz(db, accountId, "pedidos", () => calcularListaPedidos(db, accountId));
}

export async function crearPedido(
  db: DB,
  accountId: string,
  pedido: { folio: string; proveedor?: string; fechaPedido?: string; fechaEstimada?: string; nota?: string; estado?: string },
  lineas: LineaPedido[],
): Promise<{ id: string }> {
  const folio = pedido.folio.trim().toUpperCase();
  if (!folio) throw new Error("El pedido necesita un folio.");
  const limpias = lineas.filter((l) => l.skuBodega && l.cantidad > 0);
  if (!limpias.length) throw new Error("El pedido no trae líneas con cantidad.");

  const { data: cab, error } = await db
    .from("yz_pedidos")
    .insert({
      account_id: accountId,
      folio,
      proveedor: pedido.proveedor?.trim() || null,
      estado: pedido.estado ?? "creado",
      fecha_pedido: pedido.fechaPedido || null,
      fecha_estimada: pedido.fechaEstimada || null,
      nota: pedido.nota?.trim() || null,
    })
    .select("id")
    .single();
  if (error || !cab) {
    if (error?.code === "23505") throw new Error(`Ya existe un pedido con el folio ${folio}.`);
    throw new Error(error?.message ?? "No se pudo crear el pedido.");
  }

  const { error: e2 } = await db.from("yz_pedido_lineas").insert(
    limpias.map((l) => ({
      pedido_id: cab.id,
      sku_bodega: l.skuBodega,
      diseno: l.diseno || null,
      modelo: l.modelo || null,
      color: l.color || null,
      cantidad: l.cantidad,
      costo_unitario: l.costoUnitario,
    })),
  );
  if (e2) throw new Error(e2.message);
  return { id: cab.id };
}

export async function cambiarEstadoPedido(db: DB, accountId: string, id: string, estado: "creado" | "en_camino" | "recibido" | "cancelado"): Promise<void> {
  const { error } = await db
    .from("yz_pedidos")
    .update({ estado, actualizado_en: new Date().toISOString() })
    .eq("account_id", accountId)
    .eq("id", id);
  if (error) throw new Error(error.message);
  // Recibido = todas las líneas recibidas completas.
  if (estado === "recibido") {
    const lineas = await todo<{ id: string; cantidad: number }>(db, "yz_pedido_lineas", "id, cantidad", (q) => q.eq("pedido_id", id));
    for (const l of lineas) await db.from("yz_pedido_lineas").update({ recibido: l.cantidad }).eq("id", l.id);
  }
}

export async function eliminarPedido(db: DB, accountId: string, id: string): Promise<void> {
  const { error } = await db.from("yz_pedidos").delete().eq("account_id", accountId).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function lineasDePedido(db: DB, id: string) {
  return todo<{ id: string; sku_bodega: string; diseno: string | null; modelo: string | null; color: string | null; cantidad: number; recibido: number; costo_unitario: number | null }>(
    db, "yz_pedido_lineas", "id, sku_bodega, diseno, modelo, color, cantidad, recibido, costo_unitario", (q) => q.eq("pedido_id", id).order("sku_bodega"),
  );
}
