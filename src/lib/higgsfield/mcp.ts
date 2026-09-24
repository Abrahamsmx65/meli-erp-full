/**
 * Cliente del MCP oficial de Higgsfield (mcp.higgsfield.ai).
 *
 * Es OTRA superficie distinta a la llave de API: se autentica con OAuth
 * sobre la CUENTA del usuario (la de la suscripción) y expone lo que la
 * llave no tiene — el Marketing Studio con productos anclados a fotos
 * reales, avatares y Seedance 2.0. El flujo OAuth es estándar: registro
 * dinámico de cliente, authorization code + PKCE y refresh token con
 * offline_access (una vez conectado, no vuelve a pedir login).
 *
 * El protocolo es MCP por streamable HTTP: JSON-RPC en POST /mcp, con
 * respuestas que pueden venir como JSON directo o como SSE (una línea
 * `data: {...}`), y una sesión en el header Mcp-Session-Id.
 */

import type { clienteAdmin } from "@/lib/supabase/server";

export const MCP_BASE = "https://mcp.higgsfield.ai";
export const MCP_RECURSO = `${MCP_BASE}/mcp`;
export const MCP_SCOPE = "openid email offline_access";

type Admin = ReturnType<typeof clienteAdmin>;

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

/** Registra un cliente OAuth (registro dinámico, RFC 7591). */
export async function registrarCliente(redirectUri: string): Promise<string> {
  const res = await fetch(`${MCP_BASE}/oauth2/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "GETAC ERP",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: MCP_SCOPE,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(`No se pudo registrar el cliente OAuth (${res.status}): ${detalle.slice(0, 200)}`);
  }
  const cuerpo = (await res.json()) as { client_id?: string };
  if (!cuerpo.client_id) throw new Error("El registro OAuth no devolvió client_id.");
  return cuerpo.client_id;
}

export interface TokensMCP {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

/** Cambia el código de autorización (o un refresh token) por tokens. */
export async function pedirTokens(datos: {
  clientId: string;
  codigo?: string;
  codeVerifier?: string;
  redirectUri?: string;
  refreshToken?: string;
}): Promise<TokensMCP> {
  const cuerpo = new URLSearchParams();
  cuerpo.set("client_id", datos.clientId);
  cuerpo.set("resource", MCP_RECURSO);
  if (datos.refreshToken) {
    cuerpo.set("grant_type", "refresh_token");
    cuerpo.set("refresh_token", datos.refreshToken);
  } else {
    cuerpo.set("grant_type", "authorization_code");
    cuerpo.set("code", datos.codigo!);
    cuerpo.set("code_verifier", datos.codeVerifier!);
    cuerpo.set("redirect_uri", datos.redirectUri!);
  }

  const res = await fetch(`${MCP_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: cuerpo.toString(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(`Higgsfield no entregó tokens (${res.status}): ${detalle.slice(0, 200)}`);
  }
  return (await res.json()) as TokensMCP;
}

/**
 * El access token vigente de la cuenta; se refresca solo cuando está por
 * vencer (con margen de 2 minutos) y el refresh nuevo se guarda.
 */
export async function tokenVigente(admin: Admin, accountId: string): Promise<string> {
  const { data: fila } = await admin
    .from("higgsfield_mcp")
    .select("client_id, access_token, refresh_token, expira_en")
    .eq("account_id", accountId)
    .single();
  if (!fila) throw new Error("La cuenta de Higgsfield no está conectada.");

  const vence = fila.expira_en ? new Date(fila.expira_en as string).getTime() : 0;
  if (vence - Date.now() > 2 * 60_000) return fila.access_token as string;
  if (!fila.refresh_token) return fila.access_token as string;

  const tokens = await pedirTokens({
    clientId: fila.client_id as string,
    refreshToken: fila.refresh_token as string,
  });
  await admin
    .from("higgsfield_mcp")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? fila.refresh_token,
      expira_en: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
      actualizado_en: new Date().toISOString(),
    })
    .eq("account_id", accountId);
  return tokens.access_token;
}

// ---------------------------------------------------------------------------
// JSON-RPC sobre streamable HTTP
// ---------------------------------------------------------------------------

interface RespuestaRPC {
  cuerpo: any;
  sesion: string | null;
}

function extraerJSON(texto: string, contentType: string): any {
  if (contentType.includes("text/event-stream")) {
    // La respuesta SSE trae una o más líneas `data: {...}`; la última con
    // un id es la respuesta al request.
    let ultimo: any = null;
    for (const linea of texto.split("\n")) {
      const limpia = linea.trim();
      if (!limpia.startsWith("data:")) continue;
      try {
        const json = JSON.parse(limpia.slice(5).trim());
        if (json && Object.prototype.hasOwnProperty.call(json, "id")) ultimo = json;
      } catch {
        // Un evento no-JSON no estorba.
      }
    }
    return ultimo;
  }
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

async function rpc(
  token: string,
  metodo: string,
  params: unknown,
  sesion: string | null,
  id: number,
): Promise<RespuestaRPC> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sesion) headers["Mcp-Session-Id"] = sesion;

  const res = await fetch(MCP_RECURSO, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method: metodo, params }),
    signal: AbortSignal.timeout(120_000),
  });
  const texto = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`MCP contestó ${res.status} en ${metodo}: ${texto.slice(0, 300)}`);
  }
  return {
    cuerpo: extraerJSON(texto, res.headers.get("content-type") ?? ""),
    sesion: res.headers.get("mcp-session-id") ?? sesion,
  };
}

async function avisar(token: string, metodo: string, sesion: string | null): Promise<void> {
  // Las notificaciones (sin id) no esperan respuesta; un error no estorba.
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sesion) headers["Mcp-Session-Id"] = sesion;
  await fetch(MCP_RECURSO, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: metodo }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => undefined);
}

export interface SesionMCP {
  token: string;
  sesion: string | null;
}

/** Abre la sesión MCP (initialize + notificación de listo). */
export async function abrirSesion(admin: Admin, accountId: string): Promise<SesionMCP> {
  const token = await tokenVigente(admin, accountId);
  const inicio = await rpc(
    token,
    "initialize",
    {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "meli-erp", version: "1.0" },
    },
    null,
    1,
  );
  await avisar(token, "notifications/initialized", inicio.sesion);
  return { token, sesion: inicio.sesion };
}

/** Lista las herramientas que expone el MCP. */
export async function listarHerramientas(s: SesionMCP): Promise<any[]> {
  const res = await rpc(s.token, "tools/list", {}, s.sesion, 2);
  return res.cuerpo?.result?.tools ?? [];
}

/** Llama una herramienta del MCP y devuelve su resultado crudo. */
export async function llamarHerramienta(
  s: SesionMCP,
  nombre: string,
  argumentos: Record<string, unknown>,
): Promise<any> {
  const res = await rpc(
    s.token,
    "tools/call",
    { name: nombre, arguments: argumentos },
    s.sesion,
    3,
  );
  if (res.cuerpo?.error) {
    throw new Error(`MCP ${nombre}: ${JSON.stringify(res.cuerpo.error).slice(0, 300)}`);
  }
  return res.cuerpo?.result;
}

/**
 * El contenido útil de un tools/call: primero structuredContent; si no,
 * el primer bloque de texto que parsee como JSON.
 */
export function resultadoEstructurado(resultado: any): any {
  if (resultado?.structuredContent) return resultado.structuredContent;
  for (const bloque of resultado?.content ?? []) {
    if (bloque?.type === "text" && typeof bloque.text === "string") {
      try {
        return JSON.parse(bloque.text);
      } catch {
        // El siguiente bloque puede ser el JSON.
      }
    }
  }
  return null;
}

/**
 * Antes de dar el folio, el MCP a veces CONTESTA CON UNA PREGUNTA en vez de
 * generar: `unlim_choice` («¿usas tus generaciones ilimitadas?») o un
 * `notice.type = preset_recommendation` («el prompt se parece al preset X,
 * ¿lo usas o generas literal?»). El ERP no tiene a quién preguntarle: las
 * ilimitadas se usan (son gratis) y el preset se DECLINA para que genere
 * literal lo que se pidió (`declined_preset_id`, 24-sep-2026: david veía
 * «El Studio no devolvió folio: {"notice":…}» y no había cómo contestar).
 * Devuelve los parámetros con los que hay que volver a llamar, o null si
 * la respuesta no es una pregunta.
 */
export function paramsTrasAviso(
  sc: any,
  params: Record<string, unknown>,
): Record<string, unknown> | null {
  if (sc?.unlim_choice && !params.use_unlim) {
    return { ...params, use_unlim: true };
  }
  const aviso = sc?.notice;
  if (aviso?.type === "preset_recommendation") {
    const presetId = aviso?.data?.preset?.id ?? aviso?.preset?.id ?? aviso?.preset_id;
    if (presetId && params.declined_preset_id !== presetId) {
      return { ...params, declined_preset_id: presetId };
    }
  }
  return null;
}

/** Cuántas veces se le vuelve a llamar a la herramienta por sus avisos. */
export const REINTENTOS_POR_AVISO = 3;

/**
 * Llama una herramienta de generación (`generate_video`, `generate_image`,
 * `generate_audio`, `voice_change`…) y le contesta sola sus preguntas
 * (`paramsTrasAviso`) hasta `REINTENTOS_POR_AVISO` veces. Devuelve el
 * resultado estructurado de la última llamada.
 */
export async function generarContestandoAvisos(
  s: SesionMCP,
  herramienta: string,
  params: Record<string, unknown>,
): Promise<any> {
  let actuales = params;
  let sc = resultadoEstructurado(await llamarHerramienta(s, herramienta, { params: actuales }));
  for (let i = 0; i < REINTENTOS_POR_AVISO; i++) {
    const siguientes = paramsTrasAviso(sc, actuales);
    if (!siguientes) break;
    actuales = siguientes;
    sc = resultadoEstructurado(await llamarHerramienta(s, herramienta, { params: actuales }));
  }
  return sc;
}
