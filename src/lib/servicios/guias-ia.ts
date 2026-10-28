/**
 * Ideas para el video hechas por Claude mirando las fotos (dueño,
 * 28-oct-2026). Corre POR ATRÁS (cron `/api/cron/guias-video` y el botón del
 * back) y deja todo en `app_cache` clave `guias-video`; la tienda solo lee.
 *
 *  · La llave es SOLO de esto: `ANTHROPIC_API_KEY_GUIAS` (dueño: «que se
 *    limite el uso solo a esto»). Se le pasa al cliente a mano: ningún otro
 *    código del ERP la toma, y en Anthropic vive en un workspace propio con
 *    su límite de gasto. Sin la llave no se llama a nada y la tienda sigue
 *    con la guía por reglas.
 *  · Tope propio de `TOPE_MENSUAL_USD` al mes, contado con los tokens que
 *    contesta la API; al llegar se para hasta el mes siguiente.
 *  · Una guía se hace UNA vez por producto: solo se rehace si cambian sus
 *    fotos, título, categoría o textos (la huella), o con «Rehacer». Lo
 *    corregido a mano en el back no se pisa.
 *  · Lo que mira: hasta 4 fotos de Amazon, el título, la categoría, colores,
 *    tallas, precio y los puntos y la descripción del producto en TikTok
 *    (`tienda_productos`) cuando existe.
 */
import Anthropic from "@anthropic-ai/sdk";
import { conCandado, type DB } from "../datos/repos";
import type { ProductoCatalogo } from "../tienda/catalogo-amazon";
import {
  CLAVE_GUIAS,
  COSTO_MAXIMO_GUIA_USD,
  ESQUEMA_GUIA,
  GUIAS_POR_CORRIDA,
  INSTRUCCIONES,
  MODELO_IA,
  costoDeUso,
  disponibleDelMes,
  fotosParaAnalizar,
  guiasVacias,
  huellaDeProducto,
  limpiarGuia,
  mensajeDeProducto,
  mesDe,
  modelosPorGenerar,
  type GuiaGuardada,
  type GuiaIA,
  type GuiasGuardadas,
  type TextosProducto,
} from "../tienda/guia-ia";
import { CLAVE_CATALOGO_AMAZON } from "./catalogo-amazon";
import { guardarCacheApp, leerCacheAppGuardado } from "./cache-app";

const VARIABLE_LLAVE = "ANTHROPIC_API_KEY_GUIAS";
/** Editar y borrar esperan a que termine la tanda en curso: si no, la tanda pisaría el cambio. */
const OCUPADO = "Se están haciendo guías en este momento; intenta en unos minutos.";

export function hayLlaveGuias(): boolean {
  return !!process.env[VARIABLE_LLAVE]?.trim();
}

export async function leerGuias(db: DB, accountId: string): Promise<GuiasGuardadas> {
  const r = await leerCacheAppGuardado<GuiasGuardadas>(db, accountId, CLAVE_GUIAS);
  if (r.estado !== "encontrado") return guiasVacias();
  const d = r.valor.datos ?? guiasVacias();
  return {
    guias: d.guias ?? {},
    gasto: d.gasto ?? {},
    ultimaCorrida: d.ultimaCorrida ?? null,
  };
}

async function guardar(db: DB, accountId: string, datos: GuiasGuardadas): Promise<void> {
  await guardarCacheApp(db, accountId, CLAVE_GUIAS, datos, 0);
}

async function leerCatalogo(db: DB, accountId: string): Promise<ProductoCatalogo[]> {
  const r = await leerCacheAppGuardado<{ productos?: ProductoCatalogo[] }>(db, accountId, CLAVE_CATALOGO_AMAZON);
  return r.estado === "encontrado" && Array.isArray(r.valor.datos?.productos) ? r.valor.datos.productos : [];
}

/** Puntos y descripción del producto en TikTok, por modelo (el de más puntos). */
async function textosPorModelo(db: DB, accountId: string, modelos: string[]): Promise<Map<string, TextosProducto>> {
  const salida = new Map<string, TextosProducto>();
  if (!modelos.length) return salida;
  const { data, error } = await db
    .from("tienda_productos")
    .select("modelo, bullets, descripcion")
    .eq("account_id", accountId)
    .in("modelo", modelos)
    .order("product_id", { ascending: true });
  if (error) throw new Error(`tienda_productos: ${error.message}`);
  for (const r of (data ?? []) as {
    modelo: string | null;
    bullets: unknown;
    descripcion: string | null;
  }[]) {
    if (!r.modelo) continue;
    const bullets = Array.isArray(r.bullets) ? r.bullets.filter((b): b is string => typeof b === "string" && !!b.trim()) : [];
    const actual = salida.get(r.modelo);
    if (!actual || bullets.length > actual.bullets.length) {
      salida.set(r.modelo, {
        bullets: bullets.slice(0, 8),
        descripcion: r.descripcion?.trim() || null,
      });
    }
  }
  return salida;
}

const SIN_TEXTOS: TextosProducto = { bullets: [], descripcion: null };

/** Una guía: fotos + texto → JSON. Devuelve la guía y lo que costó. */
async function pedirGuia(cliente: Anthropic, p: ProductoCatalogo, textos: TextosProducto): Promise<{ guia: GuiaIA; costoUsd: number }> {
  const fotos = fotosParaAnalizar(p);
  const respuesta = await cliente.beta.messages.create({
    model: MODELO_IA,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: {
        type: "json_schema",
        schema: ESQUEMA_GUIA as unknown as Record<string, unknown>,
      },
    },
    system: INSTRUCCIONES,
    messages: [
      {
        role: "user",
        content: [
          ...fotos.map((url) => ({
            type: "image" as const,
            source: { type: "url" as const, url },
          })),
          { type: "text" as const, text: mensajeDeProducto(p, textos) },
        ],
      },
    ],
  });
  const costoUsd = costoDeUso(respuesta.usage);
  if (respuesta.stop_reason === "refusal")
    throw Object.assign(new Error("Claude no quiso hacer esta guía."), {
      costoUsd,
    });
  if (respuesta.stop_reason === "max_tokens") throw Object.assign(new Error("La respuesta salió cortada."), { costoUsd });
  const texto = respuesta.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  let json: unknown = null;
  try {
    json = JSON.parse(texto);
  } catch {
    throw Object.assign(new Error("La respuesta no fue JSON."), { costoUsd });
  }
  const guia = limpiarGuia(json);
  if (!guia)
    throw Object.assign(new Error("La respuesta vino incompleta."), {
      costoUsd,
    });
  return { guia, costoUsd };
}

export interface ResultadoGuias {
  hechas: string[];
  errores: { modelo: string; error: string }[];
  pendientes: number;
  gastoMes: number;
  motivo: string | null;
}

/**
 * Hace las guías que faltan (o las de `soloModelos`, aunque ya existan, con
 * `forzar`). Para al acabarse el tiempo, el tope del mes o la lista.
 */
export async function generarGuias(
  db: DB,
  accountId: string,
  opciones: {
    soloModelos?: string[];
    forzar?: boolean;
    limite?: number;
    msMax?: number;
  } = {},
): Promise<ResultadoGuias> {
  return conCandado(db, accountId, "guias-video", 900, async () => {
    const inicio = Date.now();
    const msMax = opciones.msMax ?? 240_000;
    const datos = await leerGuias(db, accountId);
    const ahora = new Date();
    const mes = mesDe(ahora);
    const salida: ResultadoGuias = {
      hechas: [],
      errores: [],
      pendientes: 0,
      gastoMes: datos.gasto[mes] ?? 0,
      motivo: null,
    };

    const llave = process.env[VARIABLE_LLAVE]?.trim();
    const productos = (await leerCatalogo(db, accountId)).filter((p) => !p.oculto);
    const textos = await textosPorModelo(
      db,
      accountId,
      productos.map((p) => p.modelo),
    );
    const huellas = new Map(productos.map((p) => [p.modelo, huellaDeProducto(p, textos.get(p.modelo) ?? SIN_TEXTOS)]));
    const todas = modelosPorGenerar(productos, datos.guias, huellas, Number.MAX_SAFE_INTEGER);

    let cola: string[];
    if (opciones.soloModelos?.length) {
      const pedidos = new Set(opciones.soloModelos);
      cola = productos.map((p) => p.modelo).filter((m) => pedidos.has(m) && (opciones.forzar || todas.includes(m)));
    } else {
      cola = todas.slice(0, opciones.limite ?? GUIAS_POR_CORRIDA);
    }
    salida.pendientes = todas.length;

    const terminar = async (motivo: string | null) => {
      salida.motivo = motivo;
      salida.gastoMes = datos.gasto[mes] ?? 0;
      salida.pendientes = Math.max(0, todas.length - salida.hechas.filter((m) => todas.includes(m)).length);
      datos.ultimaCorrida = {
        en: new Date().toISOString(),
        hechas: salida.hechas,
        errores: salida.errores,
        motivo,
      };
      await guardar(db, accountId, datos);
      return salida;
    };

    if (!llave) return terminar(`Falta la llave ${VARIABLE_LLAVE} en Vercel.`);
    if (!cola.length) return terminar(null);

    const cliente = new Anthropic({ apiKey: llave, maxRetries: 2 });
    const porModelo = new Map(productos.map((p) => [p.modelo, p]));
    for (const modelo of cola) {
      if (Date.now() - inicio > msMax) return terminar("Se acabó el tiempo de esta corrida; la siguiente sigue.");
      if (disponibleDelMes(datos.gasto, ahora) < COSTO_MAXIMO_GUIA_USD) {
        return terminar(`Se llegó al tope del mes (${mes}); se sigue el mes que entra.`);
      }
      const p = porModelo.get(modelo)!;
      const t = textos.get(modelo) ?? SIN_TEXTOS;
      try {
        const { guia, costoUsd } = await pedirGuia(cliente, p, t);
        datos.gasto[mes] = (datos.gasto[mes] ?? 0) + costoUsd;
        const guardada: GuiaGuardada = {
          ...guia,
          huella: huellas.get(modelo)!,
          generadoEn: new Date().toISOString(),
          editada: false,
          costoUsd,
        };
        datos.guias[modelo] = guardada;
        salida.hechas.push(modelo);
        // Se guarda cada una: si la función muere, lo pagado no se pierde.
        await guardar(db, accountId, datos);
      } catch (err) {
        const costo = Number((err as { costoUsd?: number }).costoUsd ?? 0);
        if (costo > 0) datos.gasto[mes] = (datos.gasto[mes] ?? 0) + costo;
        salida.errores.push({ modelo, error: mensajeDeError(err) });
        // Una llave mala o sin saldo no se arregla con el siguiente modelo.
        if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
          return terminar("Anthropic rechazó la llave: revisa que esté bien copiada y activa.");
        }
        if (err instanceof Anthropic.RateLimitError) return terminar("Anthropic pidió esperar; la siguiente corrida sigue.");
        if (err instanceof Anthropic.BadRequestError && /credit|billing|spend|limit/i.test(err.message)) {
          return terminar("Anthropic dice que se acabó el saldo o el límite de gasto del workspace.");
        }
      }
    }
    return terminar(null);
  });
}

function mensajeDeError(err: unknown): string {
  if (err instanceof Anthropic.APIError) return `Anthropic ${err.status ?? ""}: ${err.message}`.slice(0, 300);
  return ((err as Error)?.message ?? String(err)).slice(0, 300);
}

/** La guía corregida a mano en el back; ya no la pisa el fondo. */
export async function guardarGuiaEditada(db: DB, accountId: string, modelo: string, guia: GuiaIA): Promise<void> {
  await conCandado(
    db,
    accountId,
    "guias-video",
    60,
    async () => {
      const datos = await leerGuias(db, accountId);
      const anterior = datos.guias[modelo];
      datos.guias[modelo] = {
        ...guia,
        huella: anterior?.huella ?? "",
        generadoEn: new Date().toISOString(),
        editada: true,
        costoUsd: anterior?.costoUsd ?? 0,
      };
      await guardar(db, accountId, datos);
    },
    OCUPADO,
  );
}

/** Quita la guía de un modelo: la tienda vuelve a la de reglas y el fondo la rehace. */
export async function borrarGuia(db: DB, accountId: string, modelo: string): Promise<void> {
  await conCandado(
    db,
    accountId,
    "guias-video",
    60,
    async () => {
      const datos = await leerGuias(db, accountId);
      delete datos.guias[modelo];
      await guardar(db, accountId, datos);
    },
    OCUPADO,
  );
}
