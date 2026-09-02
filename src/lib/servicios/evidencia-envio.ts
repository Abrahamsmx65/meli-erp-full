/**
 * La solicitud de revisión de medidas que se le manda a MELI.
 *
 * Cuando una publicación de Full quedó mal medida, MELI pide DOS cosas para
 * corregirla: un Excel con un renglón por publicación —Item ID, Site y las
 * medidas correctas (largo, alto, ancho en cm y peso en g)— y un link a una
 * imagen de evidencia de esas medidas.
 *
 * Aquí se arma lo puro (se prueba sin tocar MELI ni la base):
 *
 *   · `filasSolicitudMeli`: los renglones del Excel. Un renglón por
 *     publicación (Item ID), no por SKU: la publicación con variantes tiene
 *     muchas tallas dentro y MELI la corrige por publicación. La medida que
 *     se pide es la de consenso del modelo, la que miden las hermanas.
 *   · `datosEvidencia`: lo que va dibujado en la ficha de evidencia del
 *     modelo. NO es una foto inventada: es la tabla de lo que MELI MISMO
 *     midió en cada talla del modelo (atributos PACKAGE_*, fuente
 *     MEASUREMENT), con la medida de consenso y las tallas que se salen. La
 *     evidencia es real porque los datos son de MELI; solo el dibujo es
 *     generado.
 *   · `huellaEvidencia`: para no volver a dibujar y subir la misma ficha si
 *     nada cambió desde la última vez.
 *
 * La ficha se dibuja en `evidencia-envio-imagen.tsx` (con `next/og`) y se
 * sube al bucket público `evidencia-envio`; la URL queda en la tabla
 * `evidencia_envio` y de ahí la toma el Excel.
 */
import type { Medida, ModeloRevisado, VarianteRevisada } from "./costos-envio";

// ---------------------------------------------------------------------------
// El Excel que pide MELI
// ---------------------------------------------------------------------------
export interface FilaSolicitudMeli {
  itemId: string;
  site: string;
  largo: number;
  alto: number;
  ancho: number;
  peso: number;
  /** link público a la ficha de evidencia del modelo; "" si aún no se genera */
  evidencia: string;
  // Lo que sigue NO va en las columnas obligatorias de MELI: es contexto para
  // la hoja de detalle y para que el que arma el caso sepa qué es cada línea.
  modelo: string;
  skus: string[];
  /** cuántas tallas de esa publicación cobran de más */
  malas: number;
  /** suma del sobrecosto por venta de las tallas malas de esa publicación */
  sobrecosto: number;
}

/** Un decimal, para enseñar lo que MELI tiene registrado tal cual. */
const unDecimal = (n: number) => Math.round(n * 10) / 10;

/**
 * La medida que se le PIDE a MELI va en centímetros y gramos completos,
 * redondeados hacia abajo: su formato no acepta decimales, y una caja de
 * 27.5 se pide como 27, nunca como 28 (pedir de más es pagar de más).
 */
export function medidaEntera(m: Medida): Medida {
  return {
    largo: Math.floor(m.largo),
    ancho: Math.floor(m.ancho),
    alto: Math.floor(m.alto),
    peso: Math.floor(m.peso),
  };
}

/**
 * El site sale del prefijo del Item ID (MLM1234 → MLM). Se prefiere al de la
 * cuenta por si algún día una cuenta tuviera publicaciones de otro sitio; si
 * el id no trae letras se usa el de la cuenta.
 */
export function siteDeItem(itemId: string, sitePorDefecto: string): string {
  const m = itemId.trim().toUpperCase().match(/^([A-Z]{3})\d+$/);
  return m ? m[1] : sitePorDefecto;
}

/**
 * Los renglones del Excel de MELI: uno por publicación mal medida.
 *
 * Solo entran las publicaciones con alguna talla que cobra de más y con
 * medida de consenso (sin tres hermanas no hay medida real que pedir). Si
 * varias tallas malas comparten publicación, salen UNA vez con la medida del
 * modelo. Van ordenadas como la revisión: primero donde hay más dinero.
 */
export function filasSolicitudMeli(
  modelos: ModeloRevisado[],
  site: string,
  evidencias: Map<string, string> = new Map(),
): FilaSolicitudMeli[] {
  const salida: FilaSolicitudMeli[] = [];
  for (const m of modelos) {
    if (!m.medidaReal) continue;
    const porItem = new Map<string, VarianteRevisada[]>();
    for (const v of m.malas) {
      if (!v.itemId) continue;
      const lista = porItem.get(v.itemId);
      if (lista) lista.push(v);
      else porItem.set(v.itemId, [v]);
    }
    const entera = medidaEntera(m.medidaReal);
    for (const [itemId, malas] of porItem) {
      salida.push({
        itemId,
        site: siteDeItem(itemId, site),
        largo: entera.largo,
        alto: entera.alto,
        ancho: entera.ancho,
        peso: entera.peso,
        evidencia: evidencias.get(m.modelo) ?? "",
        modelo: m.modelo,
        skus: malas.map((v) => v.sku),
        malas: malas.length,
        sobrecosto: Math.round(malas.reduce((a, v) => a + v.sobrecosto, 0) * 100) / 100,
      });
    }
  }
  return salida;
}

// ---------------------------------------------------------------------------
// La ficha de evidencia del modelo
// ---------------------------------------------------------------------------
export interface RenglonEvidencia {
  sku: string;
  talla: string;
  color: string;
  itemId: string;
  /** "27 × 24 × 10" ya con los lados de mayor a menor */
  medida: string;
  peso: number | null;
  costo: number | null;
  /** cobra de más: es la que se pide corregir */
  mala: boolean;
  /** true si la medida la tomó MELI en Full (PACKAGE_DATA_SOURCE = MEASUREMENT) */
  midioMeli: boolean;
}

export interface DatosEvidencia {
  modelo: string;
  /**
   * foto de la publicación (real, de MELI); null si no se pudo leer. Para la
   * huella es la URL; al dibujar se sustituye por la imagen ya bajada (data URI).
   */
  imagen: string | null;
  /** la medida que se pide, ya en cm y g enteros (la misma del Excel) */
  medidaReal: Medida;
  /** cuántas publicaciones sostienen la medida de consenso */
  hermanas: number;
  costoNormal: number | null;
  renglones: RenglonEvidencia[];
  /** cuántos renglones buenos se dejaron fuera para que la ficha quepa */
  omitidos: number;
  /** las publicaciones (Item ID) que se piden corregir */
  itemsMalos: string[];
  fecha: string;
}

/** "27 × 24 × 10": los lados de mayor a menor, como se lee una caja. */
export function textoCaja(m: Medida | null): string {
  if (!m) return "—";
  const lados = [m.largo, m.ancho, m.alto].sort((a, b) => b - a).map(unDecimal);
  return lados.join(" × ");
}

/** Cuántos renglones caben en la ficha sin que se vuelva un rollo. */
export const MAX_RENGLONES_FICHA = 24;

/**
 * Lo que se dibuja en la ficha. Las malas van SIEMPRE, arriba; después las
 * hermanas bien medidas, hasta el tope, que son la prueba de cuánto mide la
 * caja. Sin consenso no hay ficha (null): no habría nada que probar.
 */
export function datosEvidencia(
  m: ModeloRevisado,
  imagen: string | null,
  fecha = new Date(),
): DatosEvidencia | null {
  if (!m.medidaReal) return null;
  const malasSet = new Set(m.malas.map((v) => v.sku));
  const conMedida = m.variantes.filter((v) => v.medida);

  const aRenglon = (v: VarianteRevisada): RenglonEvidencia => ({
    sku: v.sku,
    talla: v.talla ?? "",
    color: v.color ?? "",
    itemId: v.itemId ?? "",
    medida: textoCaja(v.medida),
    peso: v.medida ? Math.round(v.medida.peso) : null,
    costo: v.costo,
    mala: malasSet.has(v.sku),
    midioMeli: v.fuente === "MEASUREMENT",
  });

  // Las malas en el orden de la revisión (primero la que más cobra de más),
  // que es el mismo orden del Excel; las buenas como van en el catálogo.
  const malas = m.malas.filter((v) => v.medida).map(aRenglon);
  const buenas = conMedida.filter((v) => !malasSet.has(v.sku)).map(aRenglon);
  const cupo = Math.max(0, MAX_RENGLONES_FICHA - malas.length);

  return {
    modelo: m.modelo,
    imagen,
    medidaReal: medidaEntera(m.medidaReal),
    hermanas: m.hermanas,
    costoNormal: m.costoNormal,
    renglones: [...malas, ...buenas.slice(0, cupo)],
    omitidos: Math.max(0, buenas.length - cupo),
    itemsMalos: [...new Set(m.malas.map((v) => v.itemId).filter((x): x is string => !!x))],
    fecha: fecha.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }),
  };
}

/**
 * Huella de lo que se dibuja: si no cambió ninguna medida ni costo del modelo
 * (ni la foto), la ficha que ya está subida sigue valiendo y no se vuelve a
 * generar. Es un hash corto y determinista, no criptográfico: solo compara.
 */
export function huellaEvidencia(d: DatosEvidencia): string {
  const texto = JSON.stringify({
    modelo: d.modelo,
    imagen: d.imagen,
    real: d.medidaReal,
    normal: d.costoNormal,
    r: d.renglones.map((r) => [r.sku, r.medida, r.peso, r.costo, r.mala]),
  });
  // FNV-1a de 32 bits, en hexadecimal.
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Dónde vive la ficha en el bucket: una por cuenta y modelo. */
export function rutaEvidencia(accountId: string, modelo: string): string {
  const limpio = modelo.replace(/[^A-Za-z0-9_-]+/g, "_") || "sin-modelo";
  return `${accountId}/${limpio}.png`;
}
