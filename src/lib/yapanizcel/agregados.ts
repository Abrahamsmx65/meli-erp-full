/**
 * Ventas y fotos de stock ya SUMADAS en la base (migración 0045).
 *
 * El motor del plan (`plan.ts`) trabaja con renglones por día porque así se
 * prueba con datos sintéticos; pero traer 126 mil renglones a la página la
 * tumbaba. Aquí se pide a la base lo sumado por SKU y por bloque (última
 * semana, la anterior, el resto) y se le entregan al motor renglones
 * EQUIVALENTES: un bloque con U unidades en D días con venta se vuelve D
 * renglones de U/D dentro del bloque. Las sumas por bloque y el conteo de
 * días con venta —que es todo lo que el motor mira— quedan idénticos.
 */
import type { DB } from "../datos/repos";
import { bloques, type SnapshotDia, type VentaDia } from "./plan";
import { restarDias } from "./db";

interface FilaVentas {
  sku: string;
  u_total: number;
  u1: number | null;
  u2: number | null;
  u3: number | null;
  d1: number;
  d2: number;
  d3: number;
}

interface FilaFotos {
  sku: string;
  f1: number;
  f2: number;
  f3: number;
  s1: number;
  s2: number;
  s3: number;
}

async function rpcTodo<T>(db: DB, fn: string, args: Record<string, unknown>): Promise<T[]> {
  // Las funciones devuelven una fila por SKU: caben en pocas páginas.
  const out: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await db.rpc(fn, args).range(desde, desde + 999);
    if (error) throw new Error(`${fn}: ${error.message}`);
    const lote = (data ?? []) as T[];
    out.push(...lote);
    if (lote.length < 1000) break;
  }
  return out;
}

export interface VentasAgregadas {
  ventas: VentaDia[];
  snapshots: SnapshotDia[];
  /** unidades vendidas en toda la ventana, por SKU */
  totales: Map<string, number>;
}

export async function cargarVentasAgregadas(db: DB, accountId: string, desde: string, hasta: string): Promise<VentasAgregadas> {
  const bs = bloques(desde, hasta);
  const b1 = bs[0]?.desde ?? desde;
  const b2 = bs[1]?.desde ?? desde;
  const args = { p_account: accountId, p_desde: desde, p_hasta: hasta, p_b1: b1, p_b2: b2 };

  const [ventasFilas, fotosFilas] = await Promise.all([
    rpcTodo<FilaVentas>(db, "yz_ventas_bloques", args),
    rpcTodo<FilaFotos>(db, "yz_snapshots_bloques", args),
  ]);

  const ventas: VentaDia[] = [];
  const totales = new Map<string, number>();
  for (const f of ventasFilas) {
    totales.set(f.sku, Number(f.u_total ?? 0));
    const porBloque: [number, number][] = [
      [Number(f.u1 ?? 0), f.d1],
      [Number(f.u2 ?? 0), f.d2],
      [Number(f.u3 ?? 0), f.d3],
    ];
    porBloque.forEach(([u, d], i) => {
      const b = bs[i];
      if (!b || u <= 0) return;
      const dias = Math.max(1, d);
      for (let k = 0; k < dias; k++) ventas.push({ sku: f.sku, fecha: restarDias(b.hasta, k), unidades: u / dias });
    });
  }

  // Fotos: por bloque, S días con stock (disponible 1) y F−S sin stock (0).
  const snapshots: SnapshotDia[] = [];
  for (const f of fotosFilas) {
    const porBloque: [number, number][] = [
      [f.f1, f.s1],
      [f.f2, f.s2],
      [f.f3, f.s3],
    ];
    porBloque.forEach(([fotos, conStock], i) => {
      const b = bs[i];
      if (!b || fotos <= 0) return;
      for (let k = 0; k < fotos; k++) {
        snapshots.push({ sku: f.sku, fecha: restarDias(b.hasta, k), disponible: k < conStock ? 1 : 0 });
      }
    });
  }

  return { ventas, snapshots, totales };
}
