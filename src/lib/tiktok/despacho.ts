/**
 * El orden del despacho: PRIMERO lo de un solo modelo, luego lo revuelto, y
 * dentro de cada bloque por modelo, luego color, luego talla.
 *
 * El bloque de UN MODELO es todo lo que se empaca sin pensar: un paquete de
 * una pieza, o de varias del mismo modelo (dos GT114 en el mismo envío
 * siguen siendo un modelo). Lo REVUELTO —dos modelos distintos en la misma
 * caja— se deja para el final, junto, porque es lo que hay que armar con
 * cuidado (decisión del dueño, 14-sep-2026: así se prepara más rápido).
 *
 * Dentro de cada bloque es el orden en que se camina la bodega: todos los
 * GT135 juntos, dentro de ellos por color, y dentro del color de la talla
 * chica a la grande. La lista de empaque y el PDF de etiquetas van en ESTE
 * orden y con LOS MISMOS números, para que la etiqueta #12 sea el renglón
 * #12 sin buscar.
 *
 * Y por eso mismo el orden NO se le cambia a un corte ya hecho: sus hojas
 * están impresas y a medio preparar, y renumerarlas dejaría el papel de la
 * mesa sin cuadrar. Cada corte guarda con qué orden nació
 * (`tiktok_cortes.orden_paquetes`) y se vuelve a armar siempre con ese; los
 * de antes del 14-sep-2026 se quedan con el suyo ("bodega").
 */
import { codigosDeProducto } from "./codigos";


export interface ParDespacho {
  /** SKU del ERP (MODELO-COLOR-TALLA); si no se amarró, el de TikTok */
  sku: string;
  pares: number;
  /** el código de barras que trae la caja del zapato (FNSKU de Amazon); null si no se conoce */
  fnsku?: string | null;
  /**
   * Otros códigos que también son de ESTE producto y por lo tanto también
   * lo dan por bueno en la estación: el código Full de MELI de la cuenta de
   * calzado y el de la de fundas. La caja puede traer pegada cualquiera de
   * las tres etiquetas.
   */
  codigos?: string[] | null;
}

/**
 * Identificador del paquete dentro del corte (`TT7-12`). La lista y la
 * etiqueta llevan como código de barras el FNSKU del producto —decisión del
 * dueño: hoja, guía y caja con el mismo código—; este se usa solo cuando el
 * producto no tiene FNSKU, y la estación lo acepta siempre.
 */
export function codigoDeHoja(corte: number, numero: number): string {
  return `TT${corte}-${numero}`;
}

export function parsearCodigoDeHoja(codigo: string): { corte: number; numero: number } | null {
  const m = /^TT(\d+)-(\d+)$/i.exec(String(codigo ?? "").trim());
  if (!m) return null;
  return { corte: Number(m[1]), numero: Number(m[2]) };
}

/**
 * Con qué orden se numeró el corte: "bodega" es el de siempre (modelo →
 * color → talla) y "un-modelo" el nuevo (primero lo de un solo modelo, al
 * final lo revuelto). Lo guarda el corte al nacer.
 */
export type OrdenPaquetes = "bodega" | "un-modelo";

/** El orden con el que nacen los cortes nuevos. */
export const ORDEN_ACTUAL: OrdenPaquetes = "un-modelo";

export interface PaqueteDespacho {
  orderId: string;
  packageId: string;
  destinatario: string | null;
  pares: ParDespacho[];
}

export interface PaqueteNumerado extends PaqueteDespacho {
  /** el número que se imprime en la etiqueta y en la lista */
  numero: number;
  modelo: string;
  color: string;
  talla: string;
  /** true si el paquete lleva DOS modelos distintos o más */
  revuelto: boolean;
}

/**
 * La identidad del paquete: el pedido y su paquete de TikTok. Es lo que
 * guarda la constancia de preparado (`tiktok_preparaciones`), y por eso lo
 * que se compara: el "#n" es solo el lugar que le tocó en la hoja de HOY y
 * cambia si cambia el orden.
 */
export function clavePaquete(p: { orderId: string; packageId?: string | null }): string {
  return `${p.orderId}|${p.packageId ?? ""}`;
}

/** Los modelos distintos que lleva el paquete. */
export function modelosDePaquete(p: { pares: ParDespacho[] }): string[] {
  const modelos = new Set<string>();
  for (const x of p.pares) modelos.add(partirSku(x.sku).modelo);
  return [...modelos];
}

/**
 * ¿El paquete es de UN SOLO modelo? Una pieza sola, dos pares del mismo
 * zapato o dos tallas del mismo modelo cuentan como uno; dos modelos
 * distintos, no.
 */
export function esDeUnModelo(p: { pares: ParDespacho[] }): boolean {
  return modelosDePaquete(p).length <= 1;
}

/** MODELO-COLOR-TALLA → sus tres pedazos; lo que no cuadre se va al final. */
export function partirSku(sku: string): { modelo: string; color: string; talla: string } {
  const partes = String(sku ?? "").trim().split("-").filter(Boolean);
  // Sufijo de país al final (GT135-DK BROWN-26-MX): fuera.
  if (partes.length >= 4 && /^(MX|MLM|US)$/i.test(partes[partes.length - 1])) partes.pop();
  if (partes.length < 3) {
    return { modelo: partes[0] ?? "", color: partes.slice(1).join("-"), talla: "" };
  }
  return {
    modelo: partes[0],
    color: partes.slice(1, -1).join("-"),
    talla: partes[partes.length - 1],
  };
}

function tallaNumerica(t: string): number {
  const n = Number(String(t).replace(",", "."));
  return Number.isFinite(n) ? n : 999;
}

function compararSku(a: string, b: string): number {
  const x = partirSku(a);
  const y = partirSku(b);
  return (
    x.modelo.localeCompare(y.modelo, "es") ||
    x.color.localeCompare(y.color, "es") ||
    tallaNumerica(x.talla) - tallaNumerica(y.talla) ||
    a.localeCompare(b, "es")
  );
}

/**
 * Ordena y numera los paquetes. Con el orden "un-modelo": PRIMERO los de un
 * solo modelo y luego los revueltos, y dentro de cada bloque por su PRIMER
 * par (ya ordenado); un paquete con dos tallas cae donde cae la menor. Con
 * "bodega" (el de los cortes de antes) va todo en un solo bloque, para que
 * sus números sigan siendo los que ya se imprimieron.
 */
export function numerarPaquetes(
  paquetes: PaqueteDespacho[],
  orden: OrdenPaquetes = "bodega",
): PaqueteNumerado[] {
  const conOrden = paquetes.map((p) => ({
    ...p,
    pares: [...p.pares].sort((a, b) => compararSku(a.sku, b.sku)),
  }));
  const bloque = (p: PaqueteDespacho) =>
    orden === "un-modelo" && !esDeUnModelo(p) ? 1 : 0;
  conOrden.sort(
    (a, b) =>
      bloque(a) - bloque(b) ||
      compararSku(a.pares[0]?.sku ?? "", b.pares[0]?.sku ?? "") ||
      a.orderId.localeCompare(b.orderId),
  );
  return conOrden.map((p, i) => {
    const primero = partirSku(p.pares[0]?.sku ?? "");
    return { ...p, numero: i + 1, ...primero, revuelto: !esDeUnModelo(p) };
  });
}

/**
 * Los números que les tocan HOY a los paquetes que ya se prepararon. La
 * constancia se guarda por pedido + paquete, así que cambiar el orden no la
 * pierde: aquí se traduce a los "#n" de esta hoja.
 *
 * Un pedido de un solo paquete se reconoce también por el pedido a secas:
 * cuando se preparó, TikTok podía no haber dado todavía el id del paquete
 * (se guardó vacío) y hoy sí darlo, o al revés.
 */
export function numerosPreparados(paquetes: PaqueteNumerado[], claves: Iterable<string>): number[] {
  const porClave = new Map<string, PaqueteNumerado>();
  const porOrden = new Map<string, PaqueteNumerado[]>();
  for (const p of paquetes) {
    porClave.set(clavePaquete(p), p);
    const l = porOrden.get(p.orderId) ?? [];
    l.push(p);
    porOrden.set(p.orderId, l);
  }
  const numeros = new Set<number>();
  for (const clave of claves) {
    const exacto = porClave.get(clave);
    if (exacto) {
      numeros.add(exacto.numero);
      continue;
    }
    const orderId = String(clave).split("|")[0];
    const unicos = porOrden.get(orderId);
    if (unicos && unicos.length === 1) numeros.add(unicos[0].numero);
  }
  return [...numeros].sort((a, b) => a - b);
}

/** El texto que va abajo a la derecha de la etiqueta: "#12 · GT135-DK BROWN-26 ×2". */
export function textoDeEtiqueta(p: PaqueteNumerado): string {
  const skus = p.pares.map((x) => (x.pares > 1 ? `${x.sku} ×${x.pares}` : x.sku)).join(" · ");
  return `#${p.numero} · ${skus}`;
}

/**
 * El código de barras de la etiqueta: el FNSKU del producto, que es el
 * mismo que trae la caja del zapato. Si el producto no tiene FNSKU
 * conocido, va el código Full de MELI (la otra etiqueta que puede traer
 * pegada) y, si tampoco, el código de hoja, que al menos identifica el
 * paquete.
 */
export function codigoDeEtiqueta(p: PaqueteNumerado, corte: number): string {
  for (const x of p.pares) {
    const c = codigosDeProducto(x)[0];
    if (c) return c;
  }
  return codigoDeHoja(corte, p.numero);
}

export interface RenglonDeEtiqueta {
  sku: string;
  pares: number;
  /** "#7 · GT134-NAVY-24-MX ×2" */
  texto: string;
  /** FNSKU del producto o, si Amazon no lo tiene, el código de hoja */
  codigo: string;
  /** true si el código es el de hoja (el producto no tiene FNSKU) */
  esHoja: boolean;
}

/** El número de pedido de TikTok como código de barras: sus dígitos tal cual. */
export function codigoDeOrden(orderId: string): string {
  return String(orderId ?? "").replace(/\D/g, "");
}

/** ¿Este escaneo es un número de pedido de TikTok? (15 dígitos o más, puros números) */
export function parsearCodigoDeOrden(codigo: string): string | null {
  const t = String(codigo ?? "").trim();
  return /^\d{15,}$/.test(t) ? t : null;
}

/**
 * Un renglón POR SKU del paquete, cada uno con su propio código: un pedido
 * con dos productos lleva dos códigos en la guía y dos renglones en la
 * hoja. El primero lleva el "#n"; los demás lo repiten en gris en la hoja
 * y lo omiten en la guía para no repetir.
 *
 * El código de producto es SIEMPRE el FNSKU (decisión del dueño: la caja
 * lleva la etiqueta de Amazon). Si un color se llama distinto en Amazon,
 * la equivalencia por modelo (`tiktok_alias_amazon`) lo resuelve antes de
 * llegar aquí. Sin FNSKU va el código de hoja, que al menos identifica el
 * paquete.
 */
export function renglonesDeEtiqueta(p: PaqueteNumerado, corte: number): RenglonDeEtiqueta[] {
  return p.pares.map((x, i) => {
    const propio = codigosDeProducto(x)[0] ?? null;
    return {
      sku: x.sku,
      pares: x.pares,
      texto: `${i === 0 ? `#${p.numero} · ` : ""}${x.sku}${x.pares > 1 ? ` ×${x.pares}` : ""}`,
      codigo: propio ?? codigoDeHoja(corte, p.numero),
      esHoja: !propio,
    };
  });
}

export interface GrupoModelo {
  modelo: string;
  pares: number;
  paquetes: PaqueteNumerado[];
  /** true si es la sección de los paquetes con varios modelos */
  revuelto: boolean;
}

/** El título de la sección de los paquetes con varios modelos. */
export const GRUPO_REVUELTOS = "Revueltos";

/**
 * La lista de empaque: por modelo, en el mismo orden y con los mismos
 * números. Con el orden "un-modelo" los paquetes revueltos (dos modelos o
 * más) van todos juntos al final, en UNA sección: no se mezclan con la del
 * modelo de su primer par, que se empaca de corrido. Un corte viejo se
 * agrupa como siempre, para que su lista salga igual que la impresa.
 */
export function agruparPorModelo(
  numerados: PaqueteNumerado[],
  orden: OrdenPaquetes = "bodega",
): GrupoModelo[] {
  const grupos: GrupoModelo[] = [];
  const separar = orden === "un-modelo";
  for (const p of numerados) {
    const ultimo = grupos[grupos.length - 1];
    const pares = p.pares.reduce((a, x) => a + x.pares, 0);
    const modelo = separar && p.revuelto ? GRUPO_REVUELTOS : p.modelo;
    const revuelto = separar && p.revuelto;
    if (ultimo && ultimo.modelo === modelo && ultimo.revuelto === revuelto) {
      ultimo.paquetes.push(p);
      ultimo.pares += pares;
    } else {
      grupos.push({ modelo, pares, paquetes: [p], revuelto });
    }
  }
  return grupos;
}
