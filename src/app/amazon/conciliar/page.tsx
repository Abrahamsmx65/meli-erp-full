import { clienteServidor } from "@/lib/supabase/server";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { ConciliarAmazon } from "@/components/conciliar-amazon";
import { Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/**
 * Conciliación del dinero de Amazon contra el reporte de transacciones de
 * Seller Central: la prueba de que lo que el ERP tiene por pedido es lo que
 * Amazon dice, al centavo.
 */
export default async function ConciliarAmazonPagina() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaAmazon(supabase);
  if (!cuenta) return <SinCuenta titulo="Conciliar Amazon" servicio="amazon" />;
  return (
    <Pagina>
      <Encabezado
        ceja="Amazon"
        titulo="Conciliar Amazon"
        descripcion="El reporte de transacciones de Seller Central contra los eventos de la Finances API guardados."
        ayuda={
          <p>
            Sube el reporte de transacciones de Seller Central de un mes y se cruza contra los eventos de la Finances API que el ERP guardó para ese mismo rango: total,
            tipo por tipo y orden por orden. Nada se estima ni se ajusta: lo que no cuadra se enseña con su monto.
          </p>
        }
      />
      <ConciliarAmazon />
    </Pagina>
  );
}
