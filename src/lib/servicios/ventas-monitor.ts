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
  subiendo: Movimiento[];
  bajando: Movimiento[];
}

/** Fecha local de México (las ventas se guardan con el huso de MELI). */
function fechaMx(desplazamientoDias = 0): string {
  return new Date(Date.now() - 6 * 3_600_000 - desplazamientoDias * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export async function cargarMonitor(db: DB, accountId: string): Promise<Monitor> {
  const hoy = fechaMx(0);
  const ayer = fechaMx(1);
  const inicioSemana = fechaMx(6);
  const inicioPrev = fechaMx(13);

  const [ventas, skus, stock, snapshots] = await Promise.all([
    traerTodo<any>(db, "ventas_diarias", "sku, fecha, unidades, ordenes, importe", (q) =>
      q.eq("account_id", accountId).gte("fecha", inicioPrev),
    ),
    traerTodo<any>(db, "skus", "sku, modelo, color", (q) =>
      q.eq("account_id", accountId).eq("activo", true),
    ),
    traerTodo<any>(db, "stock_full", "sku, disponible, en_transferencia", (q) =>
      q.eq("account_id", accountId),
    ),
    traerTodo<any>(db, "stock_snapshots", "sku, fecha, disponible", (q) =>
      q.eq("account_id", accountId).gte("fecha", inicioPrev),
    ),
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
  const productos = new Map<string, { modelo: string; color: string; d7: number; prev7: number }>();

  for (const v of ventas) {
    const { modelo, color } = partes(v.sku);
    const m =
      modelos.get(modelo) ??
      { unidades7: 0, unidades7Prev: 0, importe7: 0, unidadesHoy: 0, colores: new Set<string>() };
    const claveProd = `${modelo}|${color}`;
    const pr = productos.get(claveProd) ?? { modelo, color, d7: 0, prev7: 0 };

    if (v.fecha >= inicioSemana) {
      m.unidades7 += v.unidades ?? 0;
      m.importe7 += v.importe ?? 0;
      pr.d7 += v.unidades ?? 0;
      if (v.fecha === hoy) m.unidadesHoy += v.unidades ?? 0;
    } else {
      m.unidades7Prev += v.unidades ?? 0;
      pr.prev7 += v.unidades ?? 0;
    }
    if (color) m.colores.add(color);
    modelos.set(modelo, m);
    productos.set(claveProd, pr);
  }

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
    }))
    .sort((a, b) => b.unidades7 - a.unidades7)
    .slice(0, 150);

  return {
    hoy: resumen(hoy, hoy),
    ayer: resumen(ayer, ayer),
    semana: resumen(inicioSemana, hoy),
    porModelo,
    subiendo,
    bajando,
  };
}
