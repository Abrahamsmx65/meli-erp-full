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
import { descontarEnviado, enviosActivos, sumarEnCamino } from "./envios-registrados";

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

/**
 * Orden de preferencia entre bodegas: de dónde debe salir una caja cuando
 * hay de dónde escoger. Recolectar en EnvioPack es un envío aparte con su
 * propio costo, así que solo se usa cuando las otras no alcanzan; entre
 * Caseshop e Industher, la operación prefiere Industher.
 */
export function prioridadAlmacen(almacen: string): number {
  const a = almacen.toLowerCase();
  if (a.includes("industher")) return 0;
  if (a.includes("enviopack") || a.includes("envio pack")) return 2;
  return 1;
}

/**
 * Recorre las cajas elegidas hacia la bodega preferida.
 *
 * El optimizador decide QUÉ composiciones mandar por costo, y para el costo
 * da igual de qué bodega salgan — pero para la operación no: la misma caja
 * disponible en Industher y en EnvioPack debe salir de Industher, y de
 * EnvioPack solo lo que las demás no cubran. Aquí, cajas con exactamente el
 * mismo contenido se tratan como intercambiables y lo elegido se reparte por
 * prioridad de bodega, sin cambiar ni una pieza del total.
 */
export function reasignarPorBodega(
  elegidas: Plan["cajas"]["cajas"],
  catalogo: CajaConstruida[],
): Plan["cajas"]["cajas"] {
  const firma = (c: CajaConstruida) =>
    c.detalle
      .map((d) => `${d.sku}:${d.piezas}`)
      .sort()
      .join("|");

  const defPorCodigo = new Map(catalogo.map((c) => [c.codigo, c]));
  const porFirma = new Map<string, CajaConstruida[]>();
  for (const c of catalogo) {
    const f = firma(c);
    const l = porFirma.get(f);
    if (l) l.push(c);
    else porFirma.set(f, [c]);
  }

  const cantidadElegida = new Map(elegidas.map((e) => [e.codigo, e.cantidad]));
  const resultado = new Map<string, number>();
  const firmasVistas = new Set<string>();

  for (const e of elegidas) {
    const def = defPorCodigo.get(e.codigo);
    if (!def) {
      resultado.set(e.codigo, e.cantidad);
      continue;
    }
    const f = firma(def);
    if (firmasVistas.has(f)) continue;
    firmasVistas.add(f);

    const grupo = porFirma.get(f) ?? [def];
    let total = grupo.reduce((a, c) => a + (cantidadElegida.get(c.codigo) ?? 0), 0);

    const ordenado = [...grupo].sort(
      (a, b) => prioridadAlmacen(a.almacen) - prioridadAlmacen(b.almacen),
    );
    for (const c of ordenado) {
      const toma = Math.min(total, c.cajasDisponibles);
      if (toma > 0) resultado.set(c.codigo, toma);
      total -= toma;
      if (total <= 0) break;
    }
    // No debería sobrar (el optimizador respetó disponibilidades), pero si
    // sobrara, mejor dejarlo donde estaba que perder cajas del plan.
    if (total > 0) {
      const c0 = ordenado[0];
      resultado.set(c0.codigo, (resultado.get(c0.codigo) ?? 0) + total);
    }
  }

  return [...resultado.entries()].map(([codigo, cantidad]) => {
    const def = defPorCodigo.get(codigo);
    const previa = elegidas.find((e) => e.codigo === codigo);
    const piezasPorCaja =
      def?.paresPorCaja ?? previa?.piezasPorCaja ?? 0;
    return {
      codigo,
      nombre: previa?.nombre ?? null,
      cantidad,
      piezasPorCaja,
      aporta: (def?.detalle ?? []).map((d) => ({
        sku: d.sku,
        piezas: d.piezas * cantidad,
      })),
    };
  });
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

  // Envíos ya dados de alta en MELI que siguen en camino: sus cajas dejan
  // de estar disponibles en bodega y sus pares cuentan como en camino.
  // MELI no expone la Gestión de envíos por API; este registro es el puente.
  const enCamino = await enviosActivos(db, accountId);
  if (enCamino.length) {
    descontarEnviado(insumos.existencias, enCamino);
    sumarEnCamino(insumos.stockActual, enCamino);
  }

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

  // La misma caja disponible en dos bodegas debe salir de la preferida:
  // el optimizador no distingue bodegas, esta pasada sí.
  plan.cajas.cajas = reasignarPorBodega(plan.cajas.cajas, catalogo.cajas);

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
