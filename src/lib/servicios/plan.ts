/**
 * Servicio de planeación: junta los insumos de la base, arma el catálogo de
 * cajas y corre el motor. Es el único punto donde se genera un plan, para
 * que la app y el cron siempre calculen exactamente lo mismo.
 */
import { generarPlan } from "../engine";
import { sumarDias, aISO } from "../engine/fechas";
import { normalizarParametros } from "../engine/params";
import type { ISODate, Parametros, Plan } from "../engine/types";
import { construirCajas, type CajaConstruida, type FilaSinCorrida, type SkuSinAmarre } from "../importar/cajas";
import { construirIndice } from "../importar/sku";
import { cargarInsumos, type DB } from "../datos/repos";

export interface CajaPlaneada {
  codigo: string;
  cantidad: number;
  paresPorCaja: number;
  paresTotales: number;
  almacen: string;
  skuCaja: string;
  pedido: string;
  modelo: string;
  color: string;
  talla: string;
  esCorrida: boolean;
  contenedores: string[];
  cajasDisponibles: number;
  /** qué SKUs y cuántos pares aporta este bloque de cajas */
  aporta: { sku: string; talla: string; paresPorCaja: number; paresTotales: number }[];
}

export interface PlanCompleto {
  plan: Plan;
  cajasPlaneadas: CajaPlaneada[];
  pendientes: {
    sinCorrida: FilaSinCorrida[];
    sinAmarre: SkuSinAmarre[];
  };
  catalogo: {
    tiposDeCaja: number;
    cajasDisponibles: number;
    paresEnBodega: number;
    skusEnBodega: number;
  };
  avisos: string[];
}

export async function generarPlanCompleto(
  db: DB,
  accountId: string,
  opciones?: { hoy?: ISODate; parametros?: Record<string, unknown> },
): Promise<PlanCompleto> {
  const hoy = opciones?.hoy ?? aISO(new Date());

  // Se leen los parámetros primero porque definen qué tanta historia traer.
  const parametrosPedidos = (opciones?.parametros ?? {}) as Partial<Parametros>;
  const paramsPrevios = normalizarParametros(parametrosPedidos);
  const desde = sumarDias(hoy, -(paramsPrevios.diasHistoria + 5));

  const insumos = await cargarInsumos(db, accountId, desde);
  const p = normalizarParametros({
    ...insumos.parametros,
    ...parametrosPedidos,
    // Las cajas no se abren: nunca se mandan pares sueltos.
    permiteUnidadesSueltas: false,
  });

  // El catálogo real de MELI es la autoridad sobre qué SKU existe.
  const indice = insumos.skus.length
    ? construirIndice(insumos.skus.map((s) => s.sku))
    : null;

  const catalogo = construirCajas(insumos.existencias, insumos.corridas, {
    indice,
    mapeoManual: insumos.mapeoManual,
    almacenes: insumos.almacenesActivos,
  });

  const plan = generarPlan({
    skus: insumos.skus,
    stockActual: insumos.stockActual,
    ventas: insumos.ventas,
    snapshots: insumos.snapshots,
    operaciones: insumos.operaciones,
    inventarioPropio: [],
    cajas: catalogo.cajas,
    overrides: insumos.overrides,
    parametros: p,
    hoy,
  });

  // El motor devuelve códigos internos; aquí se vuelven algo que un humano
  // puede tomar y ejecutar en la bodega.
  const porCodigo = new Map<string, CajaConstruida>(
    catalogo.cajas.map((c) => [c.codigo, c]),
  );

  const cajasPlaneadas: CajaPlaneada[] = plan.cajas.cajas
    .map((elegida) => {
      const def = porCodigo.get(elegida.codigo);
      if (!def) return null;
      return {
        codigo: elegida.codigo,
        cantidad: elegida.cantidad,
        paresPorCaja: def.paresPorCaja,
        paresTotales: elegida.cantidad * def.paresPorCaja,
        almacen: def.almacen,
        skuCaja: def.skuCaja,
        pedido: def.pedido,
        modelo: def.modelo,
        color: def.color,
        talla: def.talla,
        esCorrida: def.esCorrida,
        contenedores: def.contenedores,
        cajasDisponibles: def.cajasDisponibles,
        aporta: def.detalle.map((d) => ({
          sku: d.sku,
          talla: d.talla,
          paresPorCaja: d.piezas,
          paresTotales: d.piezas * elegida.cantidad,
        })),
      } satisfies CajaPlaneada;
    })
    .filter((x): x is CajaPlaneada => x !== null)
    .sort((a, b) => b.paresTotales - a.paresTotales);

  const avisos = catalogo.avisos.map((a) => a.mensaje);
  if (!insumos.skus.length) {
    avisos.push(
      "Todavía no hay catálogo de Mercado Libre sincronizado, así que los SKUs de las cajas no están verificados contra MELI.",
    );
  }

  return {
    plan,
    cajasPlaneadas,
    pendientes: {
      sinCorrida: catalogo.sinCorrida,
      sinAmarre: catalogo.sinAmarre,
    },
    catalogo: {
      tiposDeCaja: catalogo.resumen.cajasArmadas,
      cajasDisponibles: catalogo.resumen.cajasTotales,
      paresEnBodega: catalogo.resumen.paresTotales,
      skusEnBodega: catalogo.resumen.skusDistintos,
    },
    avisos,
  };
}

/** Guarda un plan para poder consultarlo después y comparar contra lo que sí se mandó. */
export async function guardarPlan(
  db: DB,
  accountId: string,
  completo: PlanCompleto,
): Promise<string> {
  const { data, error } = await db
    .from("planes")
    .insert({
      account_id: accountId,
      parametros: completo.plan.parametros,
      resumen: { ...completo.plan.resumen, catalogo: completo.catalogo },
    })
    .select("id")
    .single();

  if (error) throw new Error(`No se pudo guardar el plan: ${error.message}`);
  const planId = data.id as string;

  const lineas = completo.plan.lineas
    .filter((l) => l.sugerido > 0 || l.estado === "critico" || l.estado === "urgente")
    .map((l) => ({ plan_id: planId, sku: l.sku, datos: l }));

  if (lineas.length) {
    for (let i = 0; i < lineas.length; i += 500) {
      await db.from("plan_lineas").insert(lineas.slice(i, i + 500));
    }
  }

  const cajas = completo.cajasPlaneadas.map((c) => ({
    plan_id: planId,
    caja_codigo: c.codigo,
    almacen: c.almacen,
    sku_caja: c.skuCaja,
    talla: c.talla,
    cantidad: c.cantidad,
    pares: c.paresTotales,
    detalle: c.aporta,
  }));

  if (cajas.length) {
    for (let i = 0; i < cajas.length; i += 500) {
      await db.from("plan_cajas").insert(cajas.slice(i, i + 500));
    }
  }

  return planId;
}
