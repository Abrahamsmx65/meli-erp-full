/**
 * Corridas: qué tallas trae cada caja.
 *
 * Es la pieza más chica del sistema y la que más lo detiene. Sin corrida, una
 * caja en bodega es una caja opaca: se sabe que existe pero no qué hay
 * adentro, así que el planeador no la puede mandar a Full aunque tenga
 * exactamente lo que falta.
 *
 * Desde que los pedidos se cargan con su proforma esto se llena solo. Lo que
 * queda aquí es ver lo que hay y tapar los huecos viejos.
 */
import { traerTodo, type DB } from "../datos/repos";

export interface CorridaVista {
  pedido: string;
  modelo: string;
  color: string;
  tallas: Record<string, number>;
  total: number;
  origen: string;
  actualizadoEn: string | null;
  /** cajas en bodega que usan esta corrida */
  cajasEnBodega: number;
  paresEnBodega: number;
  almacenes: string[];
}

export interface HuecoCorrida {
  pedido: string;
  modelo: string;
  color: string;
  cajas: number;
  almacenes: string[];
  /** tallas que el reporte de existencias menciona para este modelo+color */
  tallasVistas: string[];
  paresPorCaja: number;
}

export interface ResumenCorridas {
  corridas: CorridaVista[];
  huecos: HuecoCorrida[];
  tallas: string[];
  totales: {
    corridas: number;
    porProforma: number;
    manuales: number;
    cajasCubiertas: number;
    cajasOpacas: number;
  };
}

function k(pedido: string, modelo: string, color: string): string {
  return `${pedido}|${modelo}|${color}`.toUpperCase();
}

export async function cargarCorridas(db: DB, accountId: string): Promise<ResumenCorridas> {
  const eq = (q: any) => q.eq("account_id", accountId);

  const [corridasRaw, existRaw] = await Promise.all([
    traerTodo<any>(db, "corridas", "pedido, modelo, color, tallas, total, origen, actualizado_en", eq),
    traerTodo<any>(
      db,
      "existencias",
      "almacen, pedido, modelo, color, talla, cajas_disponibles, pares_por_caja",
      eq,
    ),
  ]);

  // Cuántas cajas físicas cuelgan de cada corrida. Una corrida sin cajas no
  // está mal, solo ya no aplica: el pedido se acabó.
  const uso = new Map<string, { cajas: number; pares: number; almacenes: Set<string> }>();
  // Y lo contrario: cajas cuyo pedido+modelo+color no tiene corrida.
  const sinCorrida = new Map<
    string,
    { pedido: string; modelo: string; color: string; cajas: number; almacenes: Set<string>; tallas: Set<string>; paresPorCaja: number }
  >();

  const existeCorrida = new Set(corridasRaw.map((c) => k(c.pedido ?? "", c.modelo ?? "", c.color ?? "")));

  for (const e of existRaw) {
    const cajas = e.cajas_disponibles ?? 0;
    if (cajas <= 0) continue;

    const clave = k(e.pedido ?? "", e.modelo ?? "", e.color ?? "");

    if (existeCorrida.has(clave)) {
      const u = uso.get(clave) ?? { cajas: 0, pares: 0, almacenes: new Set<string>() };
      u.cajas += cajas;
      u.pares += cajas * (e.pares_por_caja ?? 0);
      u.almacenes.add(e.almacen);
      uso.set(clave, u);
    } else {
      // Una fila con talla propia no necesita corrida: la caja es de una sola
      // talla y ya se sabe qué trae.
      const esCorrida = !e.talla || /CORRIDA/i.test(String(e.talla));
      if (!esCorrida) continue;

      const h =
        sinCorrida.get(clave) ??
        {
          pedido: e.pedido ?? "",
          modelo: e.modelo ?? "",
          color: e.color ?? "",
          cajas: 0,
          almacenes: new Set<string>(),
          tallas: new Set<string>(),
          paresPorCaja: e.pares_por_caja ?? 0,
        };
      h.cajas += cajas;
      h.almacenes.add(e.almacen);
      if (e.talla) h.tallas.add(String(e.talla));
      sinCorrida.set(clave, h);
    }
  }

  const corridas: CorridaVista[] = corridasRaw.map((c) => {
    const u = uso.get(k(c.pedido ?? "", c.modelo ?? "", c.color ?? ""));
    return {
      pedido: c.pedido ?? "",
      modelo: c.modelo ?? "",
      color: c.color ?? "",
      tallas: c.tallas ?? {},
      total: c.total ?? 0,
      origen: c.origen ?? "manual",
      actualizadoEn: c.actualizado_en ?? null,
      cajasEnBodega: u?.cajas ?? 0,
      paresEnBodega: u?.pares ?? 0,
      almacenes: [...(u?.almacenes ?? [])].sort(),
    };
  });

  // Las que sí están sirviendo para algo, primero.
  corridas.sort((a, b) => {
    if (a.cajasEnBodega !== b.cajasEnBodega) return b.cajasEnBodega - a.cajasEnBodega;
    return a.modelo.localeCompare(b.modelo);
  });

  const huecos: HuecoCorrida[] = [...sinCorrida.values()]
    .map((h) => ({
      pedido: h.pedido,
      modelo: h.modelo,
      color: h.color,
      cajas: h.cajas,
      almacenes: [...h.almacenes].sort(),
      tallasVistas: [...h.tallas].sort(),
      paresPorCaja: h.paresPorCaja,
    }))
    .sort((a, b) => b.cajas - a.cajas);

  // El universo de tallas que existe, para armar las columnas de la tabla.
  const tallas = new Set<string>();
  for (const c of corridas) for (const t of Object.keys(c.tallas)) tallas.add(t);

  return {
    corridas,
    huecos,
    tallas: [...tallas].sort((a, b) => Number(a) - Number(b)),
    totales: {
      corridas: corridas.length,
      porProforma: corridas.filter((c) => c.origen === "proforma").length,
      manuales: corridas.filter((c) => c.origen !== "proforma").length,
      cajasCubiertas: corridas.reduce((a, c) => a + c.cajasEnBodega, 0),
      cajasOpacas: huecos.reduce((a, h) => a + h.cajas, 0),
    },
  };
}
