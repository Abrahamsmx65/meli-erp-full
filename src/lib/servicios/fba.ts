import type { RenglonAmazon } from "./amazon";

/** Días de venta que el stock en FBA debe cubrir. */
export const OBJETIVO_DIAS_FBA = 30;

/** Con menos de esto de cobertura, el envío ya es urgente. */
export const URGENTE_DIAS_FBA = 14;

export interface SugerenciaFba {
  sku: string;
  asin: string | null;
  titulo: string | null;
  /** unidades vendidas en el periodo */
  unidades: number;
  ventaDiaria: number;
  disponible: number;
  enTransferencia: number;
  cobertura: number | null;
  sugerido: number;
}

/**
 * Qué mandar a FBA.
 *
 * La misma lógica que los envíos a Full, en su versión simple: al ritmo de
 * venta del periodo, ¿cuántos pares hacen falta para cubrir el objetivo de
 * días? Lo que ya está en FBA y lo que va en camino cuenta a favor; lo que
 * falte es lo que hay que mandar. Se calcula sobre los renglones que la
 * página ya trae — no cuesta ninguna consulta extra.
 */
export function sugerirEnvioFba(
  renglones: RenglonAmazon[],
  dias: number,
  objetivoDias = OBJETIVO_DIAS_FBA,
): SugerenciaFba[] {
  return renglones
    .filter((r) => r.unidades > 0)
    .map((r) => {
      const ventaDiaria = r.unidades / dias;
      const posicion = r.disponible + r.enTransferencia;
      return {
        sku: r.sku,
        asin: r.asin,
        titulo: r.titulo,
        unidades: r.unidades,
        ventaDiaria,
        disponible: r.disponible,
        enTransferencia: r.enTransferencia,
        cobertura: r.cobertura,
        sugerido: Math.max(0, Math.ceil(ventaDiaria * objetivoDias - posicion)),
      };
    })
    .filter((s) => s.sugerido > 0)
    .sort((a, b) => (a.cobertura ?? 0) - (b.cobertura ?? 0));
}
