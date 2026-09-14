/**
 * Qué desfase entre el kardex y el estante merece despertar a alguien.
 *
 * El dato de los tres números por SKU ya existía en /tiktok/desfases, pero
 * una pantalla que nadie abre no sirve de nada: el GT102-GREY-25-MX estuvo
 * CUATRO DÍAS ofreciendo pares que la bodega no tenía y solo se supo cuando
 * un pedido no se pudo surtir. Esto decide, sin tocar la base, cuáles de
 * esas diferencias son peligrosas de verdad.
 *
 * Solo una dirección importa: el kardex ARRIBA del estante (se ofrece lo que
 * no hay) o el kardex en negativo (se vendió sin entrada). Cuando el kardex
 * va por DEBAJO solo se dejan de ofrecer pares que sí existen: cuesta ventas,
 * no pedidos, y eso va en un reporte, no en una alarma. El 14-sep-2026 los
 * 16 SKUs que no cuadraban eran todos de ese lado sano; si la alarma no
 * distinguiera, sonaría 16 veces al día y a la semana nadie la vería.
 */
export interface LecturaSku {
  sku: string;
  /** saldo del kardex */
  saldo: number;
  /** pares que reporta el 3PL; null = no lo reporta y no se puede juzgar */
  estante: number | null;
  /** salidas ya mandadas al 3PL que aún no confirma: el estante todavía las trae */
  salidasPendientes?: number;
}

export interface DesfasePeligroso {
  sku: string;
  kardex: number;
  estante: number | null;
  /** pares que el kardex tiene de más */
  deMas: number;
  motivo: string;
}

/**
 * Los desfases que sí cuestan dinero. `salidasPendientes` se suma al kardex
 * porque son pares que ya salieron de nuestra cuenta pero que el 3PL todavía
 * no descuenta del suyo: sin eso, cada corte dispararía la alarma.
 */
export function desfasesPeligrosos(lecturas: LecturaSku[]): DesfasePeligroso[] {
  const salida: DesfasePeligroso[] = [];
  for (const l of lecturas ?? []) {
    if (l.saldo < 0) {
      salida.push({
        sku: l.sku,
        kardex: l.saldo,
        estante: l.estante,
        deMas: -l.saldo,
        motivo: "El kardex está en negativo: se vendió sin que hubiera entrada.",
      });
      continue;
    }
    if (l.estante == null) continue;
    const esperado = l.saldo + (l.salidasPendientes ?? 0);
    if (esperado <= l.estante) continue;
    salida.push({
      sku: l.sku,
      kardex: l.saldo,
      estante: l.estante,
      deMas: esperado - l.estante,
      motivo: `El kardex trae ${esperado} y la bodega reporta ${l.estante}: se están ofreciendo ${esperado - l.estante} pares que no existen.`,
    });
  }
  return salida.sort((a, b) => b.deMas - a.deMas || a.sku.localeCompare(b.sku, "es"));
}

/**
 * A quién se le avisa YA. Un desfase recién nacido casi siempre es un
 * parpadeo entre la foto del 3PL y el kardex, y se arregla solo en la
 * siguiente corrida; solo el que AGUANTA es un problema de verdad. Y se
 * avisa una sola vez por SKU: la alarma que se repite deja de leerse.
 */
export const HORAS_PARA_AVISAR = 6;

export function cualesAvisar<T extends { sku: string; desde: string; avisadoEn: string | null }>(
  abiertos: T[],
  ahora: Date = new Date(),
): T[] {
  const limite = ahora.getTime() - HORAS_PARA_AVISAR * 3_600_000;
  return abiertos.filter((d) => !d.avisadoEn && Date.parse(d.desde) <= limite);
}
