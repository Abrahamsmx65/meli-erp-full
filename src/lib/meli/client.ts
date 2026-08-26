/**
 * Cliente HTTP de la API de Mercado Libre.
 *
 * Se encarga de tres cosas que dan lata si no se centralizan: renovar el
 * access token cuando expira, respetar los límites de tasa sin tumbar la
 * sincronización, y reintentar los errores que sí vale la pena reintentar.
 */

export const MELI_API = "https://api.mercadolibre.com";

export class MeliError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly cuerpo?: unknown,
    readonly url?: string,
  ) {
    super(message);
    this.name = "MeliError";
  }
}

export interface Credenciales {
  accessToken: string;
  refreshToken: string;
  /** epoch ms en que expira el access token */
  expiraEn: number;
}

export interface OpcionesCliente {
  clientId: string;
  clientSecret: string;
  /** prefijo de ruta: "" para vendedor local, "/marketplace" para Global Selling */
  apiPrefix?: string;
  credenciales: Credenciales;
  /** se llama cuando el token se renueva, para persistir el nuevo par */
  alRenovar?: (c: Credenciales) => Promise<void>;
}

const REINTENTABLES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_REINTENTOS = 4;

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class MeliClient {
  private cred: Credenciales;
  private renovando: Promise<void> | null = null;
  private ultimoScope: string | null = null;

  constructor(private readonly opts: OpcionesCliente) {
    this.cred = { ...opts.credenciales };
  }

  get credenciales(): Credenciales {
    return { ...this.cred };
  }

  /** Scopes que MELI reportó en la ÚLTIMA renovación de token; null = aún no renueva. */
  get scope(): string | null {
    return this.ultimoScope;
  }

  /** Fuerza una renovación de token (para diagnóstico: ver los scopes reales). */
  async renovarAhora(): Promise<void> {
    await this.renovar();
  }

  private get prefix(): string {
    return this.opts.apiPrefix ?? "";
  }

  /** Renueva el access token. MELI rota el refresh token en cada uso: hay que guardar el nuevo. */
  private async renovar(): Promise<void> {
    if (this.renovando) return this.renovando;

    this.renovando = (async () => {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.opts.clientId,
        client_secret: this.opts.clientSecret,
        refresh_token: this.cred.refreshToken,
      });

      const res = await fetch(`${MELI_API}/oauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
        cache: "no-store",
      });

      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new MeliError(
          `No se pudo renovar el token: ${JSON.stringify(json)}`,
          res.status,
          json,
          "/oauth/token",
        );
      }

      this.cred = {
        accessToken: String(json.access_token),
        // Si por alguna razón no viene uno nuevo, conservamos el anterior.
        refreshToken: String(json.refresh_token ?? this.cred.refreshToken),
        expiraEn: Date.now() + Number(json.expires_in ?? 21600) * 1000,
      };
      this.ultimoScope = typeof json.scope === "string" ? json.scope : null;

      await this.opts.alRenovar?.(this.cred);
    })();

    try {
      await this.renovando;
    } finally {
      this.renovando = null;
    }
  }

  private async asegurarToken(): Promise<void> {
    // Margen de 5 minutos para no chocar con la expiración a media petición.
    if (Date.now() >= this.cred.expiraEn - 5 * 60_000) {
      await this.renovar();
    }
  }

  /**
   * GET a la API con renovación de token, reintentos y backoff.
   * `opts.reintentos` acota los reintentos: los sondeos de diagnóstico
   * quieren la PRIMERA respuesta (un 500 repetido 4 veces con backoff se
   * come el presupuesto de la función), no insistir.
   */
  async get<T = unknown>(
    ruta: string,
    params?: Record<string, string | number | undefined | null>,
    opts?: { reintentos?: number; headers?: Record<string, string> },
  ): Promise<T> {
    await this.asegurarToken();
    const maxReintentos = opts?.reintentos ?? MAX_REINTENTOS;

    const url = new URL(`${MELI_API}${this.prefix}${ruta}`);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }

    let ultimoError: unknown;

    for (let intento = 0; intento <= maxReintentos; intento++) {
      try {
        const res = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${this.cred.accessToken}`,
            Accept: "application/json",
            // El API de publicidad exige su versión por header (Api-Version).
            ...(opts?.headers ?? {}),
          },
          cache: "no-store",
        });

        if (res.status === 401 && intento === 0) {
          // Token muerto antes de tiempo: renovar y repetir una vez.
          await this.renovar();
          continue;
        }

        if (REINTENTABLES.has(res.status) && intento < maxReintentos) {
          const reintentarEn = Number(res.headers.get("Retry-After") ?? 0);
          const espera = reintentarEn > 0
            ? reintentarEn * 1000
            : Math.min(15_000, 2 ** intento * 500 + Math.random() * 300);
          await dormir(espera);
          continue;
        }

        const texto = await res.text();
        const json = texto ? safeJson(texto) : null;

        if (!res.ok) {
          throw new MeliError(
            `MELI ${res.status} en ${ruta}: ${texto.slice(0, 400)}`,
            res.status,
            json,
            url.pathname,
          );
        }

        return json as T;
      } catch (err) {
        ultimoError = err;
        // Errores de red: reintentar. Errores de MELI ya resueltos: propagar.
        if (err instanceof MeliError) throw err;
        if (intento >= maxReintentos) break;
        await dormir(Math.min(15_000, 2 ** intento * 500));
      }
    }

    throw ultimoError instanceof Error
      ? ultimoError
      : new MeliError(`Falló ${ruta}`, 0, ultimoError, ruta);
  }

  /**
   * POST con cuerpo JSON, con la misma renovación de token y reintentos que
   * el GET. Lo usa el API de datos fiscales (GraphQL) y cualquier recurso de
   * MELI que se escriba.
   */
  async post<T = unknown>(ruta: string, cuerpo: unknown): Promise<T> {
    return this.conCuerpo<T>("POST", ruta, cuerpo);
  }

  /**
   * PUT con cuerpo JSON (modificar un recurso: pausar un anuncio, cambiar el
   * presupuesto de una campaña). Mismos reintentos que el POST; el API de
   * publicidad exige además su versión por header.
   */
  async put<T = unknown>(
    ruta: string,
    cuerpo: unknown,
    opts?: { headers?: Record<string, string>; reintentos?: number },
  ): Promise<T> {
    return this.conCuerpo<T>("PUT", ruta, cuerpo, opts);
  }

  private async conCuerpo<T = unknown>(
    metodo: "POST" | "PUT",
    ruta: string,
    cuerpo: unknown,
    opts?: { headers?: Record<string, string>; reintentos?: number },
  ): Promise<T> {
    await this.asegurarToken();
    const url = `${MELI_API}${this.prefix}${ruta}`;
    const maxReintentos = opts?.reintentos ?? MAX_REINTENTOS;
    let ultimoError: unknown;

    for (let intento = 0; intento <= maxReintentos; intento++) {
      try {
        const res = await fetch(url, {
          method: metodo,
          headers: {
            Authorization: `Bearer ${this.cred.accessToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(opts?.headers ?? {}),
          },
          body: JSON.stringify(cuerpo ?? {}),
          cache: "no-store",
        });

        if (res.status === 401 && intento === 0) {
          await this.renovar();
          continue;
        }
        if (REINTENTABLES.has(res.status) && intento < maxReintentos) {
          const reintentarEn = Number(res.headers.get("Retry-After") ?? 0);
          const espera = reintentarEn > 0
            ? reintentarEn * 1000
            : Math.min(15_000, 2 ** intento * 500 + Math.random() * 300);
          await dormir(espera);
          continue;
        }

        const texto = await res.text();
        const json = texto ? safeJson(texto) : null;
        if (!res.ok) {
          throw new MeliError(
            `MELI ${res.status} en ${ruta}: ${texto.slice(0, 400)}`,
            res.status,
            json,
            ruta,
          );
        }
        return json as T;
      } catch (err) {
        ultimoError = err;
        if (err instanceof MeliError) throw err;
        if (intento >= maxReintentos) break;
        await dormir(Math.min(15_000, 2 ** intento * 500));
      }
    }

    throw ultimoError instanceof Error
      ? ultimoError
      : new MeliError(`Falló ${ruta}`, 0, ultimoError, ruta);
  }
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

/**
 * Corre tareas en paralelo pero con la llave apretada.
 * MELI tumba las ráfagas grandes; 5 en vuelo es el punto dulce entre
 * "termina rápido" y "no me banean".
 */
export async function enLotes<T, R>(
  items: T[],
  tamano: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const salida: R[] = new Array(items.length);
  let cursor = 0;

  const trabajador = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      salida[i] = await fn(items[i], i);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(tamano, items.length) }, trabajador),
  );
  return salida;
}

/** Parte un arreglo en trozos de tamaño `n`. */
export function trozos<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
