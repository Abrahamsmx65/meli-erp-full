/**
 * El "en camino" REAL hacia FBA, envío por envío.
 *
 * El reporte de inventario de Amazon solo trae totales por SKU
 * (afn-inbound-working/shipped/receiving) sin fechas: un envío que se quedó
 * atorado hace meses —sin procesar o "en tránsito" eterno— suma como si
 * fuera a llegar mañana, el plan cree que la talla ya viene y deja de
 * sugerir cajas (caso real: GT114-LT BROWN-26 con 0 disponibles, 30
 * fantasmas en camino y 70 cajas en bodega que el plan no pedía).
 *
 * La sincronización (amazon/sync.ts) baja los envíos entrantes del SP-API y
 * marca VIGENTE solo a los que tuvieron movimiento en los últimos
 * DIAS_VIGENCIA_ENVIO_FBA días; aquí se convierte ese detalle en el mapa
 * SKU→pares que el plan usa en lugar del total del reporte. Si nunca se ha
 * sincronizado (tabla vacía), se devuelve null y todo sigue con el reporte.
 */
import { traerTodo, type DB } from "../datos/repos";
import type { RenglonAmazon } from "./amazon";

/** Un envío sin ningún movimiento en estos días se da por perdido. */
export const DIAS_VIGENCIA_ENVIO_FBA = 20;

export interface FilaEnvioEntrante {
  shipment_id: string;
  seller_sku: string;
  nombre: string | null;
  estado: string;
  enviado: number;
  recibido: number;
  vigente: boolean;
}

export interface EnvioViejo {
  shipmentId: string;
  nombre: string | null;
  estado: string;
  /** pares que ese envío dice traer y nunca llegaron */
  pares: number;
}

export interface EnCaminoFba {
  /** SKU de Amazon → pares realmente en camino (solo envíos vigentes) */
  porSku: Map<string, number>;
  /** envíos ignorados por viejos, para enseñarlos y que el usuario los cierre */
  viejos: EnvioViejo[];
  paresViejos: number;
  enviosVigentes: number;
}

/** Lo que a un envío le falta por recibir. */
function pendiente(f: FilaEnvioEntrante): number {
  return Math.max(0, (f.enviado ?? 0) - (f.recibido ?? 0));
}

/**
 * Función pura: del detalle por envío al resumen que consume el plan.
 * Devuelve null con lista vacía = nunca se ha sincronizado, no hay opinión.
 */
export function resumirEnCamino(filas: FilaEnvioEntrante[]): EnCaminoFba | null {
  if (!filas.length) return null;

  const porSku = new Map<string, number>();
  const viejosPorEnvio = new Map<string, EnvioViejo>();
  const vigentes = new Set<string>();

  for (const f of filas) {
    const p = pendiente(f);
    if (f.vigente) {
      vigentes.add(f.shipment_id);
      if (p > 0) porSku.set(f.seller_sku, (porSku.get(f.seller_sku) ?? 0) + p);
    } else {
      const v = viejosPorEnvio.get(f.shipment_id) ?? {
        shipmentId: f.shipment_id,
        nombre: f.nombre ?? null,
        estado: f.estado,
        pares: 0,
      };
      v.pares += p;
      viejosPorEnvio.set(f.shipment_id, v);
    }
  }

  const viejos = [...viejosPorEnvio.values()].sort((a, b) => b.pares - a.pares);
  return {
    porSku,
    viejos,
    paresViejos: viejos.reduce((a, v) => a + v.pares, 0),
    enviosVigentes: vigentes.size,
  };
}

/** Lee el detalle sincronizado y lo resume. Null = aún no hay detalle. */
export async function enCaminoFba(db: DB, accountId: string): Promise<EnCaminoFba | null> {
  try {
    const filas = await traerTodo<FilaEnvioEntrante>(
      db,
      "amazon_envios_entrantes",
      "shipment_id, seller_sku, nombre, estado, enviado, recibido, vigente",
      (q) => q.eq("account_id", accountId),
    );
    return resumirEnCamino(filas);
  } catch {
    // Tabla nueva sin migrar o error de lectura: el reporte sigue mandando.
    return null;
  }
}

/**
 * Sustituye el "en camino" del reporte por el real. Sin detalle (null) los
 * renglones quedan tal cual: mejor el total del reporte que inventar ceros.
 */
export function aplicarEnCamino(
  renglones: RenglonAmazon[],
  enCamino: EnCaminoFba | null,
): RenglonAmazon[] {
  if (!enCamino) return renglones;
  return renglones.map((r) => {
    const camino = enCamino.porSku.get(r.sku) ?? 0;
    if (camino === r.enTransferencia) return r;
    return { ...r, enTransferencia: camino, totalFba: r.disponible + camino };
  });
}
