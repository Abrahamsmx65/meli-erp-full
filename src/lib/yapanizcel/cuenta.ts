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
  /** Pedidos a China: un SKU solo se pide si le faltan al menos estas unidades. */
  pedidoMinimo: number;
  /** Pedidos a China: lo pedido se redondea hacia arriba a este múltiplo. */
  pedidoMultiplo: number;
  /** Pedidos a China: múltiplo por diseño cuando difiere del general ({ "662": 20 }). */
  pedidoMultiplos: Record<string, number>;
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
  // A China solo se pide lo que de verdad hace falta: un SKU al que le
  // faltan menos de 50 unidades no se pide, y lo que se pide va en números
  // cerrados de 10 en 10 (el 662 de 20 en 20: «es 40 o 60, no 50»).
  // Decisión del dueño, 21-oct-2026.
  pedidoMinimo: 50,
  pedidoMultiplo: 10,
  pedidoMultiplos: { "662": 20 },
};

/** Los múltiplos por diseño tal como vienen de la base: solo enteros ≥ 1. */
export function multiplosPorDiseno(crudo: unknown): Record<string, number> {
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(crudo as Record<string, unknown>)) {
    const n = Math.round(Number(v));
    const clave = k.trim().toUpperCase();
    if (clave && Number.isFinite(n) && n >= 1) out[clave] = n;
  }
  return out;
}

export async function leerParametros(db: DB, accountId: string): Promise<ParametrosYz> {
  const { data } = await db
    .from("yz_parametros")
    .select("dias_venta, dias_objetivo, multiplo_envio, minimo_envio, dias_caducidad_envio, pedido_minimo, pedido_multiplo, pedido_multiplos")
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
    pedidoMinimo: data.pedido_minimo ?? PARAMETROS_POR_OMISION.pedidoMinimo,
    pedidoMultiplo: data.pedido_multiplo ?? PARAMETROS_POR_OMISION.pedidoMultiplo,
    pedidoMultiplos:
      data.pedido_multiplos == null ? { ...PARAMETROS_POR_OMISION.pedidoMultiplos } : multiplosPorDiseno(data.pedido_multiplos),
  };
}

/**
 * Los diseños elegidos en Pedidos a China (`yz_parametros.pedidos_disenos`,
 * migración 0150). Se guardan por cuenta y se conservan tal cual —NO se
 * recortan contra el catálogo del momento— hasta que el dueño los quite.
 */
export async function leerDisenosElegidos(db: DB, accountId: string): Promise<string[]> {
  const { data } = await db.from("yz_parametros").select("pedidos_disenos").eq("account_id", accountId).maybeSingle();
  const lista = (data as { pedidos_disenos?: unknown } | null)?.pedidos_disenos;
  return Array.isArray(lista) ? lista.map((d) => String(d)) : [];
}

export async function guardarDisenosElegidos(db: DB, accountId: string, disenos: string[]): Promise<void> {
  const { error } = await db
    .from("yz_parametros")
    .upsert({ account_id: accountId, pedidos_disenos: disenos, actualizado_en: new Date().toISOString() }, { onConflict: "account_id" });
  if (error) throw new Error(error.message);
}

/**
 * Los múltiplos por diseño como los escribe el dueño en Configuración:
 * «662=20, 714=50» (también «662:20» o uno por renglón). Vacío = ninguno.
 */
export function multiplosDeTexto(texto: string): { ok: true; valor: Record<string, number> } | { ok: false; malo: string } {
  const valor: Record<string, number> = {};
  for (const pedazo of texto.split(/[,;\n]+/)) {
    const t = pedazo.trim();
    if (!t) continue;
    const m = /^([A-Za-z0-9-]+)\s*[=:]\s*(\d+)$/.exec(t);
    const n = m ? Number(m[2]) : NaN;
    if (!m || !Number.isFinite(n) || n < 1) return { ok: false, malo: t };
    valor[m[1].toUpperCase()] = n;
  }
  return { ok: true, valor };
}

/** Lo inverso: para pintar el campo del formulario. */
export function textoDeMultiplos(m: Record<string, number>): string {
  return Object.entries(m)
    .sort(([a], [b]) => a.localeCompare(b, "es", { numeric: true }))
    .map(([d, n]) => `${d}=${n}`)
    .join(", ");
}
