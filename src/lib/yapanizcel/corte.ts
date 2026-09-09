/**
 * Corte mensual de YAPANIZCEL: el mismo motor que el de calzado
 * (servicios/corte-meli.ts), alimentado desde las ÓRDENES registradas.
 *
 * La diferencia con calzado: aquí cada orden se registra con sus renglones
 * (sku, unidades, importe, comisión) en yz_ordenes_neto, así que el mes
 * completo —venta bruta, comisión, neto y las cancelaciones fuera— se arma
 * de las órdenes, sin depender de que los renglones diarios se hayan vuelto
 * a barrer. Mientras las órdenes viejas del mes no estén todas registradas,
 * la venta sale de los renglones diarios y el corte lo declara.
 */
import type { DB } from "../datos/repos";
import { cargosGuardados, periodosPendientes, progresoDeDetalle, type AlmacenCargos, type ProgresoCargos } from "../servicios/cargos-meli";
import {
  armarEstadoResultados,
  desglosePorSkuDesdeRpc,
  gastosDelRango,
  guardarCorte,
  ordenesPorDiaDesdeRpc,
  rangoDelPeriodo,
  type EstadoResultados,
  type OrdenDelCorte,
  type VentaDelCorte,
} from "../servicios/corte-meli";
import { mapaCostosUnificado } from "../servicios/costos-unificados";
import { clienteDeCuenta, type CuentaYz } from "./cuenta";
import { hoyMx, restarDias, rpcTodo, todo } from "./db";
import { adsPorDisenoCacheado } from "./publicidad";
import { desglosar } from "./sku";


export interface OrdenRegistrada extends OrdenDelCorte {
  renglones: { sku: string; unidades?: number; importe: number; comision?: number }[] | null;
}

/**
 * Renglones sku|día desde las órdenes: las canceladas fuera; un día donde
 * alguna orden cobrada aún no tiene neto deja pendiente su SKU|día (el motor
 * lo estima), sin borrar otro SKU confirmado en cero o negativo. Pura:
 * es la referencia de lo que hace el RPC `yz_cortes_ventas_desde_ordenes`
 * en la base (la página usa el RPC; 44 mil órdenes no caben en una lectura).
 */
export function ventasDesdeOrdenes(ordenes: OrdenRegistrada[]): { ventas: VentaDelCorte[]; sinRenglones: number } {
  const filas = new Map<string, { sku: string; fecha: string; unidades: number; ordenes: number; importe: number; comision: number; neto: number }>();
  const clavesIncompletas = new Set<string>();
  let sinRenglones = 0;
  for (const o of ordenes) {
    if (o.estado === "cancelled") continue;
    if (!o.renglones) {
      sinRenglones++;
      continue;
    }
    const netoOrden = o.netoActual != null ? o.netoActual : o.neto;
    const netoConocido = o.netoLeido ?? o.neto > 0;
    const importeOrden = o.renglones.reduce((a, r) => a + (Number(r.importe) || 0), 0);
    for (const r of o.renglones) {
      const clave = `${r.sku}|${o.fecha}`;
      if (o.total > 0 && !netoConocido) clavesIncompletas.add(clave);
      const f = filas.get(clave) ?? { sku: r.sku, fecha: o.fecha, unidades: 0, ordenes: 0, importe: 0, comision: 0, neto: 0 };
      f.unidades += Number(r.unidades) || 0;
      f.ordenes += 1;
      f.importe += Number(r.importe) || 0;
      f.comision += Number(r.comision) || 0;
      if (netoConocido && importeOrden > 0) f.neto += netoOrden * ((Number(r.importe) || 0) / importeOrden);
      filas.set(clave, f);
    }
  }
  const ventas = [...filas.values()].map((f) => ({
    ...f,
    neto: clavesIncompletas.has(`${f.sku}|${f.fecha}`) ? 0 : Math.round(f.neto * 100) / 100,
    netoConfirmado: !clavesIncompletas.has(`${f.sku}|${f.fecha}`),
  }));
  return { ventas, sinRenglones };
}

/** El avance de la lectura de facturación del periodo (bitácora en yz_sync_log). */
export async function progresoCargosYz(db: DB, accountId: string, periodo: string): Promise<ProgresoCargos> {
  const { data } = await db
    .from("yz_sync_log")
    .select("detalle, corrido_en")
    .eq("account_id", accountId)
    .eq("detalle->>tarea", "cargos")
    .eq("detalle->>periodo", periodo)
    .order("corrido_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  return progresoDeDetalle(periodo, data?.detalle, data?.corrido_en ?? null);
}

/** El almacén de cargos de la cuenta de fundas (yz_cargos + yz_sync_log). */
export async function almacenYz(admin: DB, accountId: string): Promise<AlmacenCargos> {
  const cliente = await clienteDeCuenta(admin, accountId);
  return {
    cliente,
    tabla: "yz_cargos",
    leerProgreso: (periodo) => progresoCargosYz(admin, accountId, periodo),
    guardarProgreso: async (p, extra) => {
      await admin.from("yz_sync_log").insert({
        account_id: accountId,
        ok: true,
        detalle: { tarea: "cargos", periodo: p.periodo, clave: p.clave, offset: p.offset, total: p.total, completo: p.completo, particion: p.particion ?? null, cursor: p.cursor ?? null, offsetParticion: p.offsetParticion ?? 0, ...extra },
      });
    },
    pendientes: async () => {
      const { data } = await admin
        .from("yz_sync_log")
        .select("detalle")
        .eq("account_id", accountId)
        .eq("detalle->>tarea", "cargos")
        .order("corrido_en", { ascending: false })
        .limit(12);
      return periodosPendientes((data ?? []).map((f: any) => f.detalle));
    },
  };
}

export async function cargarEstadoResultadosYz(db: DB, cuenta: CuentaYz, periodo: string): Promise<EstadoResultados> {
  const { desde, hasta } = rangoDelPeriodo(periodo);
  const hoy = hoyMx();
  const observados = async (d: string, h: string) => {
    const { data, error } = await db.rpc("yz_netos_observados", { p_account: cuenta.id, p_desde: d, p_hasta: h });
    if (error) throw new Error(`yz_netos_observados: ${error.message}`);
    const f: any = Array.isArray(data) ? data[0] : data;
    return { ordenes: Number(f?.ordenes_con_neto ?? 0), total: Number(f?.total ?? 0), neto: Number(f?.neto ?? 0) };
  };

  // Primero el estado de sincronización: DECIDE cuál de las dos fuentes de
  // venta se lee. Antes se bajaban las DOS en paralelo (la de renglones
  // diarios son ~126 mil filas paginadas) y una siempre se tiraba.
  const { data: sync } = await db
    .from("yz_sync_estado")
    .select("ventas_desde, ordenes_registradas_desde")
    .eq("account_id", cuenta.id)
    .maybeSingle();
  const registradasDesde: string | null = sync?.ordenes_registradas_desde ?? null;
  const ordenesCompletas = registradasDesde != null && registradasDesde <= desde;

  const args = { p_account: cuenta.id, p_desde: desde, p_hasta: hasta };
  const [ordenesPorDia, desglosePorSku, ventasCrudas, skus, config, gastos, cargos, progreso, obs, ads] = await Promise.all([
    ordenesPorDiaDesdeRpc(db, "yz_cortes_ordenes_por_dia", cuenta.id, desde, hasta),
    desglosePorSkuDesdeRpc(db, "yz_cortes_desglose_por_sku", cuenta.id, desde, hasta),
    ordenesCompletas
      ? rpcTodo<any>(db, "yz_cortes_ventas_desde_ordenes_confirmadas", args, ["sku", "fecha"])
      : rpcTodo<any>(db, "yz_ventas_renglones_confirmados", args, ["sku", "fecha"]),
    todo<{ sku: string; diseno: string | null }>(db, "yz_skus", "sku, diseno", (q) => q.eq("account_id", cuenta.id)),
    mapaCostosUnificado(db, { yzAccountId: cuenta.id }),
    gastosDelRango(db, cuenta.id, desde, hasta, "yz_gastos"),
    cargosGuardados(db, cuenta.id, periodo, "yz_cargos"),
    progresoCargosYz(db, cuenta.id, periodo).catch(() => progresoDeDetalle(periodo, null, null)),
    observados(restarDias(hoy, 59), hoy),
    adsPorDisenoCacheado(db, cuenta, periodo, { desde, hasta }).catch((err) => ({ porDiseno: new Map<string, number>(), sinAmarre: 0, error: (err as Error).message })),
  ]);

  const avisosExtra: string[] = [];
  let ventas: VentaDelCorte[];
  if (ordenesCompletas) {
    ventas = ventasCrudas.map((v) => ({
      ...v,
      unidades: Number(v.unidades) || 0,
      ordenes: Number(v.ordenes) || 0,
      importe: Number(v.importe) || 0,
      comision: Number(v.comision) || 0,
      neto: Number(v.neto) || 0,
      netoConfirmado: v.neto_confirmado === true,
    }));
    const sinRenglones = ordenesPorDia.reduce((a, d) => a + (d.sinRenglones ?? 0), 0);
    if (sinRenglones > 0) avisosExtra.push(`${sinRenglones} órdenes del mes están registradas sin sus renglones: no entran a la venta por modelo. Se corrigen solas al re-sincronizar.`);
  } else {
    ventas = ventasCrudas.map((v) => ({
      ...v,
      unidades: Number(v.unidades) || 0,
      ordenes: Number(v.ordenes) || 0,
      importe: Number(v.importe) || 0,
      comision: Number(v.comision) || 0,
      neto: v.neto == null ? 0 : Number(v.neto),
      netoConfirmado: v.neto_confirmado === true,
    }));
    avisosExtra.push(
      `Las órdenes del mes todavía se están registrando hacia atrás (van hasta ${registradasDesde ?? "hoy"}): la venta sale de los renglones diarios y las cancelaciones tardías aún no se descuentan. El cron de netos lo completa solo.`,
    );
  }

  const modeloDeSku = new Map<string, string>();
  for (const s of skus) modeloDeSku.set(s.sku, (s.diseno ?? (desglosar(s.sku).diseno || s.sku)).toUpperCase());
  for (const v of ventas) if (!modeloDeSku.has(v.sku)) modeloDeSku.set(v.sku, (desglosar(v.sku).diseno || v.sku).toUpperCase());

  const ratio = obs.ordenes >= 50 && obs.total > 0 ? obs.neto / obs.total : null;

  return armarEstadoResultados({
    periodo,
    desde,
    hasta,
    cuenta: cuenta.nickname ?? "YAPANIZCEL",
    ventas,
    ordenesPorDia,
    desglosePorSku,
    modeloDeSku,
    config,
    adsPorModelo: ads.porDiseno,
    adsSinAmarre: ads.sinAmarre,
    errorAds: ads.error,
    gastos,
    cargos,
    cargosLeidos: progreso.completo,
    cargosAvance: { offset: progreso.offset, total: progreso.total },
    ratioEstimacion: ratio,
    avisosExtra,
  });
}

export async function hacerCorteYz(db: DB, cuenta: CuentaYz, periodo: string, creadoPor: string | null): Promise<{ id: number; estado: EstadoResultados }> {
  const estado = await cargarEstadoResultadosYz(db, cuenta, periodo);
  const id = await guardarCorte(db, cuenta.id, periodo, estado, creadoPor, "yz_cortes");
  return { id, estado };
}
