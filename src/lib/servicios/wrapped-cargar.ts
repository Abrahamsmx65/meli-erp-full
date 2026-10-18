/**
 * Carga el GETAC Wrapped de un ejercicio y lo deja masticado en `app_cache`
 * (`wrapped:v1:{ejercicio}`, 6 h): son doce estados guardados más la venta
 * por día y hora de los cuatro canales en todo el año. Solo se calcula en el
 * clic la primera vez; después la pantalla lee un renglón.
 */
import { clienteAdmin } from "../supabase/admin";
import type { Cuenta, DB } from "../datos/repos";
import { cuentaActiva as cuentaFundas } from "../yapanizcel/cuenta";
import { rangoEjercicio } from "../finanzas/cuenta";
import { cuentaAmazon } from "./amazon";
import { leerAnio, PRIMER_PERIODO_CORTES } from "./consolidado-cargar";
import { servirConCacheApp } from "./cache-app";
import { servirVariosCanales } from "./ventas-tiempo";
import { fechaMx } from "./ventas-monitor";
import { armarWrapped, type Wrapped } from "./wrapped";

const EDAD_MAX_MS = 6 * 3_600_000;

export async function cargarWrapped(
  db: DB,
  cuenta: Cuenta,
  ejercicio: number,
): Promise<{ datos: Wrapped; generadoEn: string | null }> {
  // Las cuentas se verifican con la sesión; lo pesado va con el cliente admin.
  const [amz, yz] = await Promise.all([cuentaAmazon(db).catch(() => null), cuentaFundas(db).catch(() => null)]);
  const admin = clienteAdmin();
  const r = await servirConCacheApp(admin, cuenta.id, `wrapped:v1:${ejercicio}`, EDAD_MAX_MS, async () => {
    const rango = rangoEjercicio(ejercicio);
    const primero = `${PRIMER_PERIODO_CORTES}-01`;
    const desde = rango.desde < primero ? primero : rango.desde;
    const hoy = fechaMx(0);
    const hasta = rango.hasta < hoy ? rango.hasta : hoy;
    const [anio, series] = await Promise.all([
      leerAnio(admin, cuenta, ejercicio),
      servirVariosCanales(
        admin,
        [
          { canal: "meli_calzado", accountId: cuenta.id },
          { canal: "amazon", accountId: amz?.id },
          { canal: "meli_fundas", accountId: yz?.id },
          { canal: "tiktok", accountId: cuenta.id },
        ],
        { desde, hasta },
      ),
    ]);
    return armarWrapped(anio, series, desde, hasta);
  });
  return { datos: r.datos, generadoEn: r.generadoEn };
}
