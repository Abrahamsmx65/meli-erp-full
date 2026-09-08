/**
 * Carga del corte general: el corte de calzado, el de fundas y el bloque de
 * Amazon del mismo mes, y el consolidado. Cada canal que falle o no exista
 * se declara en los avisos en vez de tumbar la pantalla.
 */
import { cuentaActiva, type Cuenta, type DB } from "../datos/repos";
import { cuentaActiva as cuentaYz } from "../yapanizcel/cuenta";
import { cargarEstadoResultadosYz } from "../yapanizcel/corte";
import { cargarMonitorAmazon } from "./amazon-monitor";
import { cuentaAmazon } from "./amazon";
import { armarConsolidado, bloqueDesdeEstado, type BloqueCanal, type Consolidado } from "./consolidado";
import { bloqueAmazon } from "./consolidado-amazon";
import { cargarEstadoResultados, rangoDelPeriodo } from "./corte-meli";
import { mapaCostosUnificado } from "./costos-unificados";

export async function cargarConsolidado(db: DB, cuenta: Cuenta, periodo: string): Promise<Consolidado> {
  const { desde, hasta } = rangoDelPeriodo(periodo);
  const avisos: string[] = [];
  const bloques: BloqueCanal[] = [];

  const [calzado, fundas, amazon] = await Promise.all([
    cargarEstadoResultados(db, cuenta, periodo).then(
      (e) => bloqueDesdeEstado("meli_calzado", e),
      (err) => {
        avisos.push(`Calzado · Mercado Libre no se pudo cargar: ${(err as Error).message}`);
        return null;
      },
    ),
    (async () => {
      const yz = await cuentaYz(db);
      if (!yz) return null;
      try {
        return bloqueDesdeEstado("meli_fundas", await cargarEstadoResultadosYz(db, yz, periodo));
      } catch (err) {
        avisos.push(`Fundas · Mercado Libre no se pudo cargar: ${(err as Error).message}`);
        return null;
      }
    })(),
    (async () => {
      const amz = await cuentaAmazon(db);
      if (!amz) return null;
      try {
        const [monitor, config] = await Promise.all([cargarMonitorAmazon(db, amz.id, cuenta.id, { desde, hasta }), mapaCostosUnificado(db, { meliAccountId: cuenta.id })]);
        return bloqueAmazon(monitor, config);
      } catch (err) {
        avisos.push(`Amazon no se pudo cargar: ${(err as Error).message}`);
        return null;
      }
    })(),
  ]);
  for (const b of [calzado, fundas, amazon]) if (b) bloques.push(b);

  return armarConsolidado({ periodo, desde, hasta, bloques, avisos });
}

export interface CorteGeneralGuardado {
  id: number;
  periodo: string;
  creadoEn: string;
  ventaBruta: number;
  utilidadNeta: number;
  exacto: boolean;
}

export async function hacerCorteGeneral(db: DB, cuenta: Cuenta, periodo: string, creadoPor: string | null): Promise<{ id: number; consolidado: Consolidado }> {
  const consolidado = await cargarConsolidado(db, cuenta, periodo);
  const { data, error } = await db
    .from("cortes_generales")
    .upsert(
      { account_id: cuenta.id, periodo, desde: consolidado.desde, hasta: consolidado.hasta, resumen: consolidado, creado_en: new Date().toISOString(), creado_por: creadoPor },
      { onConflict: "account_id,periodo" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error(`No se pudo guardar el corte general: ${error?.message ?? "sin id"}`);
  return { id: Number(data.id), consolidado };
}

export async function listarCortesGenerales(db: DB, accountId: string): Promise<CorteGeneralGuardado[]> {
  const { data } = await db.from("cortes_generales").select("id, periodo, creado_en, resumen").eq("account_id", accountId).order("periodo", { ascending: false }).limit(36);
  return (data ?? []).map((c: any) => ({
    id: Number(c.id),
    periodo: c.periodo,
    creadoEn: c.creado_en,
    ventaBruta: Number(c.resumen?.total?.ventaBruta) || 0,
    utilidadNeta: Number(c.resumen?.total?.utilidadNeta) || 0,
    exacto: Boolean(c.resumen?.exacto),
  }));
}

export async function cargarCorteGeneral(db: DB, accountId: string, id: number): Promise<Consolidado | null> {
  const { data } = await db.from("cortes_generales").select("resumen").eq("account_id", accountId).eq("id", id).maybeSingle();
  return (data?.resumen as Consolidado) ?? null;
}

export { cuentaActiva };
