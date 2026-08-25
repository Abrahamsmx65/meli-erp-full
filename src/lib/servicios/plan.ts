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
import { indexarCatalogo } from "../etiquetas/resolver";
import { cargarInsumos, type DB } from "../datos/repos";
import { enviosActivos, sumarEnCamino } from "./envios-registrados";
import {
  enCaminoDesdePendientes,
  enviosPendientesIndusther,
} from "./industher-pendientes";

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
  /** cuántas de estas cajas entraron por el rescate y van como OPCIONALES */
  cantidadOpcional: number;
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
  const opcionalElegida = new Map(elegidas.map((e) => [e.codigo, e.cantidadOpcional ?? 0]));
  const resultado = new Map<string, number>();
  const resultadoOpcional = new Map<string, number>();
  const firmasVistas = new Set<string>();

  for (const e of elegidas) {
    const def = defPorCodigo.get(e.codigo);
    if (!def) {
      resultado.set(e.codigo, e.cantidad);
      resultadoOpcional.set(e.codigo, e.cantidadOpcional ?? 0);
      continue;
    }
    const f = firma(def);
    if (firmasVistas.has(f)) continue;
    firmasVistas.add(f);

    const grupo = porFirma.get(f) ?? [def];
    let total = grupo.reduce((a, c) => a + (cantidadElegida.get(c.codigo) ?? 0), 0);
    // La marca de OPCIONAL viaja con la firma: la reasignación cambia el
    // código y sin esto las cajas del rescate se volvían "obligatorias" en
    // silencio (el commit "Plan menos holgado" quedaba solo cosmético).
    let totalOpcional = grupo.reduce(
      (a, c) => a + (opcionalElegida.get(c.codigo) ?? 0),
      0,
    );

    const ordenado = [...grupo].sort(
      (a, b) => prioridadAlmacen(a.almacen) - prioridadAlmacen(b.almacen),
    );
    const asignadas: { codigo: string; toma: number }[] = [];
    for (const c of ordenado) {
      const toma = Math.min(total, c.cajasDisponibles);
      if (toma > 0) {
        resultado.set(c.codigo, toma);
        asignadas.push({ codigo: c.codigo, toma });
      }
      total -= toma;
      if (total <= 0) break;
    }
    // No debería sobrar (el optimizador respetó disponibilidades), pero si
    // sobrara, mejor dejarlo donde estaba que perder cajas del plan.
    if (total > 0) {
      const c0 = ordenado[0];
      resultado.set(c0.codigo, (resultado.get(c0.codigo) ?? 0) + total);
      asignadas.push({ codigo: c0.codigo, toma: total });
    }
    // Las opcionales son fungibles dentro de la firma: se marcan al final de
    // la asignación (las "de más" del rescate), acotadas por lo asignado.
    for (let i = asignadas.length - 1; i >= 0 && totalOpcional > 0; i--) {
      const marca = Math.min(totalOpcional, asignadas[i].toma);
      resultadoOpcional.set(
        asignadas[i].codigo,
        (resultadoOpcional.get(asignadas[i].codigo) ?? 0) + marca,
      );
      totalOpcional -= marca;
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
      cantidadOpcional: Math.min(cantidad, resultadoOpcional.get(codigo) ?? 0),
      piezasPorCaja,
      aporta: (def?.detalle ?? []).map((d) => ({
        sku: d.sku,
        piezas: d.piezas * cantidad,
      })),
    };
  });
}


/** Pares disponibles en cajas de bodega, por SKU (para "faltanteBodega"). */
function paresEnBodega(cajas: CajaConstruida[]): { sku: string; unidades: number }[] {
  const porSku = new Map<string, number>();
  for (const c of cajas) {
    for (const d of c.detalle) {
      porSku.set(d.sku, (porSku.get(d.sku) ?? 0) + d.piezas * c.cajasDisponibles);
    }
  }
  return [...porSku.entries()].map(([sku, unidades]) => ({ sku, unidades }));
}

export async function generarPlanCompleto(
  db: DB,
  accountId: string,
  opciones?: { hoy?: ISODate; parametros?: Record<string, unknown> },
): Promise<PlanCompleto> {
  // "Hoy" es el día del NEGOCIO (México, UTC-6): con el día UTC, un plan
  // generado después de las 6 pm usaba mañana como hoy y corría las fechas.
  const hoy = opciones?.hoy ?? aISO(new Date(Date.now() - 6 * 3_600_000));

  // Los parámetros de la BASE se leen ANTES de pedir la historia: definen
  // cuántos días traer. Antes la ventana se calculaba con los defaults y si
  // el usuario subía "Historia a analizar" en Ajustes, los días extra
  // llegaban vacíos (cero ventas con stock) y diluían la demanda.
  const parametrosPedidos = (opciones?.parametros ?? {}) as Partial<Parametros>;
  const { data: paramsBd } = await db
    .from("parametros")
    .select("datos")
    .eq("account_id", accountId)
    .maybeSingle();
  const paramsPrevios = normalizarParametros({
    ...((paramsBd?.datos as Record<string, unknown>) ?? {}),
    ...parametrosPedidos,
  });
  const desde = sumarDias(hoy, -(paramsPrevios.diasHistoria + 5));

  const insumos = await cargarInsumos(db, accountId, desde);
  const p = normalizarParametros({
    ...insumos.parametros,
    ...parametrosPedidos,
    // Las cajas no se abren: nunca se mandan pares sueltos.
    permiteUnidadesSueltas: false,
  });

  // Envíos ya dados de alta en MELI que siguen en camino: sus pares cuentan
  // como "en camino" en la posición del plan — SOLO para calcular qué mandar.
  // No descuentan bodega ni tocan inventario: el reporte de existencias
  // sigue siendo la única verdad de la bodega. A los 7 días caducan solos,
  // porque para entonces MELI ya cuenta ese stock en Full.
  const enCamino = await enviosActivos(db, accountId);
  if (enCamino.length) {
    sumarEnCamino(insumos.stockActual, enCamino);
  }

  // Los envíos pendientes que la bodega (Industher) ya apartó para MELI
  // (id que empieza con 7 u 8) también cuentan como en camino, salvo los
  // que el usuario tachó. Mismo criterio del MÁXIMO que arriba: cuando
  // MELI ya los reporta en tránsito, no se cuentan doble. Si el API no
  // contesta, el plan sigue sin ellos.
  let avisoEnCamino: string | null = null;
  try {
    const pendientes = await enviosPendientesIndusther(db, accountId);
    if (pendientes.error) {
      // Sin el "en camino" el plan vuelve a sugerir lo que ya va en la
      // caja del camión: eso tiene que verse, no tragarse en un log.
      avisoEnCamino =
        `No se pudo leer lo EN CAMINO de la bodega (${pendientes.error}). ` +
        "El plan puede estar sugiriendo de más lo que ya va en camino a Full.";
    }
    // Los productos del envío traen el SKU de la bodega: se amarran al de
    // MELI por modelo+color+talla con el catálogo real, como en etiquetas.
    // Las filas de CORRIDA se reparten por talla con la corrida del pedido.
    const porSku = enCaminoDesdePendientes(
      pendientes,
      insumos.skus.length ? indexarCatalogo(insumos.skus) : null,
      insumos.corridas,
    );
    if (porSku.size) {
      const stockPorSku = new Map(insumos.stockActual.map((s) => [s.sku, s]));
      for (const [sku, pares] of porSku) {
        const s = stockPorSku.get(sku);
        if (s) {
          s.enTransferencia = Math.max(s.enTransferencia, pares);
          s.total = s.disponible + s.enTransferencia + s.noDisponible;
        } else {
          insumos.stockActual.push({
            sku,
            disponible: 0,
            enTransferencia: pares,
            noDisponible: 0,
            total: pares,
          });
        }
      }
    }
  } catch (err) {
    console.error("enviosPendientesIndusther:", (err as Error).message);
    avisoEnCamino =
      `No se pudo leer lo EN CAMINO de la bodega (${(err as Error).message.slice(0, 120)}). ` +
      "El plan puede estar sugiriendo de más lo que ya va en camino a Full.";
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

  // Las cajas APARTADAS solo se restan de lo disponible. NO se cuentan como
  // "en camino" a ningún lado: el API de hoy no dice si el envío va a Full o
  // a Amazon, y aquí no se supone nada. Cuando exista el endpoint de envíos
  // pendientes (con el ID: 7/8 = MELI), cada envío sumará EXACTAMENTE donde
  // corresponde — eso ya está conectado en enviosPendientesIndusther.

  const plan = generarPlan({
    skus: insumos.skus,
    stockActual: insumos.stockActual,
    ventas: insumos.ventas,
    snapshots: insumos.snapshots,
    operaciones: insumos.operaciones,
    // Los pares que SÍ hay en cajas de bodega, por SKU: con la lista vacía,
    // "faltanteBodega" salía igual al sugerido y toda línea decía
    // "Te faltan N pzas en bodega" aunque las cajas sobraran.
    inventarioPropio: paresEnBodega(catalogo.cajas),
    cajas: catalogo.cajas,
    overrides: insumos.overrides,
    parametros: p,
    hoy,
  });

  // La misma caja disponible en dos bodegas debe salir de la preferida:
  // el optimizador no distingue bodegas, esta pasada sí. La marca de caja
  // OPCIONAL viaja dentro de la reasignación (viajaba por código y el
  // código cambia: se perdía y todo se contaba obligatorio).
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
        cantidadOpcional: Math.min(elegida.cantidad, elegida.cantidadOpcional ?? 0),
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
  if (avisoEnCamino) avisos.push(avisoEnCamino);
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
      const { error: errLineasPlan } = await db.from("plan_lineas").insert(lineas.slice(i, i + 500));
      if (errLineasPlan) console.error("plan_lineas:", errLineasPlan.message);
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
      const { error: errCajasPlan } = await db.from("plan_cajas").insert(cajas.slice(i, i + 500));
      if (errCajasPlan) console.error("plan_cajas:", errCajasPlan.message);
    }
  }

  return planId;
}
