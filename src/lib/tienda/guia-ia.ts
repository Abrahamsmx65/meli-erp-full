/**
 * IDEAS PARA EL VIDEO hechas por Claude mirando las FOTOS del producto
 * (dueño, 28-oct-2026: «todo se repite y es muy genérico; que analice las
 * imágenes, el título y la descripción y según eso haga la descripción»).
 *
 * Motor puro (probado en guia-ia.test.ts): qué fotos se mandan, la HUELLA
 * del producto (si no cambió, no se vuelve a pagar), el mensaje, el esquema
 * de la respuesta, la limpieza de lo que contesta y el TOPE de gasto. La
 * llamada vive en `servicios/guias-ia.ts` y la tienda solo lee lo guardado.
 */
import { createHash } from "node:crypto";
import type { ProductoCatalogo } from "./catalogo-amazon";

/** El modelo de Claude que mira las fotos. */
export const MODELO_IA = "claude-opus-5-5";
/** Precio de ese modelo por millón de tokens (USD), para llevar la cuenta del gasto. */
export const USD_ENTRADA_MILLON = 4;
export const USD_SALIDA_MILLON = 20;
/**
 * Lo más que se gasta al MES en las guías (USD). Al llegar, el fondo se para
 * hasta el mes siguiente. El límite de gasto del workspace en Anthropic es
 * la segunda llave: aunque este número cambie, la consola no deja pasar.
 */
export const TOPE_MENSUAL_USD = 15;
/** Guías por corrida del cron: lo que cabe holgado en una función. */
export const GUIAS_POR_CORRIDA = 12;
/** Fotos por producto: las suficientes para ver el zapato sin pagar de más. */
export const FOTOS_POR_PRODUCTO = 4;
/** Lado de la foto que se le pide a Amazon (px). */
export const LADO_FOTO = 800;

export const CLAVE_GUIAS = "guias-video";

export interface PuntoFuerte {
  /** lo que hace bueno al zapato, en palabras de venta */
  punto: string;
  /** la toma para enseñarlo */
  toma: string;
}

export interface GuiaIA {
  /** una línea: qué lo hace distinto */
  resumen: string;
  puntosFuertes: PuntoFuerte[];
  ideas: string[];
  ganchos: string[];
  paraQuien: string[];
  /** lo que el creador NO debe prometer (lo que las fotos no prueban) */
  evitar: string[];
}

export interface GuiaGuardada extends GuiaIA {
  /** huella del producto con que se hizo; si cambia, se rehace */
  huella: string;
  generadoEn: string;
  /** corregida a mano en el back: el fondo ya no la pisa */
  editada: boolean;
  costoUsd: number;
}

export interface GuiasGuardadas {
  guias: Record<string, GuiaGuardada>;
  /** gasto por mes (YYYY-MM) en USD */
  gasto: Record<string, number>;
  ultimaCorrida: {
    en: string;
    hechas: string[];
    errores: { modelo: string; error: string }[];
    motivo: string | null;
  } | null;
}

export function guiasVacias(): GuiasGuardadas {
  return { guias: {}, gasto: {}, ultimaCorrida: null };
}

/**
 * La foto de Amazon al tamaño pedido (`ID._AC_SL800_.jpg`), igual que la
 * tienda; una URL que no es de Amazon pasa tal cual.
 */
export function fotoAmazon(url: string, lado: number): string {
  const m = url.match(/^(https:\/\/m\.media-amazon\.com\/images\/I\/[^./]+)(?:\.[^/]*)?\.(jpe?g|png|webp)$/i);
  return m ? `${m[1]}._AC_SL${lado}_.${m[2]}` : url;
}

/**
 * Las fotos que se mandan: la principal de cada color (hasta 3) y la segunda
 * del primero, que suele enseñar la suela o el zapato puesto.
 */
export function fotosParaAnalizar(p: Pick<ProductoCatalogo, "colores">, max = FOTOS_POR_PRODUCTO): string[] {
  const salida: string[] = [];
  const agregar = (u: string | undefined) => {
    if (u && !salida.includes(u) && salida.length < max) salida.push(u);
  };
  for (const c of p.colores.slice(0, 3)) agregar(c.fotos[0]);
  agregar(p.colores[0]?.fotos[1]);
  for (const c of p.colores) for (const f of c.fotos.slice(1)) agregar(f);
  return salida.map((u) => fotoAmazon(u, LADO_FOTO));
}

export interface TextosProducto {
  bullets: string[];
  descripcion: string | null;
}

/** Lo que define al producto: si nada de esto cambia, la guía sigue valiendo. */
export function huellaDeProducto(p: ProductoCatalogo, textos: TextosProducto): string {
  const base = JSON.stringify({
    t: p.titulo,
    c: p.categoria,
    f: fotosParaAnalizar(p),
    b: textos.bullets,
    d: textos.descripcion,
  });
  return createHash("sha256").update(base).digest("hex").slice(0, 16);
}

/** Qué modelos tocan: sin guía o con el producto cambiado; lo corregido a mano no se pisa. */
export function modelosPorGenerar(
  productos: ProductoCatalogo[],
  guardadas: Record<string, GuiaGuardada>,
  huellas: Map<string, string>,
  limite: number,
): string[] {
  const salida: string[] = [];
  // Primero lo que tiene stock: es lo que los creadores van a grabar.
  const orden = [...productos].sort((a, b) => b.total - a.total || a.modelo.localeCompare(b.modelo, "es", { numeric: true }));
  for (const p of orden) {
    if (salida.length >= limite) break;
    if (p.oculto || !fotosParaAnalizar(p).length) continue;
    const g = guardadas[p.modelo];
    if (g?.editada) continue;
    if (!g || g.huella !== huellas.get(p.modelo)) salida.push(p.modelo);
  }
  return salida;
}

export function mesDe(fecha: Date): string {
  return fecha.toISOString().slice(0, 7);
}

/** USD de una llamada según los tokens que reporta la API. */
export function costoDeUso(u: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): number {
  const entrada = u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.05;
  return (entrada * USD_ENTRADA_MILLON + u.output_tokens * USD_SALIDA_MILLON) / 1_000_000;
}

/** Lo que queda del tope este mes. */
export function disponibleDelMes(gasto: Record<string, number>, ahora: Date, tope = TOPE_MENSUAL_USD): number {
  return Math.max(0, tope - (gasto[mesDe(ahora)] ?? 0));
}

/** Lo que una guía puede llegar a costar: no se arranca otra si no cabe. */
export const COSTO_MAXIMO_GUIA_USD = 0.4;

export const INSTRUCCIONES = `Eres estratega de contenido de TikTok Shop para GETAC, una marca mexicana de calzado. Escribes guías cortas para que creadores mexicanos graben videos que vendan un producto concreto.

Reglas:
- Mira las fotos con atención: forma, suela, materiales que se ven, forro, detalles, cómo se ve puesto. Lo que digas tiene que ser de ESTE zapato, no de cualquier zapato de su categoría.
- Solo afirma lo que se ve en las fotos o dice el texto del producto. Si algo no se puede comprobar (que sea piel, impermeable, antiderrapante, ortopédico), no lo prometas; ponlo en "evitar" si el creador podría decirlo.
- Habla de tú, en español de México, natural y directo, sin emojis ni hashtags.
- Puntos fuertes: de 3 a 5, cada uno con una toma concreta para enseñarlo en cámara (qué hacer con el zapato, desde dónde grabar).
- Ideas de video: 4, distintas entre sí, que encajen con el estilo y el uso del zapato.
- Ganchos: 4 frases para los primeros 3 segundos, de menos de 12 palabras.
- Para quién: 2 o 3 tipos de comprador o situaciones de uso.
- Evitar: 1 o 2 cosas que el creador no debe decir o hacer con este producto.
- Cada frase en una sola línea, sin numerar.`;

/** El texto que acompaña a las fotos. */
export function mensajeDeProducto(p: ProductoCatalogo, textos: TextosProducto): string {
  const tallas = [...new Set(p.colores.flatMap((c) => c.tallas))];
  const lineas = [
    `Modelo: ${p.modelo}`,
    `Categoría: ${p.categoria}`,
    `Título de la publicación: ${p.titulo}`,
    `Colores: ${p.colores.map((c) => c.color).join(", ")}`,
    tallas.length ? `Tallas (mexicanas, = cm del pie): ${tallas.join(", ")}` : "",
    p.precioDesde != null ? `Precio en TikTok Shop: $${p.precioDesde}` : "",
    textos.bullets.length ? `Puntos de la ficha:\n${textos.bullets.map((b) => `- ${b}`).join("\n")}` : "",
    textos.descripcion ? `Descripción:\n${textos.descripcion.slice(0, 2000)}` : "",
    "Las fotos de arriba son de este producto. Escribe su guía.",
  ];
  return lineas.filter(Boolean).join("\n");
}

const LISTA = { type: "array", items: { type: "string" } } as const;

/** El esquema de la respuesta (salida estructurada). */
export const ESQUEMA_GUIA = {
  type: "object",
  additionalProperties: false,
  required: ["resumen", "puntosFuertes", "ideas", "ganchos", "paraQuien", "evitar"],
  properties: {
    resumen: { type: "string" },
    puntosFuertes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["punto", "toma"],
        properties: { punto: { type: "string" }, toma: { type: "string" } },
      },
    },
    ideas: LISTA,
    ganchos: LISTA,
    paraQuien: LISTA,
    evitar: LISTA,
  },
} as const;

function textos(x: unknown, max: number, largo = 280): string[] {
  if (!Array.isArray(x)) return [];
  return x
    .map((s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : ""))
    .filter(Boolean)
    .map((s) => s.slice(0, largo))
    .slice(0, max);
}

/** Lo que contestó Claude, limpio y acotado; null si no sirve. */
export function limpiarGuia(x: unknown): GuiaIA | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const puntosFuertes = Array.isArray(o.puntosFuertes)
    ? (o.puntosFuertes as unknown[])
        .map((p) => {
          const q = (p ?? {}) as Record<string, unknown>;
          const punto = typeof q.punto === "string" ? q.punto.replace(/\s+/g, " ").trim().slice(0, 280) : "";
          const toma = typeof q.toma === "string" ? q.toma.replace(/\s+/g, " ").trim().slice(0, 280) : "";
          return { punto, toma };
        })
        .filter((p) => p.punto)
        .slice(0, 5)
    : [];
  const guia: GuiaIA = {
    resumen: typeof o.resumen === "string" ? o.resumen.replace(/\s+/g, " ").trim().slice(0, 280) : "",
    puntosFuertes,
    ideas: textos(o.ideas, 5),
    ganchos: textos(o.ganchos, 5, 120),
    paraQuien: textos(o.paraQuien, 3),
    evitar: textos(o.evitar, 3),
  };
  if (!guia.puntosFuertes.length || !guia.ideas.length || !guia.ganchos.length) return null;
  return guia;
}
