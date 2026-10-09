import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { ConciliarMeli } from "@/components/conciliar-meli";
import { Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/**
 * Conciliación de MELI contra el reporte de Ventas de Mercado Libre: la
 * prueba de que el neto por venta del ERP (pago real de Mercado Pago) es el
 * que MELI dice, al centavo.
 */
export default async function ConciliarMeliPagina() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Conciliar Mercado Libre" />;
  return (
    <Pagina>
      <Encabezado
        ceja="Mercado Libre"
        titulo="Conciliar Mercado Libre"
        descripcion="Sube el reporte de Ventas de un mes y se cruza, venta por venta, contra el pago real guardado."
        ayuda={
          <p>
            Se comparan ingresos, cargo por venta e impuestos, envíos, anulaciones y el total que MELI te deja. Nada se
            estima ni se ajusta: lo que no cuadra se enseña con su monto.
          </p>
        }
      />
      <ConciliarMeli />
    </Pagina>
  );
}
