/**
 * Monitor de ventas de Mercado Libre.
 *
 * Tres preguntas, en orden de urgencia: ¿cómo va HOY?, ¿qué está subiendo y
 * qué está bajando esta semana?, y ¿por qué? La comparación es semana contra
 * semana anterior a nivel MODELO (todos los colores y tallas juntos), porque
 * así se piensa el negocio: "el GT114" y no color por color ni talla por talla.
 *
 * La razón de una caída se busca primero en el stock — la causa más común de
 * "vender menos" es no tener qué vender — y solo si el stock no explica nada
 * se atribuye a la demanda.
 */
import { traerTodo, type DB } from "../datos/repos";
import { conCacheApp } from "./cache-app";
import { configPorProducto } from "./productos";

/** Compatibilidad: sin marca explícita, solo los netos positivos históricos eran reales. */
export function netoConfirmadoDeFila(fila: { neto?: unknown; neto_confirmado?: unknown }): number | null {
  if (fila.neto == null) return null;
  const neto = Number(fila.neto);
  if (!Number.isFinite(neto)) return null;
  if (fila.neto_confirmado === true) return neto;
  if (fila.neto_confirmado == null && neto > 0) return neto;
  return null;
}

export interface ResumenDia {
  unidades: number;
  importe: number;
  ordenes: number;
}

export interface FilaModelo {
  modelo: string;
  unidades7: number;
  unidades7Prev: number;
  importe7: number;
  unidadesHoy: number;
  colores: number;
  /** categoría capturada en Productos y costos; null = sin categoría */
  categoria: string | null;
  /** venta neta del periodo (depósito real donde ya llegó, importe − comisión donde no) */
  neto7: number;
  /** gasto en Product Ads del modelo en el periodo; null = sin dato de ads */
  publicidad7: number | null;
  /** neto − costo (− publicidad cuando hay dato de ads); null = sin costo */
  ganancia7: number | null;
}

export interface FilaCategoria {
  categoria: string;
  unidades7: number;
  importe7: number;
  neto7: number;
  /** gasto en Product Ads de los modelos de la categoría; null = sin dato de ads */
  publicidad7: number | null;
  ganancia7: number | null;
}

export interface Movimiento {
  producto: string;
  modelo: string;
  color: string;
  antes: number;
  ahora: number;
  delta: number;
  razon: string;
}

/** A dónde se fue el dinero del periodo, con lo que MELI ya reportó. */
export interface DesgloseDinero {
  /** venta bruta del periodo (precio × unidades) */
  bruto: number;
  /** comisiones de MELI (sale_fee) */
  comision: number;
  /** lo depositado: neto real donde ya se conoce, importe − comisión donde no */
  neto: number;
  /**
   * Envíos, retenciones y otros cargos = bruto − comisión − neto, calculado
   * SOLO sobre la parte del periodo cuyo neto real ya llegó de Mercado
   * Pago. null = todavía no hay neto real en el periodo.
   */
  enviosYOtros: number | null;
  /** qué fracción del importe del periodo ya tiene neto REAL (0-1) */
  coberturaNetoReal: number;
  /** costo de producto de las unidades vendidas (donde hay costo capturado) */
  costoProducto: number;
  /** neto − costo, donde hay costo capturado */
  gananciaReal: number;
}

export interface Monitor {
  hoy: ResumenDia;
  ayer: ResumenDia;
  semana: ResumenDia;
  porModelo: FilaModelo[];
  porCategoria: FilaCategoria[];
  subiendo: Movimiento[];
  bajando: Movimiento[];
  /** ganancia de la semana, solo de la venta con costo capturado */
  ganancia7: number;
  /** qué fracción de las unidades de la semana tiene costo capturado (0-1) */
  coberturaCosto: number;
  desglose: DesgloseDinero;
}

/** Fecha local de México (las ventas se guardan con el huso de MELI). */
export function fechaMx(desplazamientoDias = 0): string {
  return new Date(Date.now() - 6 * 3_600_000 - desplazamientoDias * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export interface RangoFechas {
  desde: string;
  hasta: string;
}

/** Valida el rango que viene de la URL; sin rango, los últimos 7 días. */
export function normalizarRango(desde?: string, hasta?: string): RangoFechas {
  const valida = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const hoy = fechaMx(0);
  let d = valida(desde) ?? fechaMx(6);
  let h = valida(hasta) ?? hoy;
  if (h > hoy) h = hoy;
  if (d > h) d = h;
  return { desde: d, hasta: h };
}

/** Días que abarca el rango, contando ambos extremos. */
export function diasDeRango(r: RangoFechas): number {
  return Math.max(1, Math.round((Date.parse(r.hasta) - Date.parse(r.desde)) / 86_400_000) + 1);
}

/** El periodo anterior del mismo largo, para comparar. */
function rangoPrevio(r: RangoFechas): RangoFechas {
  const dias = diasDeRango(r);
  const desde = new Date(Date.parse(r.desde) - dias * 86_400_000).toISOString().slice(0, 10);
  const hasta = new Date(Date.parse(r.desde) - 86_400_000).toISOString().slice(0, 10);
  return { desde, hasta };
}

/**
 * Un minuto de caché por instancia: el monitor baja decenas de miles de
 * renglones de venta por clic y el latido solo escribe una vez por minuto —
 * releerlo en cada visita era puro tiempo perdido.
 */
const cacheMonitor = new Map<string, { en: number; datos: Monitor }>();
const VIDA_CACHE_MONITOR_MS = 60_000;

/**
 * Reutiliza el agregado completo por cuenta y rango. La búsqueda, el orden y
 * la página se aplican después sobre este resultado y no forman parte de la
 * clave, por lo que navegar la tabla no vuelve a consultar sus fuentes.
 */
export async function cargarMonitor(db: DB, accountId: string, rango?: RangoFechas): Promise<Monitor> {
  const r = rango ?? normalizarRango();
  return conCacheApp(
    db,
    accountId,
    `ventas-monitor:${r.desde}:${r.hasta}`,
    VIDA_CACHE_MONITOR_MS,
    () => calcularMonitor(db, accountId, r),
  );
}

async function calcularMonitor(db: DB, accountId: string, rango: RangoFechas): Promise<Monitor> {
  const hoy = fechaMx(0);
  const ayer = fechaMx(1);
  const r = rango;

  const claveCache = `${accountId}|${r.desde}|${r.hasta}|${hoy}`;
  const guardado = cacheMonitor.get(claveCache);
  if (guardado && Date.now() - guardado.en < VIDA_CACHE_MONITOR_MS) return guardado.datos;
  const inicioSemana = r.desde;
  const finRango = r.hasta;
  const previo = rangoPrevio(r);
  const inicioPrev = previo.desde;

  // Las columnas nuevas pueden no existir todavía: se pide el contrato actual
  // y se degrada en cascada para bases pendientes de migración.
  const leerVentas = async (): Promise<any[]> => {
    const filtro = (q: any) => q.eq("account_id", accountId).gte("fecha", inicioPrev);
    try {
      return await traerTodo<any>(
        db,
        "ventas_diarias",
        "sku, fecha, unidades, ordenes, importe, comision, neto, neto_confirmado",
        filtro,
      );
    } catch {
      try {
        return await traerTodo<any>(
          db,
          "ventas_diarias",
          "sku, fecha, unidades, ordenes, importe, comision",
          filtro,
        );
      } catch {
        return traerTodo<any>(db, "ventas_diarias", "sku, fecha, unidades, ordenes, importe", filtro);
      }
    }
  };

  /**
   * Un renglón por SKU con las sumas que este monitor hacía en Node. La
   * forma es la misma que devuelve el RPC `ventas_resumen_sku`; el respaldo
   * renglón por renglón produce EXACTAMENTE lo mismo desde la tabla cruda.
   */
  interface AgregadoSku {
    sku: string;
    unidades: number;
    ordenes: number;
    importe: number;
    comision: number;
    /** neto real confirmado; importe − comisión donde aún no llegó */
    netoResuelto: number;
    importeNetoReal: number;
    comisionNetoReal: number;
    netoReal: number;
    unidadesHoy: number;
    unidadesPrev: number;
  }
  interface Agregados {
    porSku: AgregadoSku[];
    porDia: Map<string, ResumenDia>;
  }

  // Sumado en Postgres: bajar decenas de miles de renglones para sumarlos
  // aquí era el costo más alto de abrir la pantalla.
  const agregadosDesdeRpc = async (): Promise<Agregados | null> => {
    const hastaTotales = hoy > finRango ? hoy : finRango;
    const [porSkuR, porDiaR] = await Promise.all([
      db.rpc("ventas_resumen_sku", {
        p_account: accountId,
        p_desde: inicioSemana,
        p_hasta: finRango,
        p_prev_desde: previo.desde,
        p_prev_hasta: previo.hasta,
        p_hoy: hoy,
      }),
      db.rpc("ventas_totales_dia", {
        p_account: accountId,
        p_desde: inicioPrev,
        p_hasta: hastaTotales,
      }),
    ]);
    if (porSkuR.error || porDiaR.error) return null;
    const porSku: AgregadoSku[] = ((porSkuR.data ?? []) as any[]).map((f) => ({
      sku: String(f.sku),
      unidades: Number(f.unidades) || 0,
      ordenes: Number(f.ordenes) || 0,
      importe: Number(f.importe) || 0,
      comision: Number(f.comision) || 0,
      netoResuelto: Number(f.neto_resuelto) || 0,
      importeNetoReal: Number(f.importe_neto_real) || 0,
      comisionNetoReal: Number(f.comision_neto_real) || 0,
      netoReal: Number(f.neto_real) || 0,
      unidadesHoy: Number(f.unidades_hoy) || 0,
      unidadesPrev: Number(f.unidades_prev) || 0,
    }));
    const porDia = new Map<string, ResumenDia>(
      ((porDiaR.data ?? []) as any[]).map((f) => [
        String(f.fecha),
        {
          unidades: Number(f.unidades) || 0,
          importe: Number(f.importe) || 0,
          ordenes: Number(f.ordenes) || 0,
        },
      ]),
    );
    return { porSku, porDia };
  };

  // Respaldo renglón por renglón (si el RPC no existe todavía en la base):
  // las mismas cuentas de siempre, solo que dejando la MISMA forma agregada.
  const agregadosDesdeRenglones = (filas: any[]): Agregados => {
    const porSku = new Map<string, AgregadoSku>();
    const porDia = new Map<string, ResumenDia>();
    for (const v of filas) {
      const d = porDia.get(v.fecha) ?? { unidades: 0, importe: 0, ordenes: 0 };
      d.unidades += v.unidades ?? 0;
      d.importe += v.importe ?? 0;
      d.ordenes += v.ordenes ?? 0;
      porDia.set(v.fecha, d);

      const a =
        porSku.get(v.sku) ??
        {
          sku: v.sku,
          unidades: 0,
          ordenes: 0,
          importe: 0,
          comision: 0,
          netoResuelto: 0,
          importeNetoReal: 0,
          comisionNetoReal: 0,
          netoReal: 0,
          unidadesHoy: 0,
          unidadesPrev: 0,
        };
      if (v.fecha >= inicioSemana && v.fecha <= finRango) {
        a.unidades += v.unidades ?? 0;
        a.ordenes += v.ordenes ?? 0;
        a.importe += v.importe ?? 0;
        a.comision += v.comision ?? 0;
        // La marca explícita distingue un saldo confirmado en cero/negativo
        // del cero centinela histórico que significaba "todavía no leído".
        const netoRealFila = netoConfirmadoDeFila(v);
        a.netoResuelto += netoRealFila ?? (v.importe ?? 0) - (v.comision ?? 0);
        if (netoRealFila != null) {
          a.importeNetoReal += v.importe ?? 0;
          a.comisionNetoReal += v.comision ?? 0;
          a.netoReal += netoRealFila;
        }
        if (v.fecha === hoy) a.unidadesHoy += v.unidades ?? 0;
      } else if (v.fecha >= inicioPrev && v.fecha <= previo.hasta) {
        a.unidadesPrev += v.unidades ?? 0;
      }
      porSku.set(v.sku, a);
    }
    return { porSku: [...porSku.values()], porDia };
  };

  const [agregados, skus, stock, snapshots, config] = await Promise.all([
    (async () => (await agregadosDesdeRpc()) ?? agregadosDesdeRenglones(await leerVentas()))(),
    traerTodo<any>(db, "skus", "sku, modelo, color", (q) =>
      q.eq("account_id", accountId).eq("activo", true),
    ),
    traerTodo<any>(db, "stock_full", "sku, disponible, en_transferencia", (q) =>
      q.eq("account_id", accountId),
    ),
    // SOLO las fotos en cero: es lo único que el monitor usa (días
    // agotados). Traerlas todas eran ~36 mil filas por clic.
    traerTodo<any>(db, "stock_snapshots", "sku, fecha, disponible", (q) =>
      q.eq("account_id", accountId).gte("fecha", inicioPrev).eq("disponible", 0),
    ),
    configPorProducto(db, accountId),
  ]);

  const infoSku = new Map(skus.map((s) => [s.sku, s]));
  const stockDe = new Map(stock.map((s) => [s.sku, s]));

  const partes = (sku: string): { modelo: string; color: string } => {
    const info = infoSku.get(sku);
    if (info?.modelo) return { modelo: info.modelo, color: info.color ?? "" };
    const [modelo, color] = sku.split("-");
    return { modelo: modelo ?? sku, color: color ?? "" };
  };

  // --- Totales del día, de ayer y de la semana -----------------------------
  const resumen = (desde: string, hasta: string): ResumenDia => {
    let unidades = 0;
    let importe = 0;
    let ordenes = 0;
    for (const [fecha, d] of agregados.porDia) {
      if (fecha < desde || fecha > hasta) continue;
      unidades += d.unidades;
      importe += d.importe;
      ordenes += d.ordenes;
    }
    return { unidades, importe, ordenes };
  };

  // --- Por modelo y por producto (modelo + color) --------------------------
  const modelos = new Map<
    string,
    { unidades7: number; unidades7Prev: number; importe7: number; unidadesHoy: number; colores: Set<string> }
  >();
  const productos = new Map<
    string,
    { modelo: string; color: string; d7: number; prev7: number; importe7: number; neto7: number }
  >();

  let brutoP = 0;
  let comisionP = 0;
  let netoP = 0;
  let brutoConNetoReal = 0;
  let comisionConNetoReal = 0;
  let netoRealSolo = 0;

  for (const a of agregados.porSku) {
    const { modelo, color } = partes(a.sku);
    const m =
      modelos.get(modelo) ??
      { unidades7: 0, unidades7Prev: 0, importe7: 0, unidadesHoy: 0, colores: new Set<string>() };
    const claveProd = `${modelo}|${color}`;
    const pr =
      productos.get(claveProd) ??
      { modelo, color, d7: 0, prev7: 0, importe7: 0, neto7: 0 };

    m.unidades7 += a.unidades;
    m.importe7 += a.importe;
    m.unidadesHoy += a.unidadesHoy;
    m.unidades7Prev += a.unidadesPrev;
    pr.d7 += a.unidades;
    pr.importe7 += a.importe;
    pr.neto7 += a.netoResuelto;
    pr.prev7 += a.unidadesPrev;

    // Acumuladores del desglose de dinero del periodo.
    brutoP += a.importe;
    comisionP += a.comision;
    netoP += a.netoResuelto;
    brutoConNetoReal += a.importeNetoReal;
    comisionConNetoReal += a.comisionNetoReal;
    netoRealSolo += a.netoReal;

    if (color) m.colores.add(color);
    modelos.set(modelo, m);
    productos.set(claveProd, pr);
  }

  // --- Ganancia y categorías (con lo capturado en Productos y costos) ------
  // Ganancia = (importe - comisión de MELI) - costo × unidades. Solo se
  // calcula donde hay costo capturado; el resto se reporta como cobertura.
  const gananciaPorModelo = new Map<string, number>();
  const netoPorModelo = new Map<string, number>();
  const modeloConCosto = new Set<string>();
  const categorias = new Map<string, { unidades7: number; importe7: number; neto7: number; ganancia7: number; conCosto: boolean }>();
  let ganancia7 = 0;
  let unidadesConCosto = 0;
  let unidadesSemanaTotal = 0;
  let costoProductoP = 0;

  for (const pr of productos.values()) {
    unidadesSemanaTotal += pr.d7;
    // El costo y la categoría son por MODELO: mismo precio todos los colores.
    const cfg = config.get(pr.modelo);
    const categoria = cfg?.categoria ?? "Sin categoría";
    const cat =
      categorias.get(categoria) ??
      { unidades7: 0, importe7: 0, neto7: 0, ganancia7: 0, conCosto: false };
    cat.unidades7 += pr.d7;
    cat.importe7 += pr.importe7;
    cat.neto7 += pr.neto7;
    netoPorModelo.set(pr.modelo, (netoPorModelo.get(pr.modelo) ?? 0) + pr.neto7);

    if (cfg?.costo != null && pr.d7 > 0) {
      costoProductoP += cfg.costo * pr.d7;
      const g = pr.neto7 - cfg.costo * pr.d7;
      ganancia7 += g;
      unidadesConCosto += pr.d7;
      gananciaPorModelo.set(pr.modelo, (gananciaPorModelo.get(pr.modelo) ?? 0) + g);
      modeloConCosto.add(pr.modelo);
      cat.ganancia7 += g;
      cat.conCosto = true;
    }
    categorias.set(categoria, cat);
  }

  const porCategoria: FilaCategoria[] = [...categorias.entries()]
    .map(([categoria, c]) => ({
      categoria,
      unidades7: c.unidades7,
      importe7: c.importe7,
      neto7: c.neto7,
      publicidad7: null,
      ganancia7: c.conCosto ? c.ganancia7 : null,
    }))
    .sort((a, b) => b.unidades7 - a.unidades7);

  // --- Razones: qué dice el stock de cada producto -------------------------
  // Tallas agotadas hoy, y tallas que estuvieron agotadas algún día de la
  // semana según las fotos diarias.
  // Por MODELO completo (todos los colores y tallas): así se piensa el
  // negocio —"el GT114"— y así se leen las listas de suben y bajan.
  const tallasDe = new Map<string, string[]>();
  for (const s of skus) {
    const clave = s.modelo ?? s.sku.split("-")[0] ?? s.sku;
    const l = tallasDe.get(clave);
    if (l) l.push(s.sku);
    else tallasDe.set(clave, [s.sku]);
  }

  const diasAgotadoSemana = new Map<string, number>();
  for (const f of snapshots) {
    if (f.fecha < inicioSemana) continue;
    if ((f.disponible ?? 0) > 0) continue;
    diasAgotadoSemana.set(f.sku, (diasAgotadoSemana.get(f.sku) ?? 0) + 1);
  }

  const razonDe = (clave: string, subio: boolean): string => {
    const tallas = tallasDe.get(clave) ?? [];
    if (!tallas.length) return subio ? "La demanda subió." : "La demanda bajó.";

    const agotadasHoy = tallas.filter((sku) => (stockDe.get(sku)?.disponible ?? 0) === 0);
    const conQuiebre = tallas.filter((sku) => (diasAgotadoSemana.get(sku) ?? 0) >= 2);

    if (!subio) {
      if (agotadasHoy.length === tallas.length) return "Agotado por completo en Full.";
      if (agotadasHoy.length > 0)
        return `${agotadasHoy.length} de ${tallas.length} tallas agotadas en Full.`;
      if (conQuiebre.length > 0)
        return `${conQuiebre.length} tallas estuvieron agotadas varios días esta semana.`;
      return "Con stock: la demanda bajó.";
    }

    const enCamino = tallas.some((sku) => (stockDe.get(sku)?.en_transferencia ?? 0) > 0);
    const teniaQuiebrePrev = tallas.some((sku) => {
      // ¿Estuvo agotado la semana pasada y ahora tiene stock?
      const conStockHoy = (stockDe.get(sku)?.disponible ?? 0) > 0;
      const agotadoAntes = snapshots.some(
        (f) => f.sku === sku && f.fecha < inicioSemana && (f.disponible ?? 0) === 0,
      );
      return conStockHoy && agotadoAntes;
    });
    if (teniaQuiebrePrev) return "Se repuso stock que estaba agotado.";
    if (enCamino) return "La demanda subió (y ya viene más stock en camino).";
    return "La demanda subió.";
  };

  // Un movimiento por MODELO, con todos sus colores y tallas juntos: ver el
  // GT114 negro y el GT114 café por separado no le dice nada al dueño.
  const movimientos = [...modelos.entries()]
    .filter(([, m]) => m.unidades7 + m.unidades7Prev >= 10) // sin volumen no hay tendencia que leer
    .map(([modelo, m]) => ({
      producto: modelo,
      modelo,
      color: "",
      antes: m.unidades7Prev,
      ahora: m.unidades7,
      delta: m.unidades7 - m.unidades7Prev,
      razon: "",
    }));

  const subiendo = movimientos
    .filter((m) => m.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 8)
    .map((m) => ({ ...m, razon: razonDe(m.modelo, true) }));

  const bajando = movimientos
    .filter((m) => m.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 8)
    .map((m) => ({ ...m, razon: razonDe(m.modelo, false) }));

  const porModelo: FilaModelo[] = [...modelos.entries()]
    .map(([modelo, m]) => ({
      modelo,
      unidades7: m.unidades7,
      unidades7Prev: m.unidades7Prev,
      importe7: m.importe7,
      unidadesHoy: m.unidadesHoy,
      colores: m.colores.size,
      categoria: config.get(modelo)?.categoria ?? null,
      neto7: netoPorModelo.get(modelo) ?? 0,
      publicidad7: null,
      ganancia7: modeloConCosto.has(modelo) ? (gananciaPorModelo.get(modelo) ?? 0) : null,
    }))
    // Todos los modelos: la tabla se filtra y se ordena en pantalla.
    .sort((a, b) => b.unidades7 - a.unidades7);

  const monitor: Monitor = {
    hoy: resumen(hoy, hoy),
    ayer: resumen(ayer, ayer),
    semana: resumen(inicioSemana, finRango),
    porModelo,
    porCategoria,
    subiendo,
    bajando,
    ganancia7,
    coberturaCosto: unidadesSemanaTotal > 0 ? unidadesConCosto / unidadesSemanaTotal : 0,
    desglose: {
      bruto: brutoP,
      comision: comisionP,
      neto: netoP,
      enviosYOtros:
        brutoConNetoReal > 0 ? brutoConNetoReal - comisionConNetoReal - netoRealSolo : null,
      coberturaNetoReal: brutoP > 0 ? brutoConNetoReal / brutoP : 0,
      costoProducto: costoProductoP,
      gananciaReal: ganancia7,
    },
  };
  cacheMonitor.set(claveCache, { en: Date.now(), datos: monitor });
  return monitor;
}

/**
 * Resta la publicidad por modelo a la ganancia de las tablas del monitor
 * (pura; la página la aplica cuando Product Ads sí contestó). La regla es
 * la del corte: la publicidad se descuenta al modelo que la gastó, y por
 * categoría se suma la de sus modelos. Un modelo sin costo capturado sigue
 * sin ganancia calculable (null), con o sin ads: no se inventa. Sin mapa
 * (ads caídos) el monitor queda igual, con publicidad7 en null, y la
 * pantalla lo declara.
 */
export function aplicarPublicidadAlMonitor(m: Monitor, adsPorModelo: Map<string, number> | null): Monitor {
  if (!adsPorModelo) return m;

  const porModelo: FilaModelo[] = m.porModelo.map((f) => {
    const ads = adsPorModelo.get(f.modelo) ?? 0;
    return { ...f, publicidad7: ads, ganancia7: f.ganancia7 == null ? null : f.ganancia7 - ads };
  });

  const adsPorCategoria = new Map<string, number>();
  for (const f of porModelo) {
    const cat = f.categoria ?? "Sin categoría";
    adsPorCategoria.set(cat, (adsPorCategoria.get(cat) ?? 0) + (f.publicidad7 ?? 0));
  }
  const porCategoria: FilaCategoria[] = m.porCategoria.map((c) => {
    const ads = adsPorCategoria.get(c.categoria) ?? 0;
    return { ...c, publicidad7: ads, ganancia7: c.ganancia7 == null ? null : c.ganancia7 - ads };
  });

  return { ...m, porModelo, porCategoria };
}
