/**
 * La vista de Bodega, ya masticada.
 *
 * Regla del dueño: la pantalla no calcula, solo presenta. Aquí se junta todo
 * lo que /inventario necesita —cifras de cabecera, inversión por categoría,
 * familias y los renglones de la tabla— en UN objeto, y la página se limita a
 * acomodarlo. Si algún día otra pantalla quiere las mismas cifras, pide esta
 * misma función y no hay dos versiones del mismo número.
 *
 * El inventario viene de `inventario_cache` (masticado por el latido). El
 * costo se cruza AQUÍ y no se guarda en esa fila a propósito: los costos se
 * editan a mano en Productos y costos, y una copia guardada quedaría vieja al
 * primer cambio sin que nadie se entere.
 */
import { cargarInventario, familiasMexico, inversionPorCategoria } from "./inventario";
import { configPorProducto } from "./productos";
import type { FamiliaMexico, InversionEnBodega } from "./inventario";
import type { DB } from "../datos/repos";
import type { Cronometro } from "./cronometro";

/** Lo único que la tabla de Bodega pinta: 7 campos, no los 13 del motor. */
export interface RenglonBodega {
  sku: string;
  modelo: string;
  color: string;
  talla: string;
  enBodega: number;
  enCamino: number;
  pedidos: { pedido: string; almacen: string; cajas: number; pares: number }[];
}

export interface VistaBodega {
  fichas: {
    skus: number;
    cajas: number;
    paresEnBodega: number;
    paresEnCamino: number;
    valorEnBodega: number;
    valorEnCamino: number;
    /** Pares que no entran en el valor por no tener costo capturado. */
    paresSinCosto: number;
  };
  inversion: InversionEnBodega;
  familias: FamiliaMexico[];
  renglones: RenglonBodega[];
  almacenes: string[];
}

export async function vistaBodega(
  db: DB,
  accountId: string,
  reloj?: Cronometro,
): Promise<VistaBodega> {
  const medir = <T>(nombre: string, p: Promise<T>) => (reloj ? reloj.medir(nombre, p) : p);

  // sinCrudos: la fila de inventario_cache guarda también los SKUs y las
  // corridas completos (los usa Planificación China); esta vista no, y
  // bajarlos era su costo dominante.
  const [inv, config] = await Promise.all([
    medir("inventario", cargarInventario(db, accountId, { sinCrudos: true })),
    medir("config", configPorProducto(db, accountId)),
  ]);

  const inversion = inversionPorCategoria(inv.renglones, config);

  return {
    fichas: {
      skus: inv.renglones.filter((r) => r.enBodega + r.enCamino > 0).length,
      cajas: inv.porAlmacen.reduce((a, x) => a + x.cajas, 0),
      paresEnBodega: inv.totales.enBodega,
      paresEnCamino: inv.totales.enCamino,
      valorEnBodega: inversion.total.enBodega,
      valorEnCamino: inversion.total.enCamino,
      paresSinCosto: inversion.sinCosto.pares,
    },
    inversion,
    familias: familiasMexico(inv.renglones, inv.cajasPorModelo),
    renglones: inv.renglones.map((r) => ({
      sku: r.sku,
      modelo: r.modelo,
      color: r.color,
      talla: r.talla,
      enBodega: r.enBodega,
      enCamino: r.enCamino,
      pedidos: r.pedidos,
    })),
    almacenes: inv.porAlmacen.map((a) => a.almacen),
  };
}
