/**
 * La COLA de constancias por guardar de la estación de preparar, para cuando
 * el wifi de la bodega falla (dueño, 7-oct-2026: «a veces no hay buena señal
 * y cuando escanean los pedidos no jala bien la info; que tengan como un
 * caché en la página que guarde toda la info y se vaya actualizando como
 * puede con el wifi»).
 *
 * El escaneo en sí nunca necesitó red: `avanzar` decide todo en el
 * navegador con los paquetes que la página ya trae. Lo único que viajaba
 * era el POST de la constancia, y si fallaba el paquete se quedaba sin
 * marcar y el operador tenía que volver a escanearlo. Ahora, si el POST
 * falla POR RED, la constancia se guarda en `localStorage` bajo la clave del
 * corte, el paquete se da por preparado en ese dispositivo y la cola se
 * reintenta sola (cada rato, al volver la conexión y tras cada guardado que
 * sí entra). Un rechazo del SERVIDOR (clave mala, corte ajeno, 500) NO es
 * red: ese no se encola, se enseña.
 *
 * Motor puro: la pantalla le pasa el `Storage` y las fechas.
 */

export interface PendienteGuardar {
  numero: number;
  orderId: string;
  packageId: string;
  escaneos: string[];
  /** cuándo se escaneó (ISO) */
  en: string;
}

export const PREFIJO_COLA = "tiktok-preparados-pendientes:";
/** cada cuánto se reintenta la cola aunque el navegador no avise que volvió la red */
export const MS_REINTENTO_COLA = 15_000;

export function claveCola(corteId: number): string {
  return `${PREFIJO_COLA}${corteId}`;
}

export function clavePendiente(p: { orderId: string; packageId: string }): string {
  return `${p.orderId}|${p.packageId ?? ""}`;
}

export interface AlmacenCola {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** Lee la cola guardada; un valor corrupto o un storage que truena cuentan como vacía. */
export function leerCola(storage: AlmacenCola | null | undefined, corteId: number): PendienteGuardar[] {
  if (!storage) return [];
  try {
    const crudo = storage.getItem(claveCola(corteId));
    if (!crudo) return [];
    const lista = JSON.parse(crudo);
    if (!Array.isArray(lista)) return [];
    return lista
      .filter((p) => p && Number.isFinite(Number(p.numero)) && typeof p.orderId === "string" && p.orderId)
      .map((p) => ({
        numero: Number(p.numero),
        orderId: String(p.orderId),
        packageId: String(p.packageId ?? ""),
        escaneos: Array.isArray(p.escaneos) ? p.escaneos.map(String) : [],
        en: typeof p.en === "string" ? p.en : new Date(0).toISOString(),
      }));
  } catch {
    return [];
  }
}

/** Guarda la cola; con la lista vacía borra la clave. Un storage lleno o bloqueado no truena la estación. */
export function guardarCola(storage: AlmacenCola | null | undefined, corteId: number, items: PendienteGuardar[]): boolean {
  if (!storage) return false;
  try {
    if (!items.length) storage.removeItem(claveCola(corteId));
    else storage.setItem(claveCola(corteId), JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}

/** Agrega (o reemplaza, por pedido + paquete) una constancia a la cola. */
export function agregarACola(items: PendienteGuardar[], nuevo: PendienteGuardar): PendienteGuardar[] {
  const clave = clavePendiente(nuevo);
  return [...items.filter((p) => clavePendiente(p) !== clave), nuevo];
}

export function quitarDeCola(items: PendienteGuardar[], guardado: { orderId: string; packageId: string }): PendienteGuardar[] {
  const clave = clavePendiente(guardado);
  return items.filter((p) => clavePendiente(p) !== clave);
}

/**
 * Un fallo de RED del `fetch` del navegador: «Failed to fetch» (Chrome),
 * «Load failed» (Safari), «NetworkError…» (Firefox), o la conexión abortada.
 * Todo lo demás (un JSON de error del servidor, un 4xx/5xx) NO es red.
 */
export function esErrorDeRed(err: unknown): boolean {
  if (!err) return false;
  const nombre = (err as { name?: string }).name ?? "";
  const m = err instanceof Error ? err.message : String(err);
  if (nombre === "AbortError" || nombre === "TimeoutError") return true;
  return /failed to fetch|load failed|networkerror|network request failed|the internet connection appears to be offline|fetch failed/i.test(m);
}

/** El texto del indicador de la cola para la pantalla. */
export function textoDeCola(pendientes: number, enLinea: boolean): string | null {
  if (pendientes <= 0) return null;
  const n = `${pendientes} ${pendientes === 1 ? "paquete" : "paquetes"} por guardar`;
  return enLinea ? `${n} · mandando…` : `${n} · sin señal, se mandan solos al volver el wifi`;
}
