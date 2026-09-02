/**
 * La cuenta de Mercado Libre de YAPANIZCEL y su cliente.
 *
 * Es OTRA cuenta y OTRA aplicación de Mercado Libre que la del calzado, con
 * su propio client id, su propio secreto y su propia redirect URI. Por eso
 * lee variables de entorno propias (`MELI_YZ_*`) y guarda sus tokens en
 * `yz_tokens`, no en `meli_tokens`.
 *
 * El cliente HTTP sí se reutiliza tal cual: renovar tokens, respetar los
 * límites de tasa y reintentar es idéntico en cualquier cuenta.
 */
import { MeliClient, type Credenciales } from "../meli/client";
import type { DB } from "../datos/repos";

export interface CredencialesApp {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  siteId: string;
}

/**
 * Credenciales de la APLICACIÓN de MELI de YAPANIZCEL.
 *
 * Devuelve null (en vez de tronar) cuando faltan, para que la pantalla de
 * ajustes pueda decir "falta configurar esto" en vez de reventar.
 */
export function credencialesApp(): CredencialesApp | null {
  const clientId = (process.env.MELI_YZ_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.MELI_YZ_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return null;

  const redirectUri =
    (process.env.MELI_YZ_REDIRECT_URI ?? "").trim() ||
    `${(process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "")}/api/yapanizcel/meli/callback`;

  return {
    clientId,
    clientSecret,
    redirectUri,
    siteId: (process.env.MELI_YZ_SITE_ID ?? "MLM").trim() || "MLM",
  };
}

export interface CuentaYz {
  id: string;
  meli_user_id: number;
  nickname: string | null;
  site_id: string;
}

/** La cuenta conectada. Solo hay una, pero la consulta va por si acaso. */
export async function cuentaActiva(db: DB): Promise<CuentaYz | null> {
  const { data } = await db
    .from("yz_cuentas")
    .select("id, meli_user_id, nickname, site_id")
    .order("creado_en", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as CuentaYz) ?? null;
}

/**
 * Cliente de MELI para una cuenta, con los tokens de `yz_tokens`.
 *
 * Necesita el cliente de service_role: `yz_tokens` tiene RLS sin políticas
 * a propósito, así que desde el navegador no se alcanza ni con sesión.
 *
 * MELI ROTA el refresh token en cada renovación, así que `alRenovar` guarda
 * el par nuevo de inmediato: si se pierde, hay que volver a autorizar a mano.
 */
export async function clienteDeCuenta(admin: DB, accountId: string): Promise<MeliClient> {
  const app = credencialesApp();
  if (!app) {
    throw new Error(
      "Faltan MELI_YZ_CLIENT_ID y MELI_YZ_CLIENT_SECRET en el entorno: son las credenciales de la aplicación de Mercado Libre de YAPANIZCEL, distintas a las del ERP de calzado.",
    );
  }

  const { data, error } = await admin
    .from("yz_tokens")
    .select("access_token, refresh_token, expira_en")
    .eq("account_id", accountId)
    .maybeSingle();

  if (error) throw new Error(`No se pudieron leer los tokens: ${error.message}`);
  if (!data) {
    throw new Error("La cuenta de YAPANIZCEL no está conectada con Mercado Libre.");
  }

  const credenciales: Credenciales = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiraEn: Date.parse(data.expira_en),
  };

  return new MeliClient({
    clientId: app.clientId,
    clientSecret: app.clientSecret,
    credenciales,
    alRenovar: async (c) => {
      await admin.from("yz_tokens").upsert(
        {
          account_id: accountId,
          access_token: c.accessToken,
          refresh_token: c.refreshToken,
          expira_en: new Date(c.expiraEn).toISOString(),
          actualizado_en: new Date().toISOString(),
        },
        { onConflict: "account_id" },
      );
    },
  });
}

/** Parámetros del planeador, con los valores por omisión del negocio. */
export interface ParametrosYz {
  diasVenta: number;
  diasObjetivo: number;
  multiploEnvio: number;
  minimoEnvio: number;
  diasCaducidadEnvio: number;
}

export const PARAMETROS_POR_OMISION: ParametrosYz = {
  diasVenta: 30,
  // 15 días de cobertura en Full, no 30: el espacio en Full es poco y el
  // dueño prefiere mandar seguido a tener de más. La venta se sigue midiendo
  // con 30 días para que una semana rara no mueva el cálculo.
  diasObjetivo: 15,
  // A Full se manda en DECENAS CERRADAS: es regla de la operación, no un
  // redondeo cosmético.
  multiploEnvio: 10,
  minimoEnvio: 10,
  diasCaducidadEnvio: 10,
};

export async function leerParametros(db: DB, accountId: string): Promise<ParametrosYz> {
  const { data } = await db
    .from("yz_parametros")
    .select("dias_venta, dias_objetivo, multiplo_envio, minimo_envio, dias_caducidad_envio")
    .eq("account_id", accountId)
    .maybeSingle();

  if (!data) return { ...PARAMETROS_POR_OMISION };
  return {
    diasVenta: data.dias_venta ?? PARAMETROS_POR_OMISION.diasVenta,
    diasObjetivo: data.dias_objetivo ?? PARAMETROS_POR_OMISION.diasObjetivo,
    multiploEnvio: data.multiplo_envio ?? PARAMETROS_POR_OMISION.multiploEnvio,
    minimoEnvio: data.minimo_envio ?? PARAMETROS_POR_OMISION.minimoEnvio,
    diasCaducidadEnvio:
      data.dias_caducidad_envio ?? PARAMETROS_POR_OMISION.diasCaducidadEnvio,
  };
}
