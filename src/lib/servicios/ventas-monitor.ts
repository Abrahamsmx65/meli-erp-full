/**
 * Monitor de ventas de Mercado Libre.
 *
 * Tres preguntas, en orden de urgencia: ¿cómo va HOY?, ¿qué está subiendo y
 * qué está bajando esta semana?, y ¿por qué? La comparación es semana contra
 * semana anterior a nivel producto (modelo + color, todas las tallas juntas),
 * porque así se piensa el negocio: "el MY2307 negro" y no talla por talla.
 *
 * La razón de una caída se busca primero en el stock — la causa más común de
 * "vender menos" es no tener qué vender — y solo si el stock no explica nada
 * se atribuye a la demanda.
 */
import { traerTodo, type DB } from "../datos/repos";
import { configPorProducto } from "./productos";

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
  /** neto - costo, solo de los colores con costo capturado; null = sin costo */
  ganancia7: number | null;
}

export interface FilaCategoria {
  categoria: string;
  unidades7: number;
  importe7: number;
  neto7: number;
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

export async function cargarMonitor(db: DB, accountId: string, rango?: RangoFechas): Promise<Monitor> {
  const hoy = fechaMx(0);
  const ayer = fechaMx(1);
  const r = rango ?? normalizarRango();
  const inicioSemana = r.desde;
  const finRango = r.hasta;
  const previo = rangoPrevio(r);
  const inicioPrev = previo.desde;

  // Las columnas `comision` y `neto` pueden no existir todavía (migraciones
  // 0011 y 0012): se pide con ellas y se degrada en cascada si la base aún
  // no las conoce.
  const leerVentas = async (): Promise<any[]> => {
    const filtro = (q: any) => q.eq("account_id", accountId).gte("fecha", inicioPrev);
    try {
      return await traerTodo<any>(
        db,
        "ventas_diarias",
        "sku, fecha, unidades, ordenes, importe, comision, neto",
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

  const [ventas, skus, stock, snapshots, config] = await Promise.all([
    leerVentas(),
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
    for (const v of ventas) {
      if (v.fecha < desde || v.fecha > hasta) continue;
      unidades += v.unidades ?? 0;
      importe += v.importe ?? 0;
      ordenes += v.ordenes ?? 0;
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

  for (const v of ventas) {
    const { modelo, color } = partes(v.sku);
    const m =
      modelos.get(modelo) ??
      { unidades7: 0, unidades7Prev: 0, importe7: 0, unidadesHoy: 0, colores: new Set<string>() };
    const claveProd = `${modelo}|${color}`;
    const pr =
      productos.get(claveProd) ??
      { modelo, color, d7: 0, prev7: 0, importe7: 0, neto7: 0 };

    if (v.fecha >= inicioSemana && v.fecha <= finRango) {
      m.unidades7 += v.unidades ?? 0;
      m.importe7 += v.importe ?? 0;
      pr.d7 += v.unidades ?? 0;
      pr.importe7 += v.importe ?? 0;
      // El neto REAL depositado por MELI cuando ya se conoce (incluye
      // comisión, envío y retenciones); si no, la mejor aproximación:
      // importe menos la comisión.
      pr.neto7 +=
        v.neto != null ? Number(v.neto) : (v.importe ?? 0) - (v.comision ?? 0);
      if (v.fecha === hoy) m.unidadesHoy += v.unidades ?? 0;
    } else if (v.fecha >= inicioPrev && v.fecha <= previo.hasta) {
      m.unidades7Prev += v.unidades ?? 0;
      pr.prev7 += v.unidades ?? 0;
    }
    if (color) m.colores.add(color);
    modelos.set(modelo, m);
    productos.set(claveProd, pr);
  }

  // --- Ganancia y categorías (con lo capturado en Productos y costos) ------
  // Ganancia = (importe - comisión de MELI) - costo × unidades. Solo se
  // calcula donde hay costo capturado; el resto se reporta como cobertura.
  const gananciaPorModelo = new Map<string, number>();
  const modeloConCosto = new Set<string>();
  const categorias = new Map<string, { unidades7: number; importe7: number; neto7: number; ganancia7: number; conCosto: boolean }>();
  let ganancia7 = 0;
  let unidadesConCosto = 0;
  let unidadesSemanaTotal = 0;

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

    if (cfg?.costo != null && pr.d7 > 0) {
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
      ganancia7: c.conCosto ? c.ganancia7 : null,
    }))
    .sort((a, b) => b.unidades7 - a.unidades7);

  // --- Razones: qué dice el stock de cada producto -------------------------
  // Tallas agotadas hoy, y tallas que estuvieron agotadas algún día de la
  // semana según las fotos diarias.
  const tallasDe = new Map<string, string[]>();
  for (const s of skus) {
    const clave = `${s.modelo}|${s.color ?? ""}`;
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

  const movimientos = [...productos.values()]
    .filter((p) => p.d7 + p.prev7 >= 10) // sin volumen no hay tendencia que leer
    .map((p) => ({
      producto: `${p.modelo} ${p.color}`.trim(),
      modelo: p.modelo,
      color: p.color,
      antes: p.prev7,
      ahora: p.d7,
      delta: p.d7 - p.prev7,
      razon: "",
    }));

  const subiendo = movimientos
    .filter((m) => m.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 8)
    .map((m) => ({ ...m, razon: razonDe(`${m.modelo}|${m.color}`, true) }));

  const bajando = movimientos
    .filter((m) => m.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 8)
    .map((m) => ({ ...m, razon: razonDe(`${m.modelo}|${m.color}`, false) }));

  const porModelo: FilaModelo[] = [...modelos.entries()]
    .map(([modelo, m]) => ({
      modelo,
      unidades7: m.unidades7,
      unidades7Prev: m.unidades7Prev,
      importe7: m.importe7,
      unidadesHoy: m.unidadesHoy,
      colores: m.colores.size,
      ganancia7: modeloConCosto.has(modelo) ? (gananciaPorModelo.get(modelo) ?? 0) : null,
    }))
    .sort((a, b) => b.unidades7 - a.unidades7)
    .slice(0, 150);

  return {
    hoy: resumen(hoy, hoy),
    ayer: resumen(ayer, ayer),
    semana: resumen(inicioSemana, finRango),
    porModelo,
    porCategoria,
    subiendo,
    bajando,
    ganancia7,
    coberturaCosto: unidadesSemanaTotal > 0 ? unidadesConCosto / unidadesSemanaTotal : 0,
  };
}
