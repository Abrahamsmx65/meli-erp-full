/**
 * Lo ÚNICO que importan las pantallas: `leerFinanzasMeli`.
 *
 * Sirve el renglón guardado en `app_cache` aunque esté viejo —declarando su
 * edad en `generadoEn`— y lo refresca en el fondo cuando le toca, con la
 * misma política que los cortes: el mes corriente cada 10 minutos, un mes
 * cerrado casi congelado. Solo sin renglón (la primera vez) se calcula en el
 * clic. Una pantalla nunca hace cuentas de dinero: pide esto y pinta.
 */
import { guardarCacheApp, leerCacheAppGuardado } from "../cache-app";
import { obtenerConCachePorPeriodo } from "../corte-cache";
import { masticarFinanzasMeli } from "./masticar";
import type { FinanzasPeriodo } from "./tipos";
import type { DB } from "../../datos/repos";

/**
 * La clave lleva el rango completo: cada combinación de fechas que el dueño
 * mira es su propio renglón. El prefijo permite tumbarlas todas de un golpe
 * con `invalidarApp(…, "finanzas:")` cuando cambia algo que las mueve.
 */
export const claveFinanzas = (desde: string, hasta: string): string => `finanzas:meli:${desde}_${hasta}`;

export async function leerFinanzasMeli(
  db: DB,
  accountId: string,
  rango: { desde: string; hasta: string },
): Promise<FinanzasPeriodo> {
  const clave = claveFinanzas(rango.desde, rango.hasta);
  // La política de refresco se decide por el mes del FINAL del rango: si el
  // rango toca el mes corriente, se refresca seguido; si cerró, casi nunca.
  const periodo = rango.hasta.slice(0, 7);
  return obtenerConCachePorPeriodo<FinanzasPeriodo>({
    periodo,
    leer: () => leerCacheAppGuardado<FinanzasPeriodo>(db, accountId, clave),
    guardar: (datos, ms) => guardarCacheApp(db, accountId, clave, datos, ms),
    calcular: () => masticarFinanzasMeli(db, accountId, rango),
  });
}

