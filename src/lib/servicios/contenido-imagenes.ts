/**
 * El ZIP con todas las imágenes de un modelo.
 *
 * Las fotos son del COLOR, no de la talla: se pide un ASIN por color (hasta 20
 * caben en una sola llamada al catálogo de Amazon) en vez de los cuarenta
 * hijos del modelo. Si Amazon no entrega las de algún color, va al menos su
 * imagen principal, la que trae el reporte de listados, y el ZIP lleva un
 * LEEME.txt diciendo qué faltó.
 *
 * Vive aparte de la ruta porque hay dos puertas a la misma pantalla: la del
 * dueño y la del link sin contraseña.
 */
import JSZip from "jszip";
import type { DB } from "../datos/repos";
import { clienteAdmin } from "../supabase/server";
import { Cliente, cuentasAmazon } from "../amazon/spapi";
import { imagenesDeAsins, type ImagenCatalogo } from "../amazon/catalogo";
import { enRangoContenido, etiquetaGrupo, grupoDeModelo } from "./contenido-amazon";

/**
 * El presupuesto REAL: la función muere a los 60 s en el plan Hobby, así que
 * las descargas se cortan mucho antes y se entrega lo ya juntado.
 */
const PLAZO_MS = 45_000;
/** Deja de bajar imágenes cuando quede menos que esto para armar el ZIP. */
const RESERVA_MS = 8_000;
// MY2307 junta 21 colores en una publicación: con ~7 fotos por color el ZIP
// completo ronda las 150. El tope de tiempo y el de bytes siguen mandando.
const MAX_IMAGENES = 200;
const MAX_BYTES = 60 * 1024 * 1024;
const EN_PARALELO = 5;

/** Para nombre de archivo: la diagonal no puede ir, se vuelve " - ". */
export function nombreArchivo(s: string): string {
  return s.replace(/\//g, " - ").replace(/[\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
}

/** La extensión que trae el link del CDN de Amazon; .jpg si no se ve. */
function extension(link: string): string {
  const m = /\.(jpe?g|png|gif|webp)(?:$|[?#])/i.exec(link);
  return m ? `.${m[1].toLowerCase()}` : ".jpg";
}

interface Pendiente {
  carpeta: string;
  nombre: string;
  link: string;
}

/**
 * Los colores cuyas fotos son EXACTAMENTE las mismas que las de otro color.
 *
 * A un color sin fotos propias (los que nunca se publicaron de verdad, o se
 * despublicaron) Amazon le contesta las fotos de la FAMILIA — o sea las del
 * color que sí está publicado. Sin este filtro, el ZIP de GT125 bajaba WHITE
 * y BLK/BROWN llenos de fotos de BROWN (reporte del dueño, 25-sep-2026), y
 * quien trabaja el contenido habría subido fotos del color equivocado.
 *
 * Un juego de fotos idéntico se lo queda UN solo dueño: el color con más
 * publicaciones vivas (empate: el primero por nombre). Devuelve, para cada
 * color repetido, el nombre de su dueño.
 */
export function fotosRepetidas(
  colores: { nombre: string; activos: number; links: string[] }[],
): Map<string, string> {
  const porHuella = new Map<string, { nombre: string; activos: number }[]>();
  for (const c of colores) {
    if (!c.links.length) continue;
    const huella = [...new Set(c.links)].sort().join("\n");
    porHuella.set(huella, [...(porHuella.get(huella) ?? []), c]);
  }

  const repetidos = new Map<string, string>();
  for (const grupo of porHuella.values()) {
    if (grupo.length < 2) continue;
    const [duenio, ...resto] = [...grupo].sort(
      (a, b) => b.activos - a.activos || a.nombre.localeCompare(b.nombre, "es"),
    );
    for (const c of resto) repetidos.set(c.nombre, duenio.nombre);
  }
  return repetidos;
}

export type ResultadoZip =
  | { ok: true; zip: Buffer; nombre: string }
  | { ok: false; error: string; status: number };

export async function armarZipDeModelo(
  db: DB,
  cuenta: { id: string; pais: string | null },
  modeloCrudo: string,
): Promise<ResultadoZip> {
  const modelo = (modeloCrudo ?? "").trim().toUpperCase();

  // Esto es lo que impide que la ruta se vuelva un descargador del catálogo
  // entero de Amazon para cualquiera que tenga el link.
  if (!/^[A-Z0-9]{3,12}$/.test(modelo) || !enRangoContenido(modelo)) {
    return { ok: false, error: "Ese modelo no está en la lista de contenido.", status: 400 };
  }

  // El ZIP es de la PUBLICACIÓN completa: si GT117…GT122 comparten padre,
  // pedir cualquiera de ellos baja las fotos de todos sus colores.
  const grupo = await grupoDeModelo(db, cuenta.id, modelo, cuenta.pais);
  const colores = grupo?.colores ?? [];
  if (!grupo || !colores.length) {
    return { ok: false, error: `No encontré ${modelo} en el catálogo de Amazon.`, status: 404 };
  }
  const etiqueta = etiquetaGrupo(grupo.codigos);
  const varios = grupo.codigos.length > 1;

  // Hasta aquí no hicieron falta las credenciales de SP-API; ahora sí.
  const admin = clienteAdmin();
  const credenciales = (await cuentasAmazon(admin)).find((c) => c.accountId === cuenta.id);

  const porAsin = new Map<string, ImagenCatalogo[]>();
  let avisoCatalogo: string | null = null;
  if (credenciales) {
    const cliente = new Cliente(credenciales, Date.now() + PLAZO_MS);
    try {
      const primeras = await imagenesDeAsins(
        cliente,
        colores.map((c) => c.asin).filter((a): a is string => Boolean(a)),
      );
      for (const [asin, fotos] of primeras) porAsin.set(asin, fotos);

      // Un color agotado o borrado puede tener un ASIN que el catálogo ya no
      // contesta; las fotos son las mismas en cualquier talla, así que se
      // reintenta con sus otras tallas antes de darlo por perdido.
      const sinFotos = colores.filter(
        (c) => c.asin && !porAsin.get(c.asin)?.length && c.asinsExtra.length,
      );
      if (sinFotos.length) {
        const extras = await imagenesDeAsins(cliente, sinFotos.flatMap((c) => c.asinsExtra));
        for (const c of sinFotos) {
          const alterno = c.asinsExtra.find((a) => extras.get(a)?.length);
          if (alterno && c.asin) porAsin.set(c.asin, extras.get(alterno)!);
        }
      }
    } catch (err) {
      avisoCatalogo = `Amazon no entregó el catálogo de imágenes (${(err as Error).message}).`;
    }
  } else {
    avisoCatalogo = "La cuenta de Amazon no tiene credenciales guardadas.";
  }

  const corte = Date.now() + PLAZO_MS - RESERVA_MS;
  const avisos: string[] = avisoCatalogo ? [avisoCatalogo] : [];
  const pendientes: Pendiente[] = [];

  const repetidas = fotosRepetidas(
    colores.map((c) => ({
      nombre: varios ? `${c.modelo} ${c.color}` : c.color,
      activos: c.activos,
      links: (c.asin ? (porAsin.get(c.asin) ?? []) : []).map((i) => i.link),
    })),
  );

  for (const c of colores) {
    // Cuando la publicación junta varios códigos, la carpeta dice de cuál es.
    const nombreColor = varios ? `${c.modelo} ${c.color}` : c.color;
    const carpeta = nombreArchivo(nombreColor) || "COLOR";
    const suyas = c.asin ? (porAsin.get(c.asin) ?? []) : [];

    // Fotos prestadas de otro color: mejor ninguna que las equivocadas.
    const duenio = repetidas.get(nombreColor);
    if (duenio) {
      avisos.push(
        `${nombreColor}: en Amazon trae exactamente las mismas fotos que ${duenio} — no tiene fotos propias y no se incluye.`,
      );
      continue;
    }

    if (suyas.length) {
      suyas.forEach((img, i) => {
        const orden = String(i + 1).padStart(2, "0");
        pendientes.push({
          carpeta,
          nombre: `${nombreArchivo(`${c.modelo} ${c.color}`)} ${orden} ${img.variante}${extension(img.link)}`,
          link: img.link,
        });
      });
    } else if (c.imagenUrl) {
      avisos.push(`${nombreColor}: Amazon no devolvió sus fotos; va solo la principal del listado.`);
      pendientes.push({
        carpeta,
        nombre: `${nombreArchivo(`${c.modelo} ${c.color}`)} 01 MAIN${extension(c.imagenUrl)}`,
        link: c.imagenUrl,
      });
    } else {
      avisos.push(`${nombreColor}: no encontré ninguna imagen${c.asin ? ` de ${c.asin}` : ""}.`);
    }
  }

  const zip = new JSZip();
  const raiz = zip.folder(nombreArchivo(etiqueta) || modelo) ?? zip;
  let bajadas = 0;
  let bytes = 0;

  for (let i = 0; i < pendientes.length && i < MAX_IMAGENES; i += EN_PARALELO) {
    if (Date.now() > corte || bytes > MAX_BYTES) {
      avisos.push("Se cortó la descarga: el modelo trae demasiadas fotos. Vuelve a intentar.");
      break;
    }
    const tanda = pendientes.slice(i, i + EN_PARALELO);
    const bajados = await Promise.all(
      tanda.map(async (p) => {
        try {
          const r = await fetch(p.link);
          if (!r.ok) return null;
          return { p, datos: new Uint8Array(await r.arrayBuffer()) };
        } catch {
          return null;
        }
      }),
    );
    for (const b of bajados) {
      if (!b) continue;
      (raiz.folder(b.p.carpeta) ?? raiz).file(b.p.nombre, b.datos);
      bajadas += 1;
      bytes += b.datos.byteLength;
    }
  }

  if (bajadas === 0) {
    return { ok: false, error: `No encontré imágenes de ${etiqueta} en Amazon.`, status: 404 };
  }

  if (avisos.length) raiz.file("LEEME.txt", `${etiqueta}\n\n${avisos.join("\n")}\n`);

  const contenido = await zip.generateAsync({ type: "nodebuffer" });
  return { ok: true, zip: contenido, nombre: `${nombreArchivo(etiqueta) || modelo} imagenes.zip` };
}
