/**
 * Clips de Mercado Libre en publicaciones agrupadas por variante.
 *
 * Con el agrupador de variantes cada color es su PROPIO MLM: el clip que se
 * sube a una variante se ve en la página agrupada, pero MELI se lo cuenta
 * solo a ese item y las hermanas quedan sin video — menos exposición justo
 * en las publicaciones que sí lo tienen "a la vista".
 *
 * Este servicio hace tres cosas, con el mismo esquema que los datos
 * fiscales (espejo local + cola + proceso de fondo que se relanza solo):
 *
 *  1. LEER de MELI qué publicaciones activas tienen clip
 *     (GET /items/{id}/clips) y guardarlo en `clips_meli`.
 *  2. PLANEAR la propagación: por modelo (así agrupa el agrupador: los
 *     colores de un modelo), a cada publicación activa sin clip se le asigna
 *     el video de una hermana que sí lo tiene; si ninguna hermana da URL, el
 *     video generado por el ERP (videos_producto) es el respaldo.
 *  3. SUBIR los encolados: descargar el video de la fuente y re-subirlo con
 *     POST /items/{id}/clips/upload (multipart). MELI lo pasa por moderación.
 *
 * Nada se inventa: solo se propagan videos que ya existen en la misma
 * publicación agrupada (o los generados por el ERP para ese modelo), y solo
 * cuando el usuario lo acepta desde la sección de Clips.
 */
import { traerTodo, upsertEnTandas, type DB } from "../datos/repos";
import { MeliError, type MeliClient } from "../meli/client";

/** Un clip ya normalizado, venga como venga la respuesta de MELI. */
export interface ClipMeli {
  id: string | null;
  estado: string | null;
  url: string | null;
  crudo: Record<string, unknown>;
}

const ESTADOS_VIVOS = new Set([
  "active",
  "activo",
  "published",
  "approved",
  "accepted",
  "pending",
  "in_process",
  "processing",
  "under_review",
  "moderation",
]);

const ESTADOS_MUERTOS = new Set(["rejected", "deleted", "removed", "failed", "error"]);

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Busca recursivamente una URL de video dentro del clip (hasta 3 niveles). */
function buscarUrlVideo(v: unknown, nivel = 0): string | null {
  if (nivel > 3) return null;
  if (typeof v === "string") {
    return /^https?:\/\/\S+\.(mp4|mov|mpeg|avi)(\?|$)/i.test(v) ||
      (/^https?:\/\//.test(v) && /video/i.test(v))
      ? v
      : null;
  }
  if (Array.isArray(v)) {
    for (const x of v) {
      const url = buscarUrlVideo(x, nivel + 1);
      if (url) return url;
    }
    return null;
  }
  if (!esObjeto(v)) return null;
  // Primero las llaves que suenan a video; luego el resto del objeto.
  const llaves = Object.keys(v).sort((a, b) => {
    const pa = /url|video|file|media|playback|download/i.test(a) ? 0 : 1;
    const pb = /url|video|file|media|playback|download/i.test(b) ? 0 : 1;
    return pa - pb;
  });
  for (const k of llaves) {
    if (/thumbnail|poster|image|cover/i.test(k)) continue;
    const url = buscarUrlVideo(v[k], nivel + 1);
    if (url) return url;
  }
  return null;
}

/**
 * Aplana la respuesta de GET /items/{id}/clips a una lista de clips. La
 * forma exacta no está garantizada (la documentación pública solo muestra la
 * variante de Global Selling), así que se aceptan las envolturas usuales de
 * MELI: lista directa, {clips: []}, {results: []} o un objeto suelto. Lo
 * crudo se conserva completo para poder revisar y ajustar sin re-escanear.
 */
export function normalizarClips(respuesta: unknown): ClipMeli[] {
  let lista: unknown[] = [];
  if (Array.isArray(respuesta)) {
    lista = respuesta;
  } else if (esObjeto(respuesta)) {
    const envoltura = ["clips", "results", "data", "items", "videos"].find((k) =>
      Array.isArray(respuesta[k]),
    );
    if (envoltura) lista = respuesta[envoltura] as unknown[];
    else if (Object.keys(respuesta).length) lista = [respuesta];
  }

  const clips: ClipMeli[] = [];
  for (const c of lista) {
    if (!esObjeto(c)) continue;
    const id =
      c.id ?? c.clip_id ?? c.clip_uuid ?? c.uuid ?? c.video_id ?? null;
    const estado = c.status ?? c.state ?? c.estado ?? null;
    clips.push({
      id: id != null ? String(id) : null,
      estado: estado != null ? String(estado).toLowerCase() : null,
      url: buscarUrlVideo(c),
      crudo: c,
    });
  }
  return clips;
}

/** ¿La publicación "tiene clip"? Cuenta cualquier clip no rechazado/borrado. */
export function tieneClipVivo(clips: ClipMeli[]): boolean {
  return clips.some((c) => !c.estado || !ESTADOS_MUERTOS.has(c.estado));
}

/**
 * El mejor clip para usar de fuente: uno vivo (de preferencia ya aprobado)
 * y con URL descargable. Sin URL no hay nada que propagar.
 */
export function elegirClipFuente(clips: ClipMeli[]): ClipMeli | null {
  const conUrl = clips.filter((c) => c.url);
  if (!conUrl.length) return null;
  const activos = conUrl.filter(
    (c) => c.estado && ["active", "activo", "published", "approved", "accepted"].includes(c.estado),
  );
  if (activos.length) return activos[0];
  const vivos = conUrl.filter((c) => !c.estado || ESTADOS_VIVOS.has(c.estado));
  return vivos[0] ?? conUrl[0];
}

/** Fila mínima con la que se planea la propagación de un modelo. */
export interface FilaPlan {
  itemId: string;
  modelo: string | null;
  estadoPub: string | null;
  tieneClip: boolean;
  clipUrl: string | null;
  /** video generado por el ERP para este item o su modelo (respaldo) */
  videoErpUrl: string | null;
  /** ya está encolada o subiendo: no se vuelve a encolar */
  enCola: boolean;
}

export interface Aplicacion {
  itemId: string;
  origenItemId: string | null;
  url: string;
  origen: "hermana" | "erp";
}

/**
 * Qué video le toca a cada publicación activa sin clip, por modelo (así
 * agrupa el agrupador de variantes: los colores del mismo modelo). Primero
 * el clip de una hermana con URL; como respaldo, el video del ERP. Las
 * publicaciones pausadas no entran: MELI solo acepta clips en activas.
 */
export function planAplicaciones(filas: FilaPlan[]): Aplicacion[] {
  const porModelo = new Map<string, FilaPlan[]>();
  for (const f of filas) {
    if (!f.modelo) continue;
    const lista = porModelo.get(f.modelo) ?? [];
    lista.push(f);
    porModelo.set(f.modelo, lista);
  }

  const plan: Aplicacion[] = [];
  for (const grupo of porModelo.values()) {
    const fuente = grupo.find((f) => f.tieneClip && f.clipUrl);
    const erp = grupo.find((f) => f.videoErpUrl)?.videoErpUrl ?? null;
    if (!fuente && !erp) continue;

    for (const f of grupo) {
      if (f.tieneClip || f.enCola) continue;
      if (f.estadoPub !== "active") continue;
      if (fuente) {
        plan.push({
          itemId: f.itemId,
          origenItemId: fuente.itemId,
          url: fuente.clipUrl!,
          origen: "hermana",
        });
      } else {
        plan.push({ itemId: f.itemId, origenItemId: null, url: erp!, origen: "erp" });
      }
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Lectura y subida contra MELI (las usa /api/clips/procesar)
// ---------------------------------------------------------------------------

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * La ruta del API de clips NO está publicada para vendedores locales (la
 * documentación abierta solo muestra la variante de Global Selling, con el
 * prefijo /marketplace). En vez de adivinar y quemar el catálogo con
 * errores, cada corrida SONDEA estas rutas candidatas contra una
 * publicación real y usa la primera que conteste; el sondeo completo queda
 * en la bitácora para poder diagnosticar cuando ninguna funcione.
 */
export interface RutaClips {
  nombre: string;
  get: (itemId: string) => string;
  upload: (itemId: string) => string;
  /**
   * false = la ruta no va por publicación (va por user product o por
   * vendedor): sirve para DESCUBRIR que el recurso existe, pero el recorrido
   * del catálogo necesita adaptarse antes de usarla.
   */
  porItem?: boolean;
}

export function rutasCandidatas(sellerId?: number, userProductId?: string): RutaClips[] {
  const rutas: RutaClips[] = [
    {
      nombre: "items/{id}/clips",
      get: (i) => `/items/${i}/clips`,
      upload: (i) => `/items/${i}/clips/upload`,
    },
    {
      nombre: "marketplace/items/{id}/clips",
      get: (i) => `/marketplace/items/${i}/clips`,
      upload: (i) => `/marketplace/items/${i}/clips/upload`,
    },
    {
      nombre: "items/{id}/videos",
      get: (i) => `/items/${i}/videos`,
      upload: (i) => `/items/${i}/videos/upload`,
    },
    {
      nombre: "clips/items/{id}",
      get: (i) => `/clips/items/${i}`,
      upload: (i) => `/clips/items/${i}/upload`,
    },
  ];
  rutas.push({
    nombre: "vis/items/{id}/videos",
    get: (i) => `/vis/items/${i}/videos`,
    upload: (i) => `/vis/items/${i}/videos/upload`,
  });
  if (sellerId) {
    rutas.push(
      {
        nombre: "users/{seller}/items/{id}/clips",
        get: (i) => `/users/${sellerId}/items/${i}/clips`,
        upload: (i) => `/users/${sellerId}/items/${i}/clips/upload`,
      },
      {
        nombre: "users/{seller}/clips",
        porItem: false,
        get: () => `/users/${sellerId}/clips`,
        upload: () => `/users/${sellerId}/clips/upload`,
      },
      {
        nombre: "marketplace/users/{seller}/clips",
        porItem: false,
        get: () => `/marketplace/users/${sellerId}/clips`,
        upload: () => `/marketplace/users/${sellerId}/clips/upload`,
      },
    );
  }
  if (userProductId) {
    rutas.push(
      {
        nombre: "user-products/{up}/clips",
        porItem: false,
        get: () => `/user-products/${userProductId}/clips`,
        upload: () => `/user-products/${userProductId}/clips/upload`,
      },
      {
        nombre: "marketplace/user-products/{up}/clips",
        porItem: false,
        get: () => `/marketplace/user-products/${userProductId}/clips`,
        upload: () => `/marketplace/user-products/${userProductId}/clips/upload`,
      },
    );
  }
  return rutas;
}

export interface Sondeo {
  ruta: string;
  url: string;
  status: number;
  cuerpo: string;
}

/**
 * Prueba las rutas candidatas con una publicación real y regresa la primera
 * que conteste 2xx. Un 404 genérico ("resource not found") es "esta ruta no
 * existe"; cualquier otra respuesta queda registrada tal cual en el sondeo:
 * un 403, por ejemplo, diría que la ruta SÍ existe pero falta un permiso.
 */
export async function descubrirRutaClips(
  cliente: Pick<MeliClient, "get">,
  itemId: string,
  sellerId?: number,
  userProductId?: string,
): Promise<{ ruta: RutaClips | null; respuesta: unknown; sondeos: Sondeo[] }> {
  const sondeos: Sondeo[] = [];
  for (const ruta of rutasCandidatas(sellerId, userProductId)) {
    const url = ruta.get(itemId);
    try {
      // Sin reintentos: el sondeo quiere la PRIMERA respuesta; un 500
      // reintentado 4 veces con backoff quema el presupuesto de la función.
      const respuesta = await cliente.get(url, undefined, { reintentos: 0 });
      sondeos.push({ ruta: ruta.nombre, url, status: 200, cuerpo: JSON.stringify(respuesta).slice(0, 400) });
      return { ruta, respuesta, sondeos };
    } catch (err) {
      if (err instanceof MeliError) {
        sondeos.push({
          ruta: ruta.nombre,
          url,
          status: err.status,
          cuerpo: JSON.stringify(err.cuerpo ?? err.message).slice(0, 400),
        });
      } else {
        sondeos.push({ ruta: ruta.nombre, url, status: 0, cuerpo: (err as Error).message.slice(0, 400) });
      }
    }
  }
  return { ruta: null, respuesta: null, sondeos };
}

interface FilaItem {
  item_id: string;
  modelo: string | null;
  titulo: string | null;
  color: string | null;
  estado: string | null;
}

/**
 * Las publicaciones del catálogo, una fila por item: el modelo/color/título
 * del primer SKU (todas las tallas comparten publicación). Solo interesan
 * las activas: MELI no acepta clips en pausadas, y las pausadas de Full son
 * "se acabó el stock", no otra logística.
 */
export async function itemsDelCatalogo(db: DB, accountId: string): Promise<FilaItem[]> {
  const skus = await traerTodo<{
    item_id: string;
    modelo: string | null;
    titulo: string | null;
    color: string | null;
    estado: string | null;
  }>(db, "skus", "item_id, modelo, titulo, color, estado", (q) =>
    q.eq("account_id", accountId).eq("activo", true).not("item_id", "is", null),
  );

  const porItem = new Map<string, FilaItem>();
  for (const s of skus) {
    const previo = porItem.get(s.item_id);
    if (!previo) {
      porItem.set(s.item_id, {
        item_id: s.item_id,
        modelo: s.modelo,
        titulo: s.titulo,
        color: s.color,
        estado: s.estado,
      });
    } else if (previo.estado !== "active" && s.estado === "active") {
      // Si cualquier talla del item está activa, la publicación está activa.
      previo.estado = "active";
    }
  }
  return [...porItem.values()];
}

export interface ResultadoLecturaClips {
  leidos: number;
  conClip: number;
  restantes: number;
  errores: string[];
}

/**
 * Consulta a MELI los clips de las publicaciones ACTIVAS que aún no se leen
 * (leido_en null) y guarda el resultado en `clips_meli`. Trabaja hasta que
 * `sigue()` diga que no; reporta cuántas quedaron para que el que llama
 * decida si se relanza.
 */
export async function leerClipsFaltantes(
  db: DB,
  cliente: MeliClient,
  accountId: string,
  ruta: RutaClips,
  sigue: () => boolean,
): Promise<ResultadoLecturaClips> {
  const items = await itemsDelCatalogo(db, accountId);
  const activos = items.filter((i) => i.estado === "active");

  const existentes = await traerTodo<{ item_id: string; leido_en: string | null; estado: string }>(
    db,
    "clips_meli",
    "item_id, leido_en, estado",
    (q) => q.eq("account_id", accountId),
  );
  const yaLeido = new Set(existentes.filter((e) => e.leido_en).map((e) => e.item_id));
  // Una fila encolada o con captura en vuelo no se pisa con la lectura.
  const enCola = new Set(
    existentes.filter((e) => e.estado === "pendiente").map((e) => e.item_id),
  );

  const pendientes = activos.filter((i) => !yaLeido.has(i.item_id) && !enCola.has(i.item_id));
  const resultado: ResultadoLecturaClips = {
    leidos: 0,
    conClip: 0,
    restantes: pendientes.length,
    errores: [],
  };

  for (const item of pendientes) {
    if (!sigue()) break;
    const ahora = new Date().toISOString();
    try {
      const respuesta = await cliente.get(ruta.get(item.item_id));
      const clips = normalizarClips(respuesta);
      const vivo = tieneClipVivo(clips);
      const fuente = elegirClipFuente(clips);

      await upsertEnTandas(
        db,
        "clips_meli",
        [
          {
            account_id: accountId,
            item_id: item.item_id,
            modelo: item.modelo,
            titulo: item.titulo,
            color: item.color,
            estado_pub: item.estado,
            clips: clips.map((c) => c.crudo),
            tiene_clip: vivo,
            clip_url: fuente?.url ?? null,
            leido_en: ahora,
            estado: vivo ? "ok" : "sin_clip",
            ultimo_error: null,
            actualizado_en: ahora,
          },
        ],
        "account_id,item_id",
      );
      resultado.leidos++;
      if (vivo) resultado.conClip++;
    } catch (err) {
      // Un item que truena no detiene la corrida; queda contado y visible.
      const mensaje =
        err instanceof MeliError && err.cuerpo
          ? JSON.stringify(err.cuerpo).slice(0, 300)
          : (err as Error).message.slice(0, 300);
      await upsertEnTandas(
        db,
        "clips_meli",
        [
          {
            account_id: accountId,
            item_id: item.item_id,
            modelo: item.modelo,
            titulo: item.titulo,
            color: item.color,
            estado_pub: item.estado,
            leido_en: ahora,
            estado: "error",
            ultimo_error: mensaje,
            actualizado_en: ahora,
          },
        ],
        "account_id,item_id",
      );
      resultado.errores.push(`${item.item_id}: ${mensaje.slice(0, 120)}`);
    }
    resultado.restantes--;
    await dormir(200);
  }

  return resultado;
}

export interface ResultadoSubida {
  subidos: number;
  fallidos: number;
  restantes: number;
}

/** Tope de descarga por video: los clips de MELI aceptan hasta 280 MB. */
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/**
 * Sube los clips encolados (estado `pendiente`): descarga el video de la
 * fuente (el clip de la hermana o el video del ERP) y lo manda a MELI, que
 * lo pasa por su moderación. Solo cuando MELI acepta la subida, la fila pasa
 * a `ok`; si rechaza, el error queda textual y visible en la sección.
 */
export async function subirClipsPendientes(
  db: DB,
  cliente: MeliClient,
  accountId: string,
  ruta: RutaClips,
  sigue: () => boolean,
): Promise<ResultadoSubida> {
  const { data: cola, error } = await db
    .from("clips_meli")
    .select("item_id, origen_item_id, origen_video_url")
    .eq("account_id", accountId)
    .eq("estado", "pendiente")
    .order("item_id")
    .limit(500);
  if (error) throw new Error(`clips_meli: ${error.message}`);

  const resultado: ResultadoSubida = { subidos: 0, fallidos: 0, restantes: cola?.length ?? 0 };

  // El mismo video suele repetirse en muchas hermanas: se descarga UNA vez
  // por corrida, no una por publicación.
  const descargas = new Map<string, Promise<Blob>>();
  const descargar = (url: string): Promise<Blob> => {
    let p = descargas.get(url);
    if (!p) {
      p = (async () => {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error(`No se pudo descargar el video (${r.status}).`);
        const bytes = await r.arrayBuffer();
        if (bytes.byteLength > MAX_VIDEO_BYTES) {
          throw new Error("El video pesa más de 200 MB; MELI no lo va a aceptar.");
        }
        if (bytes.byteLength < 1024) {
          throw new Error("La descarga del video llegó vacía.");
        }
        return new Blob([bytes], { type: "video/mp4" });
      })();
      descargas.set(url, p);
    }
    return p;
  };

  for (const fila of cola ?? []) {
    if (!sigue()) break;
    const ahora = new Date().toISOString();
    try {
      if (!fila.origen_video_url) throw new Error("La fila encolada no trae video fuente.");
      const video = await descargar(fila.origen_video_url as string);

      const form = new FormData();
      form.append("file", video, "clip.mp4");
      const respuesta = await cliente.postForm(ruta.upload(fila.item_id as string), form);

      await db
        .from("clips_meli")
        .update({
          estado: "ok",
          tiene_clip: true,
          clips: [{ subido_por_erp: true, respuesta: respuesta ?? null, en: ahora }],
          ultimo_error: null,
          aplicado_en: ahora,
          actualizado_en: ahora,
        })
        .eq("account_id", accountId)
        .eq("item_id", fila.item_id);
      resultado.subidos++;
    } catch (err) {
      const mensaje =
        err instanceof MeliError && err.cuerpo
          ? JSON.stringify(err.cuerpo).slice(0, 500)
          : (err as Error).message.slice(0, 500);
      await db
        .from("clips_meli")
        .update({ estado: "error", ultimo_error: mensaje, actualizado_en: ahora })
        .eq("account_id", accountId)
        .eq("item_id", fila.item_id);
      resultado.fallidos++;
    }
    resultado.restantes--;
    await dormir(400);
  }

  return resultado;
}

/**
 * Los videos del ERP (videos_producto completados) por modelo, como respaldo
 * cuando ninguna hermana tiene clip con URL. Se prefiere la copia permanente
 * en Storage; la del CDN de Higgsfield caduca a los días.
 */
export async function videosErpPorModelo(
  db: DB,
  accountId: string,
): Promise<Map<string, string>> {
  const { data } = await db
    .from("videos_producto")
    .select("sku, item_id, video_guardado, video_url, creado_en")
    .eq("account_id", accountId)
    .eq("estado", "completado")
    .order("creado_en", { ascending: false })
    .limit(1000);

  const porItem = new Map<string, string>();
  const porSku = new Map<string, string>();
  for (const v of data ?? []) {
    const url = (v.video_guardado as string | null) ?? (v.video_url as string | null);
    if (!url) continue;
    if (v.item_id && !porItem.has(v.item_id)) porItem.set(v.item_id as string, url);
    if (v.sku && !porSku.has(v.sku)) porSku.set(v.sku as string, url);
  }
  if (!porItem.size && !porSku.size) return new Map();

  // El video se amarra a su modelo por el item o el SKU del que se generó.
  const skus = await traerTodo<{ sku: string; item_id: string | null; modelo: string | null }>(
    db,
    "skus",
    "sku, item_id, modelo",
    (q) => q.eq("account_id", accountId).eq("activo", true).not("modelo", "is", null),
  );
  const porModelo = new Map<string, string>();
  for (const s of skus) {
    if (porModelo.has(s.modelo!)) continue;
    const url = (s.item_id && porItem.get(s.item_id)) || porSku.get(s.sku);
    if (url) porModelo.set(s.modelo!, url);
  }
  return porModelo;
}

/**
 * Enciende el proceso de clips en segundo plano (contesta 202 y trabaja
 * después). Mismo esquema que fiscal y skus pendientes: de servidor a
 * servidor con CRON_SECRET y, si falta, con las cookies de la sesión.
 */
export async function dispararProcesoClips(
  origen: string,
  cookies?: string | null,
): Promise<void> {
  const secreto = process.env.CRON_SECRET;
  try {
    if (secreto) {
      await fetch(`${origen}/api/clips/procesar`, {
        method: "POST",
        headers: { authorization: `Bearer ${secreto}` },
        signal: AbortSignal.timeout(10_000),
      });
      return;
    }
    if (cookies) {
      await fetch(`${origen}/api/clips/procesar`, {
        method: "GET",
        headers: { cookie: cookies },
        signal: AbortSignal.timeout(10_000),
      });
      return;
    }
    console.error(
      "dispararProcesoClips: falta CRON_SECRET y no hay sesión; el proceso queda apagado.",
    );
  } catch (err) {
    console.error("dispararProcesoClips: no prendió:", (err as Error).message);
  }
}
