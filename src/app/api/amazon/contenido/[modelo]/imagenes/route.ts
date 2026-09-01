import JSZip from "jszip";
import { NextResponse } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { Cliente, cuentasAmazon } from "@/lib/amazon/spapi";
import { imagenesDeAsins, type ImagenCatalogo } from "@/lib/amazon/catalogo";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { coloresDeModelo, enRangoContenido } from "@/lib/servicios/contenido-amazon";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * El presupuesto REAL: la función muere a los 60 s en el plan Hobby, así que
 * las descargas se cortan mucho antes de eso y se entrega lo ya juntado.
 */
const PLAZO_MS = 45_000;
/** Deja de bajar imágenes cuando quede menos que esto para armar el ZIP. */
const RESERVA_MS = 8_000;
const MAX_IMAGENES = 80;
const MAX_BYTES = 60 * 1024 * 1024;
const EN_PARALELO = 5;

/** Para nombre de archivo: la diagonal no puede ir, se vuelve " - ". */
function nombreArchivo(s: string): string {
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
 * Todas las imágenes de un modelo, en un ZIP con una carpeta por color.
 *
 * Las fotos son del COLOR, no de la talla: se pide un ASIN por color (hasta
 * 20 caben en una sola llamada al catálogo de Amazon) en vez de los cuarenta
 * hijos del modelo. Si Amazon no entrega las de algún color, va al menos su
 * imagen principal, la que trae el reporte de listados.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ modelo: string }> },
) {
  const { modelo: crudo } = await params;
  const modelo = decodeURIComponent(crudo ?? "").trim().toUpperCase();

  // Esto es lo que impide que la ruta se vuelva un descargador del catálogo
  // entero de Amazon para cualquiera con sesión.
  if (!/^[A-Z0-9]{3,12}$/.test(modelo) || !enRangoContenido(modelo)) {
    return NextResponse.json(
      { error: "Ese modelo no está en la lista de contenido." },
      { status: 400 },
    );
  }

  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaAmazon(supabase);
  if (!cuenta) {
    return NextResponse.json({ error: "No hay ninguna cuenta de Amazon conectada." }, { status: 400 });
  }

  // RLS de por medio: esto solo ve las publicaciones de su propia cuenta.
  const colores = await coloresDeModelo(supabase, cuenta.id, modelo, cuenta.pais ?? null);
  if (!colores.length) {
    return NextResponse.json({ error: `No encontré ${modelo} en el catálogo de Amazon.` }, { status: 404 });
  }

  // Hasta aquí no hicieron falta las credenciales; ahora sí.
  const admin = clienteAdmin();
  const credenciales = (await cuentasAmazon(admin)).find((c) => c.accountId === cuenta.id);

  let porAsin = new Map<string, ImagenCatalogo[]>();
  let avisoCatalogo: string | null = null;
  if (credenciales) {
    const cliente = new Cliente(credenciales, Date.now() + PLAZO_MS);
    try {
      porAsin = await imagenesDeAsins(
        cliente,
        colores.map((c) => c.asin).filter((a): a is string => Boolean(a)),
      );
    } catch (err) {
      avisoCatalogo = `Amazon no entregó el catálogo de imágenes (${(err as Error).message}).`;
    }
  } else {
    avisoCatalogo = "La cuenta de Amazon no tiene credenciales guardadas.";
  }

  const corte = Date.now() + PLAZO_MS - RESERVA_MS;
  const avisos: string[] = avisoCatalogo ? [avisoCatalogo] : [];
  const pendientes: Pendiente[] = [];

  for (const c of colores) {
    const carpeta = nombreArchivo(c.color) || "COLOR";
    const suyas = c.asin ? (porAsin.get(c.asin) ?? []) : [];

    if (suyas.length) {
      suyas.forEach((img, i) => {
        const orden = String(i + 1).padStart(2, "0");
        pendientes.push({
          carpeta,
          nombre: `${nombreArchivo(`${modelo} ${c.color}`)} ${orden} ${img.variante}${extension(img.link)}`,
          link: img.link,
        });
      });
    } else if (c.imagenUrl) {
      avisos.push(`${c.color}: Amazon no devolvió sus fotos; va solo la principal del listado.`);
      pendientes.push({
        carpeta,
        nombre: `${nombreArchivo(`${modelo} ${c.color}`)} 01 MAIN${extension(c.imagenUrl)}`,
        link: c.imagenUrl,
      });
    } else {
      avisos.push(`${c.color}: no encontré ninguna imagen${c.asin ? ` de ${c.asin}` : ""}.`);
    }
  }

  const zip = new JSZip();
  const raiz = zip.folder(modelo) ?? zip;
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
    return NextResponse.json(
      { error: `No encontré imágenes de ${modelo} en Amazon.` },
      { status: 404 },
    );
  }

  if (avisos.length) raiz.file("LEEME.txt", `${modelo}\n\n${avisos.join("\n")}\n`);

  const contenido = await zip.generateAsync({ type: "nodebuffer" });
  return new NextResponse(new Uint8Array(contenido), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${modelo} imagenes.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
