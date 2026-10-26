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
  /** cuántos pares descontar; sin cantidad se retira TODO lo disponible */
  cantidad?: number | null;
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
  /** por SKU: cuánto se retira, cuánto se queda apartado en pedidos y cuánto se pidió de más (topado al disponible) */
  detalle: { sku: string; retirados: number; apartados: number; recortados?: number }[];
  /** SKU que no tenían nada disponible que retirar */
  sinDisponible: string[];
}

export const MOTIVO_RETIRO = "Retirado del almacén TikTok a mano";
/** el mismo retiro pero por una cantidad tecleada (dueño, 22-oct-2026: «una barra en la que se pone una cantidad y descuenta las piezas») */
export const MOTIVO_DESCUENTO = "Descontado del almacén TikTok a mano";

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
    // Con cantidad se descuentan esos pares, topados a lo disponible: lo
    // apartado en pedidos pagados nunca se toca. Sin cantidad, todo.
    const pedida = s.cantidad == null ? null : Math.max(0, Math.round(Number(s.cantidad)));
    if (pedida === 0 || (pedida != null && !Number.isFinite(pedida))) continue;
    const retirados = pedida == null ? disponible : Math.min(pedida, disponible);
    const recortados = pedida == null ? 0 : pedida - retirados;
    const motivo = pedida == null ? MOTIVO_RETIRO : `${MOTIVO_DESCUENTO} (${pedida} pares)`;
    plan.movimientos.push({ sku, tipo: "salida", cantidad: retirados, referencia, motivo, fecha });
    plan.salidas3pl.push({ orderId: referencia, sku, pares: retirados });
    plan.detalle.push({ sku, retirados, apartados: apartado, ...(recortados > 0 ? { recortados } : {}) });
  }
  return plan;
}
