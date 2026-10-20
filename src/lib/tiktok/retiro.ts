/**
 * RETIRAR un SKU del almacén de TikTok: lo que está DISPONIBLE (saldo menos
 * lo apartado en pedidos) sale del kardex, se le avisa a Industher como una
 * salida más (para que descuente la caja de la bodega TikTok) y a TikTok
 * se le publica el cero. Puro: decide los movimientos; el servicio los
 * escribe.
 *
 * Dueño, 20-oct-2026: «una opción de poder quitar inventario en TikTok: en
 * la sección de inventario elijo algún SKU y se pone en 0 en TikTok, en mi
 * kardex y en Industher».
 *
 * Lo APARTADO no se toca: son pares de pedidos ya pagados que el corte va a
 * despachar; quitarlos del kardex haría que la defensa cancelara esos
 * pedidos. El retiro se declara con cuántos quedan apartados.
 */
export interface SkuARetirar {
  sku: string;
  saldo: number;
  apartado: number;
}

export interface MovimientoRetiro {
  sku: string;
  tipo: "salida";
  cantidad: number;
  referencia: string;
  motivo: string;
  fecha: string;
}

export interface SalidaRetiro {
  orderId: string;
  sku: string;
  pares: number;
}

export interface PlanRetiro {
  /** la referencia común del retiro, para el kardex y para Industher */
  referencia: string;
  movimientos: MovimientoRetiro[];
  salidas3pl: SalidaRetiro[];
  /** por SKU: cuánto se retira y cuánto se queda apartado en pedidos */
  detalle: { sku: string; retirados: number; apartados: number }[];
  /** SKU que no tenían nada disponible que retirar */
  sinDisponible: string[];
}

export const MOTIVO_RETIRO = "Retirado del almacén TikTok a mano";

/** `RETIRO-20261020T143512` : única por clic, legible en Industher y en el kardex. */
export function referenciaDeRetiro(fecha: string): string {
  return `RETIRO-${fecha.replace(/[-:]/g, "").slice(0, 15)}`;
}

export function planRetiro(skus: SkuARetirar[], fecha: string): PlanRetiro {
  const referencia = referenciaDeRetiro(fecha);
  const plan: PlanRetiro = { referencia, movimientos: [], salidas3pl: [], detalle: [], sinDisponible: [] };
  const vistos = new Set<string>();
  for (const s of skus) {
    const sku = s.sku.trim();
    if (!sku || vistos.has(sku)) continue;
    vistos.add(sku);
    const apartado = Math.max(0, Math.round(s.apartado));
    const disponible = Math.max(0, Math.round(s.saldo) - apartado);
    if (disponible <= 0) {
      plan.sinDisponible.push(sku);
      continue;
    }
    plan.movimientos.push({ sku, tipo: "salida", cantidad: disponible, referencia, motivo: MOTIVO_RETIRO, fecha });
    plan.salidas3pl.push({ orderId: referencia, sku, pares: disponible });
    plan.detalle.push({ sku, retirados: disponible, apartados: apartado });
  }
  return plan;
}
