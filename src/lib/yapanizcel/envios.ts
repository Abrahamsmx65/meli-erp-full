/**
 * Envíos a Full: armar el plan y registrar lo que se manda.
 *
 * Los envíos registrados SOLO alimentan cálculos: cuentan como "en camino"
 * hasta que caducan (o hasta que MELI ya los muestra en transferencia y se
 * marcan recibidos). Nunca descuentan inventario de bodega: la bodega la
 * dice el sheet.
 */
import type { DB } from "../datos/repos";
import { leerParametros } from "./cuenta";
import { hoyMx, restarDias, todo } from "./db";
import { cargarInventarioAmarrado, type InventarioAmarrado } from "./inventario";
import { calcularPlan, type EnCamino, type LineaPlan, type Plan } from "./plan";
import { cargarVentasAgregadas } from "./agregados";
import { cargarDescontinuados, type Descontinuados } from "./descontinuados";

export interface EnvioRegistrado {
  id: string;
  folio: string | null;
  estado: string;
  nota: string | null;
  creado_en: string;
  enviado_en: string | null;
  unidades: number;
  skus: number;
  caducado: boolean;
}

/** Envíos que todavía cuentan como en camino, más la lista completa para la pantalla. */
export async function cargarEnvios(db: DB, accountId: string, diasCaducidad: number): Promise<{
  envios: EnvioRegistrado[];
  enCamino: EnCamino[];
}> {
  const { data: cab } = await db
    .from("yz_envios")
    .select("id, folio, estado, nota, creado_en, enviado_en")
    .eq("account_id", accountId)
    .order("creado_en", { ascending: false })
    .limit(100);

  const ids = (cab ?? []).map((c) => c.id);
  const lineas = ids.length
    ? await todo<{ envio_id: string; sku_meli: string; unidades: number }>(db, "yz_envio_lineas", "envio_id, sku_meli, unidades", (q) => q.in("envio_id", ids))
    : [];

  const limite = Date.now() - diasCaducidad * 86_400_000;
  const enCamino: EnCamino[] = [];
  const envios: EnvioRegistrado[] = [];

  for (const c of cab ?? []) {
    const suyas = lineas.filter((l) => l.envio_id === c.id);
    const activo = c.estado === "preparado" || c.estado === "enviado";
    const caducado = activo && Date.parse(c.enviado_en ?? c.creado_en) < limite;
    if (activo && !caducado) {
      for (const l of suyas) enCamino.push({ skuMeli: l.sku_meli, unidades: l.unidades });
    }
    envios.push({
      ...c,
      unidades: suyas.reduce((a, l) => a + l.unidades, 0),
      skus: suyas.length,
      caducado,
    });
  }
  return { envios, enCamino };
}

export interface PlanConDetalle extends Plan {
  titulos: Map<string, string | null>;
  inventario: InventarioAmarrado;
  parametros: Awaited<ReturnType<typeof leerParametros>>;
  descontinuados: Descontinuados;
}

export async function calcularPlanDeCuenta(db: DB, accountId: string): Promise<PlanConDetalle> {
  const parametros = await leerParametros(db, accountId);
  // Hasta AYER: hoy va a medias y contarlo entero baja la venta de todos.
  const hasta = restarDias(hoyMx(), 1);
  const desde = restarDias(hasta, parametros.diasVenta - 1);

  const [skus, agregadas, stock, inventario, { enCamino }, descontinuados] = await Promise.all([
    todo<{ sku: string; titulo: string | null }>(db, "yz_skus", "sku, titulo", (q) => q.eq("account_id", accountId)),
    cargarVentasAgregadas(db, accountId, desde, hasta),
    todo<{ sku: string; disponible: number; en_transferencia: number }>(db, "yz_stock_full", "sku, disponible, en_transferencia", (q) => q.eq("account_id", accountId)),
    cargarInventarioAmarrado(db, accountId),
    cargarEnvios(db, accountId, parametros.diasCaducidadEnvio),
    cargarDescontinuados(db, accountId),
  ]);

  const plan = calcularPlan({
    // Un SKU descontinuado (sin venta en 180 días) ya no se ofrece.
    skus: skus.map((s) => s.sku).filter((sku) => !descontinuados.skus.has(sku)),
    ventas: agregadas.ventas,
    snapshots: agregadas.snapshots,
    stock: stock.map((s) => ({ sku: s.sku, disponible: s.disponible, enTransferencia: s.en_transferencia })),
    bodega: [...inventario.porSkuMeli].map(([skuMeli, unidades]) => ({ skuMeli, unidades })),
    enCamino,
    parametros,
    hasta,
  });

  return { ...plan, titulos: new Map(skus.map((s) => [s.sku, s.titulo])), inventario, parametros, descontinuados };
}

/** Registra un envío con las líneas que el usuario confirmó. */
export async function registrarEnvio(
  db: DB,
  accountId: string,
  lineas: { skuMeli: string; unidades: number }[],
  opts?: { folio?: string; nota?: string },
): Promise<{ id: string; unidades: number }> {
  const limpias = lineas
    .map((l) => ({ skuMeli: l.skuMeli.trim(), unidades: Math.max(0, Math.round(l.unidades)) }))
    .filter((l) => l.skuMeli && l.unidades > 0);
  if (!limpias.length) throw new Error("El envío no trae ninguna línea con unidades.");

  const { data: cab, error } = await db
    .from("yz_envios")
    .insert({ account_id: accountId, folio: opts?.folio?.trim() || null, nota: opts?.nota?.trim() || null, estado: "preparado" })
    .select("id")
    .single();
  if (error || !cab) throw new Error(error?.message ?? "No se pudo crear el envío.");

  const { error: e2 } = await db
    .from("yz_envio_lineas")
    .insert(limpias.map((l) => ({ envio_id: cab.id, sku_meli: l.skuMeli, unidades: l.unidades })));
  if (e2) throw new Error(e2.message);

  return { id: cab.id, unidades: limpias.reduce((a, l) => a + l.unidades, 0) };
}

export async function cambiarEstadoEnvio(db: DB, accountId: string, id: string, estado: "preparado" | "enviado" | "recibido" | "cancelado"): Promise<void> {
  const cambios: Record<string, unknown> = { estado };
  if (estado === "enviado") cambios.enviado_en = new Date().toISOString();
  const { error } = await db.from("yz_envios").update(cambios).eq("account_id", accountId).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Las líneas de un envío, para el detalle y el Excel. */
export async function lineasDeEnvio(db: DB, id: string): Promise<{ sku_meli: string; unidades: number }[]> {
  return todo(db, "yz_envio_lineas", "sku_meli, unidades", (q) => q.eq("envio_id", id).order("sku_meli"));
}

export type { LineaPlan };
