/**
 * Costos de producto: la hoja "Numeros" del dueño, renglón por MODELO.
 *
 * Lo que se captura por modelo es lo que solo el negocio sabe: el costo de
 * fábrica en dólares, el tipo de cambio con el que se pagó, el CBM que ocupa
 * un par, el costo de envío por par en cada marketplace y los precios. De ahí
 * el sistema saca lo demás igual que la hoja:
 *
 *   aduana        = pesos por m³ × CBM por par
 *   costo total   = USD × TDC + aduana                     (aterrizado, MXN)
 *   ganancia MELI = precio − comisión − envío − retención − costo total
 *                   la retención es el 10.5 % del precio SIN IVA
 *   recibir Amazon = costo total + ganancia MELI relámpago (lo que se quiere
 *                   embolsar también en Amazon)
 *   PVP Amazon    = (recibir + envío Amazon) ÷ (1 − comisión − retención)
 *   deal Amazon   = PVP × 1.12   (para poder ofrecer el 12 % de descuento)
 *   TikTok        = (recibir + envío TikTok) ÷ (1 − comisión − afiliado − retención)
 *   oferta TikTok = TikTok × 1.06
 *
 * El costo total calculado se escribe también en productos_config.costo_mxn:
 * es el mismo número que la sección de Ventas ya usa para la ganancia real,
 * y tenerlo en dos lados sería tenerlo mal en uno. Las constantes viven en
 * `costos_parametros` (JSON por cuenta) con estas omisiones, que son las de
 * la hoja original.
 *
 * Las funciones de cálculo son puras y están probadas contra los números de
 * la hoja (MY2307, GT104, GT135).
 */
import { traerTodo, type DB } from "../datos/repos";
import {
  calcularCosto,
  leerParametrosCostos,
  type CapturaCosto,
  type FilaCosto,
  type FilaImportada,
  type ParametrosCostos,
} from "../engine/costos";

export * from "../engine/costos";

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------
export interface CatalogoCostos {
  filas: FilaCosto[];
  parametros: ParametrosCostos;
  categorias: string[];
  /** true si falta la migración 0053. */
  faltaMigracion: boolean;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function filaDesdeBase(r: any): CapturaCosto & { actualizadoEn: string | null } {
  return {
    modelo: String(r.modelo ?? "").toUpperCase(),
    costoUsd: num(r.costo_usd),
    tdc: num(r.tdc),
    cbmPar: num(r.cbm_par),
    envioMeli: num(r.envio_meli),
    precioRelampago: num(r.precio_relampago),
    precioNormal: num(r.precio_normal),
    envioAmazon: num(r.envio_amazon),
    precioAmazon: num(r.precio_amazon),
    afiliadoTiktok: num(r.afiliado_tiktok),
    precioTiktok: num(r.precio_tiktok),
    notas: typeof r.notas === "string" ? r.notas : "",
    actualizadoEn: r.actualizado_en ?? null,
  };
}

export async function leerParametrosDeCuenta(db: DB, accountId: string): Promise<ParametrosCostos> {
  const { data } = await db
    .from("costos_parametros")
    .select("datos")
    .eq("account_id", accountId)
    .maybeSingle();
  return leerParametrosCostos(data?.datos);
}

/**
 * Todos los modelos que el negocio conoce —los del catálogo de MELI, los que
 * tienen costo capturado y los de la lista de modelos nuevos— con su captura
 * de costos, en un solo listado.
 */
export async function cargarCostos(db: DB, accountId: string): Promise<CatalogoCostos> {
  const [skus, costos, config, nuevos, parametros] = await Promise.all([
    traerTodo<any>(db, "skus", "sku, modelo, titulo", (q) =>
      q.eq("account_id", accountId).eq("activo", true),
    ),
    db.from("costos_producto").select("*").eq("account_id", accountId),
    db
      .from("productos_config")
      .select("modelo, color, categoria")
      .eq("account_id", accountId)
      .eq("color", ""),
    db.from("modelos_nuevos").select("modelo").eq("account_id", accountId),
    leerParametrosDeCuenta(db, accountId),
  ]);

  const faltaMigracion = Boolean(costos.error);

  const titulos = new Map<string, string | null>();
  for (const s of skus) {
    const modelo = String(s.modelo ?? s.sku?.split("-")[0] ?? "").toUpperCase();
    if (!modelo) continue;
    if (!titulos.has(modelo) || (!titulos.get(modelo) && s.titulo)) {
      titulos.set(modelo, s.titulo ?? titulos.get(modelo) ?? null);
    }
  }
  const categoriaDe = new Map<string, string | null>(
    ((config.data ?? []) as any[]).map((c) => [String(c.modelo).toUpperCase(), c.categoria ?? null]),
  );
  const esNuevo = new Set(((nuevos.data ?? []) as any[]).map((n) => String(n.modelo).toUpperCase()));
  const capturas = new Map(
    ((costos.data ?? []) as any[]).map((r) => {
      const f = filaDesdeBase(r);
      return [f.modelo, f];
    }),
  );

  const modelos = new Set<string>([...titulos.keys(), ...capturas.keys(), ...esNuevo]);
  const filas: FilaCosto[] = [...modelos]
    .map((modelo) => {
      const c = capturas.get(modelo);
      return {
        modelo,
        costoUsd: c?.costoUsd ?? null,
        tdc: c?.tdc ?? null,
        cbmPar: c?.cbmPar ?? null,
        envioMeli: c?.envioMeli ?? null,
        precioRelampago: c?.precioRelampago ?? null,
        precioNormal: c?.precioNormal ?? null,
        envioAmazon: c?.envioAmazon ?? null,
        precioAmazon: c?.precioAmazon ?? null,
        afiliadoTiktok: c?.afiliadoTiktok ?? null,
        precioTiktok: c?.precioTiktok ?? null,
        notas: c?.notas ?? "",
        categoria: categoriaDe.get(modelo) ?? null,
        enCatalogo: titulos.has(modelo),
        esNuevo: esNuevo.has(modelo),
        titulo: titulos.get(modelo) ?? null,
        actualizadoEn: c?.actualizadoEn ?? null,
      };
    })
    .sort((a, b) => a.modelo.localeCompare(b.modelo, "es", { numeric: true }));

  const categorias = [...new Set(filas.map((f) => f.categoria).filter(Boolean))] as string[];
  categorias.sort((a, b) => a.localeCompare(b, "es"));

  return { filas, parametros, categorias, faltaMigracion };
}

/** Mapa modelo → captura, para que otras pantallas (modelos nuevos) lean los precios. */
export async function costosPorModelo(
  db: DB,
  accountId: string,
): Promise<{ capturas: Map<string, CapturaCosto>; parametros: ParametrosCostos }> {
  const [{ data }, parametros] = await Promise.all([
    db.from("costos_producto").select("*").eq("account_id", accountId),
    leerParametrosDeCuenta(db, accountId),
  ]);
  const capturas = new Map<string, CapturaCosto>();
  for (const r of (data ?? []) as any[]) {
    const f = filaDesdeBase(r);
    capturas.set(f.modelo, f);
  }
  return { capturas, parametros };
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------
const CAMPOS_NUMERICOS: Record<string, string> = {
  costoUsd: "costo_usd",
  tdc: "tdc",
  cbmPar: "cbm_par",
  envioMeli: "envio_meli",
  precioRelampago: "precio_relampago",
  precioNormal: "precio_normal",
  envioAmazon: "envio_amazon",
  precioAmazon: "precio_amazon",
  afiliadoTiktok: "afiliado_tiktok",
  precioTiktok: "precio_tiktok",
};

const TOPE_NOTAS = 2000;

export interface Guardado {
  ok: boolean;
  error?: string;
  status?: number;
}

/**
 * Guarda la captura de un modelo. Solo escribe las columnas que vengan en el
 * cuerpo (mandar solo el precio no borra el CBM). Después recalcula el costo
 * total y lo copia a productos_config.costo_mxn junto con la categoría, para
 * que Ventas y Costos digan lo mismo.
 */
export async function guardarCosto(db: DB, accountId: string, body: any): Promise<Guardado> {
  const modelo = typeof body?.modelo === "string" ? body.modelo.trim().toUpperCase() : "";
  if (!modelo || modelo.length > 40) return { ok: false, error: "Falta el modelo.", status: 400 };

  const fila: Record<string, unknown> = {
    account_id: accountId,
    modelo,
    actualizado_en: new Date().toISOString(),
  };
  for (const [campo, columna] of Object.entries(CAMPOS_NUMERICOS)) {
    if (!(campo in (body ?? {}))) continue;
    const v = body[campo];
    if (v === null || v === "" || v === undefined) {
      fila[columna] = null;
      continue;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: `El valor de ${campo} no es un número válido.`, status: 400 };
    }
    fila[columna] = n;
  }
  if ("notas" in (body ?? {})) {
    fila.notas = typeof body.notas === "string" ? body.notas.slice(0, TOPE_NOTAS) : "";
  }

  const { error } = await db
    .from("costos_producto")
    .upsert(fila, { onConflict: "account_id,modelo" });
  if (error) {
    const falta = error.message.includes("costos_producto");
    return {
      ok: false,
      error: falta ? "Falta aplicar la migración 0053 en Supabase (tabla costos_producto)." : error.message,
      status: 500,
    };
  }

  // Categoría y costo aterrizado → productos_config (una sola verdad).
  const config: Record<string, unknown> = {
    account_id: accountId,
    modelo,
    color: "",
    actualizado_en: new Date().toISOString(),
  };
  if ("categoria" in (body ?? {})) {
    const c = typeof body.categoria === "string" ? body.categoria.trim().toUpperCase() : "";
    config.categoria = c || null;
  }
  const { data: guardada } = await db
    .from("costos_producto")
    .select("*")
    .eq("account_id", accountId)
    .eq("modelo", modelo)
    .maybeSingle();
  if (guardada) {
    const parametros = await leerParametrosDeCuenta(db, accountId);
    const calc = calcularCosto(filaDesdeBase(guardada), parametros);
    if (calc.costoTotal != null) config.costo_mxn = Math.round(calc.costoTotal * 100) / 100;
  }
  if ("categoria" in config || "costo_mxn" in config) {
    const { error: errConfig } = await db
      .from("productos_config")
      .upsert(config, { onConflict: "account_id,modelo,color" });
    if (errConfig) return { ok: false, error: errConfig.message, status: 500 };
  }
  return { ok: true };
}

/** Quita la captura de un modelo (no toca el catálogo ni productos_config). */
export async function borrarCosto(db: DB, accountId: string, modelo: string): Promise<Guardado> {
  const m = modelo.trim().toUpperCase();
  if (!m) return { ok: false, error: "Falta el modelo.", status: 400 };
  const { error } = await db
    .from("costos_producto")
    .delete()
    .eq("account_id", accountId)
    .eq("modelo", m);
  return error ? { ok: false, error: error.message, status: 500 } : { ok: true };
}

export async function guardarParametrosCostos(
  db: DB,
  accountId: string,
  datos: unknown,
): Promise<Guardado> {
  const limpios = leerParametrosCostos(datos);
  const { error } = await db
    .from("costos_parametros")
    .upsert(
      { account_id: accountId, datos: limpios, actualizado_en: new Date().toISOString() },
      { onConflict: "account_id" },
    );
  if (error) return { ok: false, error: error.message, status: 500 };
  return { ok: true };
}

/**
 * Carga masiva desde la hoja: los modelos que ya existían se actualizan (solo
 * las columnas que la hoja trae), los nuevos se agregan; la categoría va a
 * productos_config y el costo total recalculado también.
 */
export async function importarCostos(
  db: DB,
  accountId: string,
  filas: FilaImportada[],
): Promise<Guardado & { cargados?: number }> {
  if (!filas.length) return { ok: false, error: "No encontré ningún renglón con modelo.", status: 400 };
  const ahora = new Date().toISOString();

  const { error } = await db.from("costos_producto").upsert(
    filas.map((f) => ({
      account_id: accountId,
      modelo: f.modelo,
      costo_usd: f.costoUsd,
      tdc: f.tdc,
      cbm_par: f.cbmPar,
      envio_meli: f.envioMeli,
      precio_relampago: f.precioRelampago,
      precio_normal: f.precioNormal,
      envio_amazon: f.envioAmazon,
      actualizado_en: ahora,
    })),
    { onConflict: "account_id,modelo" },
  );
  if (error) {
    const falta = error.message.includes("costos_producto");
    return {
      ok: false,
      error: falta ? "Falta aplicar la migración 0053 en Supabase (tabla costos_producto)." : error.message,
      status: 500,
    };
  }

  const parametros = await leerParametrosDeCuenta(db, accountId);
  const config = filas
    .map((f) => {
      const calc = calcularCosto(
        { ...f, precioAmazon: null, afiliadoTiktok: null, precioTiktok: null, notas: "" },
        parametros,
      );
      if (!f.categoria && calc.costoTotal == null) return null;
      const fila: Record<string, unknown> = {
        account_id: accountId,
        modelo: f.modelo,
        color: "",
        actualizado_en: ahora,
      };
      // Sin categoría en la hoja no se pisa la que ya había; sin costo
      // calculable tampoco se borra el costo capturado a mano.
      if (f.categoria) fila.categoria = f.categoria;
      if (calc.costoTotal != null) fila.costo_mxn = Math.round(calc.costoTotal * 100) / 100;
      return fila;
    })
    .filter((x): x is Record<string, unknown> => x !== null);

  // Los upserts van por grupos de columnas iguales: PostgREST exige que
  // todas las filas de un mismo upsert traigan las mismas llaves.
  const grupos = new Map<string, Record<string, unknown>[]>();
  for (const c of config) {
    const k = Object.keys(c).sort().join(",");
    grupos.set(k, [...(grupos.get(k) ?? []), c]);
  }
  for (const grupo of grupos.values()) {
    const { error: e } = await db
      .from("productos_config")
      .upsert(grupo, { onConflict: "account_id,modelo,color" });
    if (e) return { ok: false, error: e.message, status: 500 };
  }

  return { ok: true, cargados: filas.length };
}
