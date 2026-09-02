/**
 * Generar y guardar las fichas de evidencia: una por modelo con publicaciones
 * mal medidas, subida al bucket público `evidencia-envio` para que el link se
 * pueda pegar en la solicitud a MELI.
 *
 * Va con presupuesto de tiempo como el resto del módulo: cada pasada dibuja
 * las que alcance y devuelve cuántas faltan; la pantalla vuelve a llamar. Una
 * ficha cuya huella no cambió no se vuelve a dibujar ni a subir.
 */
import type { MeliClient } from "../meli/client";
import { traerTodo, type DB } from "../datos/repos";
import { leerRevision, type ModeloRevisado } from "./costos-envio";
import { datosEvidencia, huellaEvidencia, rutaEvidencia, type DatosEvidencia } from "./evidencia-envio";
import { dibujarEvidencia } from "./evidencia-envio-imagen";

export const BUCKET_EVIDENCIA = "evidencia-envio";

interface FilaEvidencia {
  modelo: string;
  url: string;
  huella: string;
  imagen_producto: string | null;
}

/** modelo → link público de su ficha, para la pantalla y el Excel. */
export async function leerEvidencias(db: DB, accountId: string): Promise<Map<string, string>> {
  const filas = await traerTodo<FilaEvidencia>(db, "evidencia_envio", "modelo, url, huella, imagen_producto", (q) =>
    q.eq("account_id", accountId),
  );
  return new Map(filas.map((f) => [f.modelo, f.url]));
}

/**
 * La foto de la publicación, de MELI. Se pide por una de las publicaciones
 * del modelo (la primera con Item ID): todas las tallas comparten la foto.
 * Si MELI no contesta, la ficha sale sin foto; no es motivo para no armarla.
 */
async function fotoDelModelo(cliente: MeliClient, m: ModeloRevisado): Promise<string | null> {
  const itemId = m.variantes.map((v) => v.itemId).find((x): x is string => !!x);
  if (!itemId) return null;
  try {
    const item = await cliente.get<{
      thumbnail?: string | null;
      pictures?: { secure_url?: string; url?: string }[];
    }>(`/items/${itemId}`, { attributes: "id,thumbnail,pictures" }, { reintentos: 1 });
    const primera = item.pictures?.[0];
    const url = primera?.secure_url ?? primera?.url ?? item.thumbnail ?? null;
    // Satori (el que dibuja la ficha) lee JPG y PNG, no WebP. mlstatic sirve
    // la misma foto con cualquiera de las dos extensiones.
    return url ? url.replace(/^http:/, "https:").replace(/\.webp(\?.*)?$/i, ".jpg") : null;
  } catch {
    return null;
  }
}

/**
 * La foto ya descargada, como data URI, para meterla en la ficha. Satori
 * también sabe bajar una URL, pero sin tiempo límite ni control del tipo:
 * bajarla aquí deja claro qué pasó, y si no se puede, la ficha sale sin foto.
 */
export async function fotoEnBase64(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const tipo = res.headers.get("content-type") ?? "";
    if (!res.ok || !/^image\/(jpeg|png)/.test(tipo)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return `data:${tipo.split(";")[0]};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Lo que se dibujaría para un modelo (con su foto real), para la vista previa. */
export async function datosDeModelo(
  cliente: MeliClient | null,
  db: DB,
  accountId: string,
  modelo: string,
): Promise<DatosEvidencia | null> {
  const m = (await leerRevision(db, accountId)).find((x) => x.modelo === modelo);
  if (!m) return null;
  const imagen = cliente ? await fotoDelModelo(cliente, m) : null;
  const datos = datosEvidencia(m, imagen);
  return datos ? { ...datos, imagen: await fotoEnBase64(imagen) } : null;
}

/**
 * Dibuja y sube las fichas de los modelos con publicaciones mal medidas.
 *
 * `admin` es el cliente con service-role: es el único que escribe en el
 * bucket. `db` es el del usuario, para leer la revisión con RLS.
 */
export async function generarEvidencias(
  cliente: MeliClient,
  admin: DB,
  db: DB,
  accountId: string,
  opts?: { limiteMs?: number; soloModelo?: string; forzar?: boolean },
): Promise<{ generadas: number; sinCambio: number; pendientes: number; total: number }> {
  const arranque = Date.now();
  const limite = opts?.limiteMs ?? 40_000;

  let modelos = (await leerRevision(db, accountId)).filter((m) => m.malas.length > 0 && m.medidaReal);
  if (opts?.soloModelo) modelos = modelos.filter((m) => m.modelo === opts.soloModelo);

  const previas = new Map(
    (
      await traerTodo<FilaEvidencia>(admin, "evidencia_envio", "modelo, url, huella, imagen_producto", (q) =>
        q.eq("account_id", accountId),
      )
    ).map((f) => [f.modelo, f]),
  );

  let generadas = 0;
  let sinCambio = 0;
  let pendientes = 0;

  for (const m of modelos) {
    if (Date.now() - arranque > limite) {
      pendientes++;
      continue;
    }
    const previa = previas.get(m.modelo);
    // La foto se reutiliza: pedirla a MELI cada vez es una llamada por modelo.
    const imagen = previa?.imagen_producto ?? (await fotoDelModelo(cliente, m));
    const datos = datosEvidencia(m, imagen);
    if (!datos) continue;

    const huella = huellaEvidencia(datos);
    if (!opts?.forzar && previa && previa.huella === huella) {
      sinCambio++;
      continue;
    }

    // La huella lleva la URL de la foto; lo que se dibuja lleva sus bytes.
    const png = await dibujarEvidencia({ ...datos, imagen: await fotoEnBase64(imagen) });
    const ruta = rutaEvidencia(accountId, m.modelo);
    const { error } = await admin.storage
      .from(BUCKET_EVIDENCIA)
      .upload(ruta, png, { contentType: "image/png", upsert: true, cacheControl: "60" });
    if (error) throw new Error(`No se pudo guardar la ficha de ${m.modelo}: ${error.message}`);

    // La URL pública es siempre la misma; el `?v=` es para que el CDN de
    // Storage no siga enseñando la ficha vieja después de regenerarla.
    const { data } = admin.storage.from(BUCKET_EVIDENCIA).getPublicUrl(ruta);
    const url = `${data.publicUrl}?v=${huella}`;

    const { error: e2 } = await admin.from("evidencia_envio").upsert(
      {
        account_id: accountId,
        modelo: m.modelo,
        url,
        huella,
        imagen_producto: imagen,
        generado_en: new Date().toISOString(),
      },
      { onConflict: "account_id,modelo" },
    );
    if (e2) throw new Error(`evidencia_envio: ${e2.message}`);
    generadas++;
  }

  return { generadas, sinCambio, pendientes, total: modelos.length };
}
