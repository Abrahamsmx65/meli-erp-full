import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { ConciliarMeli } from "@/components/conciliar-meli";

export const dynamic = "force-dynamic";

/**
 * Conciliación de MELI contra el reporte de Ventas de Mercado Libre: la
 * prueba de que el neto por venta del ERP (pago real de Mercado Pago) es el
 * que MELI dice, al centavo.
 */
export default async function ConciliarMeliPagina() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Mercado Libre no está conectado</h1>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">Conciliar Mercado Libre</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Sube el reporte de Ventas de Mercado Libre de un mes y se cruza, venta por venta, contra lo que el ERP guardó del pago real de Mercado Pago: ingresos, cargo por
          venta e impuestos, envíos, anulaciones y el total que MELI te deja. Nada se estima ni se ajusta: lo que no cuadra se enseña con su monto.
        </p>
      </div>
      <ConciliarMeli />
    </div>
  );
}
