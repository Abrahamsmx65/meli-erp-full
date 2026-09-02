/**
 * Cliente del API de TikTok Shop Partner para el servidor.
 *
 * Igual que con Mercado Libre y Amazon, las credenciales de la tienda viven
 * en Supabase (`tiktok_tokens`, con RLS y cero políticas) y solo la
 * service_role las alcanza. En el entorno únicamente van las de la APP
 * (`TIKTOK_APP_KEY` y `TIKTOK_APP_SECRET`), que son de la integración, no de
 * la tienda.
 *
 * Dos detalles de TikTok que no se parecen a los otros dos canales:
 *
 *   · El access token dura 7 días y el refresh 365. Se renueva solo al
 *     detectar que le quedan menos de 30 minutos, y el token nuevo se guarda
 *     en la base para que la siguiente corrida no vuelva a pedirlo.
 *   · Casi todas las rutas de tienda exigen el `shop_cipher`. Sin él
 *     contestan 105002 aunque el token esté perfecto, así que se agrega solo.
 */
import { firmar, timestamp } from "./firma";

const API = "https://open-api.tiktokglobalshop.com";
const AUTH = "https://auth.tiktok-shops.com";

/** Un token con menos de esto por delante se renueva antes de usarlo. */
const MARGEN_RENOVACION_MS = 30 * 60_000;

export interface CredencialesApp {
  appKey: string;
  appSecret: string;
}

export interface TiendaTikTok {
  accountId: string;
  shopId: string | null;
  shopCipher: string | null;
  warehouseId: string | null;
  accessToken: string;
  refreshToken: string;
  /** ISO */
  expiraEn: string;
}

export class ErrorTikTok extends Error {
  constructor(
    readonly codigo: number,
    readonly ruta: string,
    readonly detalle: string,
  ) {
    super(`TikTok Shop ${codigo} en ${ruta}: ${detalle.slice(0, 400)}`);
  }
}

/**
 * Las credenciales de la app, o null si no están puestas. Devolver null en
 * vez de tronar es a propósito: el resto del sistema —el kardex, las
 * entradas, la pantalla— funciona sin TikTok conectado, y solo la
 * sincronización se salta.
 */
export function configuracionTikTok(): CredencialesApp | null {
  const appKey = process.env.TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET;
  if (!appKey || !appSecret) return null;
  return { appKey, appSecret };
}

/** La tienda conectada con sus tokens. Requiere service_role. */
export async function tiendaTikTok(admin: any, accountId: string): Promise<TiendaTikTok | null> {
  const [{ data: tienda }, { data: tok }] = await Promise.all([
    admin
      .from("tiktok_tienda")
      .select("shop_id, shop_cipher, warehouse_id, activo")
      .eq("account_id", accountId)
      .maybeSingle(),
    admin
      .from("tiktok_tokens")
      .select("access_token, refresh_token, expira_en")
      .eq("account_id", accountId)
      .maybeSingle(),
  ]);

  if (!tienda?.activo || !tok?.access_token || !tok?.refresh_token) return null;

  return {
    accountId,
    shopId: tienda.shop_id ?? null,
    shopCipher: tienda.shop_cipher ?? null,
    warehouseId: tienda.warehouse_id ?? null,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiraEn: tok.expira_en,
  };
}

interface RespuestaToken {
  access_token: string;
  refresh_token: string;
  access_token_expire_in: number;
  refresh_token_expire_in: number;
}

/**
 * Cambia el `auth_code` que deja la pantalla de autorización por un par de
 * tokens. Es la única llamada que NO va firmada: el app_secret viaja como
 * parámetro porque todavía no hay nada que firmar.
 */
export async function canjearCodigo(
  app: CredencialesApp,
  authCode: string,
): Promise<RespuestaToken> {
  return pedirToken(`${AUTH}/api/v2/token/get`, {
    app_key: app.appKey,
    app_secret: app.appSecret,
    auth_code: authCode,
    grant_type: "authorized_code",
  });
}

export async function renovarToken(
  app: CredencialesApp,
  refreshToken: string,
): Promise<RespuestaToken> {
  return pedirToken(`${AUTH}/api/v2/token/refresh`, {
    app_key: app.appKey,
    app_secret: app.appSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
}

async function pedirToken(url: string, params: Record<string, string>): Promise<RespuestaToken> {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);

  const r = await fetch(u, { headers: { "content-type": "application/json" } });
  const texto = await r.text();
  let cuerpo: any = {};
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    throw new ErrorTikTok(r.status, "token", texto);
  }

  // TikTok contesta 200 aunque el token esté mal: el error real va adentro.
  if (cuerpo?.code !== 0 || !cuerpo?.data?.access_token) {
    throw new ErrorTikTok(cuerpo?.code ?? r.status, "token", cuerpo?.message ?? texto);
  }
  return cuerpo.data as RespuestaToken;
}

export class Cliente {
  private token: string;
  private expira: number;
  private refresh: string;

  constructor(
    private readonly app: CredencialesApp,
    readonly tienda: TiendaTikTok,
    /** A partir de este momento (ms) hay que rendirse: Vercel corta a los 300 s. */
    private readonly limite: number,
    /** Se llama cuando el token se renovó, para guardarlo. */
    private readonly alRenovar?: (t: RespuestaToken) => Promise<void>,
  ) {
    this.token = tienda.accessToken;
    this.refresh = tienda.refreshToken;
    this.expira = Date.parse(tienda.expiraEn) || 0;
  }

  msRestantes(): number {
    return this.limite - Date.now();
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.expira - MARGEN_RENOVACION_MS) return this.token;

    const t = await renovarToken(this.app, this.refresh);
    this.token = t.access_token;
    this.refresh = t.refresh_token;
    // TikTok manda el vencimiento como instante absoluto en segundos.
    this.expira = t.access_token_expire_in * 1000;
    await this.alRenovar?.(t);
    return this.token;
  }

  /**
   * Una llamada firmada. Devuelve `data` ya desenvuelto, o null si se acabó
   * el plazo de la función: quien llama guarda lo que ya consiguió y sigue
   * en la próxima corrida, que es mejor que perderlo todo.
   */
  async llamar<T = any>(
    metodo: "GET" | "POST" | "PUT",
    ruta: string,
    opciones: {
      params?: Record<string, string | number | undefined>;
      cuerpo?: unknown;
      /** false para las rutas que no son de tienda (autorización, etc.). */
      conCipher?: boolean;
    } = {},
  ): Promise<T | null> {
    if (this.msRestantes() < 5_000) return null;

    const cuerpo = opciones.cuerpo === undefined ? "" : JSON.stringify(opciones.cuerpo);
    const token = await this.accessToken();

    for (let intento = 0; intento < 4; intento++) {
      const params: Record<string, string | number> = {
        app_key: this.app.appKey,
        timestamp: timestamp(),
      };
      for (const [k, v] of Object.entries(opciones.params ?? {})) {
        if (v !== undefined && v !== null) params[k] = v;
      }
      if (opciones.conCipher !== false && this.tienda.shopCipher) {
        params.shop_cipher = this.tienda.shopCipher;
      }
      params.sign = firmar(ruta, params, cuerpo, this.app.appSecret);

      const url = new URL(API + ruta);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

      const r = await fetch(url, {
        method: metodo,
        headers: {
          "x-tts-access-token": token,
          "content-type": "application/json",
        },
        body: cuerpo || undefined,
      });

      const texto = await r.text();
      let json: any = null;
      try {
        json = texto ? JSON.parse(texto) : {};
      } catch {
        throw new ErrorTikTok(r.status, ruta, texto);
      }

      if (r.ok && json?.code === 0) return (json.data ?? {}) as T;

      // 429 y 5xx se reintentan con espera creciente; lo demás es error real.
      const reintentable = r.status === 429 || r.status >= 500 || json?.code === 90000;
      if (reintentable && intento < 3) {
        const espera = Math.min(2000 * 2 ** intento, 20_000);
        if (espera > this.msRestantes() - 10_000) return null;
        await new Promise((res) => setTimeout(res, espera));
        continue;
      }

      throw new ErrorTikTok(json?.code ?? r.status, ruta, json?.message ?? texto);
    }
    return null;
  }
}
