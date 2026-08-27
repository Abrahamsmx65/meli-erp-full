/**
 * Cliente de Amazon SP-API para el servidor.
 *
 * Las credenciales viven en Supabase (tabla `amazon_tokens`), no en variables
 * de entorno: así el mismo conector corre en Vercel, en una Mac o donde sea,
 * sin capturar nada dos veces. Esa tabla solo la alcanza la service_role.
 *
 * SP-API dejó de requerir firma AWS SigV4 en octubre de 2023: basta el access
 * token de LWA en el encabezado `x-amz-access-token`.
 */

const ENDPOINTS: Record<string, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};

const URL_LWA = "https://api.amazon.com/auth/o2/token";

/** Cuotas publicadas por Amazon: [peticiones por segundo, ráfaga]. */
const CUOTAS: Record<string, [number, number]> = {
  getOrders: [0.0167, 20],
  getOrderItems: [0.5, 30],
  createReport: [0.0167, 15],
  getReport: [2, 15],
  getReportDocument: [0.0167, 15],
  getShipments: [2, 30],
  getShipmentItems: [2, 30],
  getInventorySummaries: [2, 2],
};

export interface CuentaAmazon {
  accountId: string;
  nombre: string | null;
  marketplaceId: string;
  region: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export class ErrorAmazon extends Error {
  constructor(
    readonly status: number,
    readonly ruta: string,
    readonly detalle: string,
  ) {
    super(`SP-API ${status} en ${ruta}: ${detalle.slice(0, 400)}`);
  }
}

/** Lee las cuentas de Amazon con sus credenciales. Requiere service_role. */
export async function cuentasAmazon(admin: any): Promise<CuentaAmazon[]> {
  const { data, error } = await admin
    .from("amazon_accounts")
    .select(
      "id, nombre, marketplace_id, region, amazon_tokens(refresh_token, lwa_client_id, lwa_client_secret)",
    );
  if (error) throw new Error(`amazon_accounts: ${error.message}`);

  const salida: CuentaAmazon[] = [];
  for (const c of (data ?? []) as any[]) {
    // El join llega como objeto o como arreglo según la cardinalidad.
    const t = Array.isArray(c.amazon_tokens) ? c.amazon_tokens[0] : c.amazon_tokens;
    if (!t?.refresh_token || !t?.lwa_client_id || !t?.lwa_client_secret) continue;
    salida.push({
      accountId: c.id,
      nombre: c.nombre ?? null,
      marketplaceId: c.marketplace_id,
      region: c.region ?? "na",
      clientId: t.lwa_client_id,
      clientSecret: t.lwa_client_secret,
      refreshToken: t.refresh_token,
    });
  }
  return salida;
}

export class Cliente {
  private token: string | null = null;
  private expira = 0;
  private ultimaLlamada: Record<string, number> = {};
  private restante: Record<string, number> = {};

  constructor(
    readonly cuenta: CuentaAmazon,
    /** Momento (ms) a partir del cual hay que rendirse: Vercel corta a los 300 s. */
    private readonly limite: number,
  ) {}

  get endpoint(): string {
    return ENDPOINTS[this.cuenta.region] ?? ENDPOINTS.na;
  }

  /** Cuánto tiempo queda antes de que la función se quede sin plazo. */
  msRestantes(): number {
    return this.limite - Date.now();
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.expira - 60_000) return this.token;

    const r = await fetch(URL_LWA, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.cuenta.refreshToken,
        client_id: this.cuenta.clientId,
        client_secret: this.cuenta.clientSecret,
      }),
    });

    const cuerpo = await r.text();
    if (!r.ok) {
      throw new ErrorAmazon(
        r.status,
        "auth/o2/token",
        `Amazon rechazó el refresh token. ${cuerpo}`,
      );
    }
    const d = JSON.parse(cuerpo) as { access_token: string; expires_in?: number };
    this.token = d.access_token;
    this.expira = Date.now() + (d.expires_in ?? 3600) * 1000;
    return this.token;
  }

  /**
   * Espera lo necesario para no rebasar la cuota de la operación.
   * Devuelve false si esperar dejaría a la función sin plazo.
   */
  private async esperarCuota(operacion: string): Promise<boolean> {
    const [rps, rafaga] = CUOTAS[operacion] ?? [1, 5];
    const disponibles = this.restante[operacion] ?? rafaga;

    if (disponibles > 0) {
      this.restante[operacion] = disponibles - 1;
      this.ultimaLlamada[operacion] = Date.now();
      return true;
    }

    const desde = this.ultimaLlamada[operacion] ?? 0;
    const pausa = Math.max(0, 1000 / rps - (Date.now() - desde));
    // Dejar 20 s de margen para poder guardar lo ya conseguido.
    if (pausa > this.msRestantes() - 20_000) return false;

    if (pausa > 0) await new Promise((r) => setTimeout(r, pausa));
    this.ultimaLlamada[operacion] = Date.now();
    return true;
  }

  async llamar<T = any>(
    metodo: "GET" | "POST",
    ruta: string,
    operacion: string,
    opciones: { params?: Record<string, string | number | undefined>; cuerpo?: unknown } = {},
  ): Promise<T | null> {
    if (!(await this.esperarCuota(operacion))) return null;

    const url = new URL(this.endpoint + ruta);
    for (const [k, v] of Object.entries(opciones.params ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    for (let intento = 0; intento < 4; intento++) {
      const r = await fetch(url, {
        method: metodo,
        headers: {
          "x-amz-access-token": await this.accessToken(),
          ...(opciones.cuerpo ? { "content-type": "application/json" } : {}),
        },
        body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
      });

      if (r.ok) {
        const texto = await r.text();
        return texto ? (JSON.parse(texto) as T) : null;
      }

      const detalle = await r.text();

      // 429 y 5xx se reintentan; el resto es error real.
      if (r.status === 429 || r.status >= 500) {
        const espera = Math.min(3000 * 2 ** intento, 30_000);
        if (espera > this.msRestantes() - 20_000) return null;
        await new Promise((res) => setTimeout(res, espera));
        continue;
      }

      throw new ErrorAmazon(r.status, ruta, detalle);
    }
    return null;
  }
}
