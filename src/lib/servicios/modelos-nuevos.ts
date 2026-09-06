/**
 * Modelos nuevos: el seguimiento de cada listado nuevo hasta que queda
 * completo.
 *
 * Por MODELO (categoría, precio y contenido son del modelo, no de la talla)
 * se lleva lo que falta para poder venderlo bien:
 *
 *   · categoría y precio de venta (viven en productos_config / costos_producto:
 *     aquí solo se ven y se editan, la verdad es la de Costos);
 *   · cuándo llega: la ETA del contenedor que lo trae (pedido → contenedor)
 *     o una fecha capturada a mano;
 *   · las fotos de la fábrica: ya llegaron / ya se mandaron a cargar;
 *   · lo que el API sí puede ver —fotos de portada y secundarias en MELI y en
 *     Amazon, video viejo de MELI, A+ publicado en Amazon— guardado como la
 *     última revisión (`revision`, con su fecha), y lo que no puede ver —el
 *     clip de MELI (no hay API para vendedores locales), el video de Amazon,
 *     el A+ que ya se mandó a cargar y aún no sale— palomeado a mano.
 *
 * De todo eso sale la lista de FALTANTES del renglón. Un modelo "listo" se
 * conserva pero deja de gritar. Las funciones de resumen y faltantes son
 * puras y están probadas.
 */
import { traerTodo, type DB } from "../datos/repos";
import { calcularCosto, costosPorModelo } from "./costos-producto";
import { desglosarAmazon } from "./fba";
import {
  calcularFaltantes,
  estimarLlegadas,
  resumirRevision,
  type ContenedorCrudo,
  type LineaCruda,
  type LlegadaModelo,
  type ModeloNuevo,
  type PedidoCrudo,
  type RevisionModelo,
} from "../engine/modelos-nuevos";

export * from "../engine/modelos-nuevos";

export interface SugerenciaModelo {
  modelo: string;
  llegada: LlegadaModelo;
}

export interface PantallaModelosNuevos {
  modelos: ModeloNuevo[];
  /** Modelos que vienen en un pedido a China y todavía no se siguen aquí. */
  sugerencias: SugerenciaModelo[];
  categorias: string[];
  hayAmazon: boolean;
  /** true si falta la migración 0053. */
  faltaMigracion: boolean;
}

/** Los modelos que tienen publicaciones en Amazon, según el catálogo guardado. */
async function modelosEnAmazon(db: DB, amazonAccountId: string): Promise<Set<string>> {
  const filas = await traerTodo<{ seller_sku: string }>(
    db,
    "amazon_listings",
    "seller_sku",
    (q) => q.eq("account_id", amazonAccountId),
  ).catch(() => [] as { seller_sku: string }[]);
  const salida = new Set<string>();
  for (const f of filas) {
    const m = desglosarAmazon(String(f.seller_sku ?? "")).modelo;
    if (m) salida.add(m.trim().toUpperCase());
  }
  return salida;
}

/** Lo que hay en la base de pedidos y contenedores, en la forma que entiende `estimarLlegadas`. */
export async function leerLlegadas(db: DB, accountId: string): Promise<Map<string, LlegadaModelo>> {
  const [{ data: pedidos }, { data: contenedores }] = await Promise.all([
    db.from("pedidos").select("id, pedido, estado").eq("account_id", accountId),
    db
      .from("contenedores")
      .select("id, numero, estado, fecha_llegada_est, fecha_llegada_real, contenedor_lineas(pedido_linea_id)")
      .eq("account_id", accountId),
  ]);
  const ids = (pedidos ?? []).map((p: any) => p.id);
  const { data: lineas } = ids.length
    ? await db.from("pedido_lineas").select("id, pedido_id, modelo").in("pedido_id", ids)
    : { data: [] as any[] };

  return estimarLlegadas(
    (pedidos ?? []) as PedidoCrudo[],
    (lineas ?? []) as LineaCruda[],
    ((contenedores ?? []) as any[]).map((c) => ({
      id: c.id,
      numero: c.numero,
      estado: c.estado ?? null,
      fecha_llegada_est: c.fecha_llegada_est ?? null,
      fecha_llegada_real: c.fecha_llegada_real ?? null,
      lineas: ((c.contenedor_lineas ?? []) as { pedido_linea_id: string }[]).map(
        (l) => l.pedido_linea_id,
      ),
    })),
  );
}

export function filaDesdeBase(r: any): Omit<
  ModeloNuevo,
  | "titulo"
  | "categoria"
  | "precioNormal"
  | "precioRelampago"
  | "costoTotal"
  | "llegadaAuto"
  | "publicadoMeli"
  | "publicadoAmazon"
  | "resumen"
  | "faltantes"
> {
  const revision = (r.revision ?? null) as RevisionModelo | null;
  return {
    modelo: String(r.modelo ?? "").toUpperCase(),
    llegadaEstimada: r.llegada_estimada ?? null,
    imagenesRecibidas: r.imagenes_recibidas === true,
    imagenesEnviadas: r.imagenes_enviadas === true,
    meliClip: r.meli_clip === true,
    amazonVideo: r.amazon_video === true,
    aplusCargado: r.aplus_cargado === true,
    notas: typeof r.notas === "string" ? r.notas : "",
    listo: r.listo === true,
    revision,
    revisadoEn: r.revisado_en ?? revision?.en ?? null,
  };
}

export async function cargarModelosNuevos(
  db: DB,
  accountId: string,
  amazonAccountId: string | null,
): Promise<PantallaModelosNuevos> {
  const [seguimiento, skus, config, costos, llegadas, enAmazon] = await Promise.all([
    db.from("modelos_nuevos").select("*").eq("account_id", accountId),
    traerTodo<any>(db, "skus", "sku, modelo, item_id, titulo", (q) => q.eq("account_id", accountId)),
    db
      .from("productos_config")
      .select("modelo, categoria")
      .eq("account_id", accountId)
      .eq("color", ""),
    costosPorModelo(db, accountId).catch(() => ({ capturas: new Map(), parametros: null })),
    leerLlegadas(db, accountId),
    amazonAccountId ? modelosEnAmazon(db, amazonAccountId) : Promise.resolve(new Set<string>()),
  ]);

  const faltaMigracion = Boolean(seguimiento.error);
  const hayAmazon = Boolean(amazonAccountId);

  const titulos = new Map<string, string | null>();
  const conPublicacion = new Set<string>();
  for (const s of skus) {
    const modelo = String(s.modelo ?? s.sku?.split("-")[0] ?? "").toUpperCase();
    if (!modelo) continue;
    if (s.item_id) conPublicacion.add(modelo);
    if (!titulos.get(modelo) && s.titulo) titulos.set(modelo, s.titulo);
    else if (!titulos.has(modelo)) titulos.set(modelo, null);
  }
  const categoriaDe = new Map<string, string | null>(
    ((config.data ?? []) as any[]).map((c) => [String(c.modelo).toUpperCase(), c.categoria ?? null]),
  );

  const modelos: ModeloNuevo[] = ((seguimiento.data ?? []) as any[])
    .map((r) => {
      const base = filaDesdeBase(r);
      const captura = costos.capturas.get(base.modelo);
      const calc = captura && costos.parametros ? calcularCosto(captura, costos.parametros) : null;
      const sinFaltantes: Omit<ModeloNuevo, "faltantes"> = {
        ...base,
        titulo: titulos.get(base.modelo) ?? null,
        categoria: categoriaDe.get(base.modelo) ?? null,
        precioNormal: captura?.precioNormal ?? null,
        precioRelampago: captura?.precioRelampago ?? null,
        costoTotal: calc?.costoTotal ?? null,
        llegadaAuto: llegadas.get(base.modelo) ?? null,
        publicadoMeli: conPublicacion.has(base.modelo),
        publicadoAmazon: enAmazon.has(base.modelo),
        resumen: resumirRevision(base.revision),
      };
      return { ...sinFaltantes, faltantes: sinFaltantes.listo ? [] : calcularFaltantes(sinFaltantes, { hayAmazon }) };
    })
    // Pendientes primero (los que más deben, arriba); listos al final.
    .sort(
      (a, b) =>
        Number(a.listo) - Number(b.listo) ||
        b.faltantes.length - a.faltantes.length ||
        a.modelo.localeCompare(b.modelo, "es", { numeric: true }),
    );

  const seguidos = new Set(modelos.map((m) => m.modelo));
  const sugerencias: SugerenciaModelo[] = [...llegadas.entries()]
    .filter(([modelo, l]) => !seguidos.has(modelo) && l.estado !== "llego")
    .map(([modelo, llegada]) => ({ modelo, llegada }))
    .sort((a, b) => a.modelo.localeCompare(b.modelo, "es", { numeric: true }));

  const categorias = [...new Set([...categoriaDe.values()].filter(Boolean))] as string[];
  categorias.sort((a, b) => a.localeCompare(b, "es"));

  return { modelos, sugerencias, categorias, hayAmazon, faltaMigracion };
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------
export interface Guardado {
  ok: boolean;
  error?: string;
  status?: number;
}

const TOPE_NOTAS = 2000;
const TOPE_MODELOS = 200;
const RE_MODELO = /^[A-Z0-9][A-Z0-9 ._-]{0,39}$/;

function modelosDelCuerpo(body: any): string[] {
  const crudos: unknown[] = Array.isArray(body?.modelos)
    ? body.modelos
    : typeof body?.modelo === "string"
      ? [body.modelo]
      : [];
  return [
    ...new Set(
      crudos
        .filter((m): m is string => typeof m === "string")
        .map((m) => m.trim().toUpperCase())
        .filter((m) => RE_MODELO.test(m)),
    ),
  ].slice(0, TOPE_MODELOS);
}

function traducir(error: { message: string }): Guardado {
  const falta = error.message.includes("modelos_nuevos") && error.message.includes("does not exist");
  return {
    ok: false,
    error: falta ? "Falta aplicar la migración 0053 en Supabase (tabla modelos_nuevos)." : error.message,
    status: 500,
  };
}

/**
 * Agrega, anota o quita modelos. Solo escribe las columnas que vengan en el
 * cuerpo. `accion: "quitar"` borra el seguimiento (no toca costos ni
 * catálogo); lo demás es upsert, así que "agregar" es mandar solo el modelo.
 */
export async function guardarModeloNuevo(db: DB, accountId: string, body: any): Promise<Guardado> {
  const modelos = modelosDelCuerpo(body);
  if (!modelos.length) return { ok: false, error: "Falta el modelo.", status: 400 };

  if (body?.accion === "quitar") {
    const { error } = await db
      .from("modelos_nuevos")
      .delete()
      .eq("account_id", accountId)
      .in("modelo", modelos);
    return error ? traducir(error) : { ok: true };
  }

  const fila: Record<string, unknown> = {
    account_id: accountId,
    actualizado_en: new Date().toISOString(),
  };
  const booleanos = [
    ["imagenesRecibidas", "imagenes_recibidas"],
    ["imagenesEnviadas", "imagenes_enviadas"],
    ["meliClip", "meli_clip"],
    ["amazonVideo", "amazon_video"],
    ["aplusCargado", "aplus_cargado"],
    ["listo", "listo"],
  ] as const;
  for (const [campo, columna] of booleanos) {
    if (campo in (body ?? {})) fila[columna] = body[campo] === true;
  }
  if ("llegadaEstimada" in (body ?? {})) {
    const v = typeof body.llegadaEstimada === "string" ? body.llegadaEstimada.trim() : "";
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return { ok: false, error: "La fecha de llegada debe ser aaaa-mm-dd.", status: 400 };
    }
    fila.llegada_estimada = v || null;
  }
  if ("notas" in (body ?? {})) {
    fila.notas = typeof body.notas === "string" ? body.notas.slice(0, TOPE_NOTAS) : "";
  }

  const { error } = await db
    .from("modelos_nuevos")
    .upsert(modelos.map((modelo) => ({ ...fila, modelo })), { onConflict: "account_id,modelo" });
  return error ? traducir(error) : { ok: true };
}
