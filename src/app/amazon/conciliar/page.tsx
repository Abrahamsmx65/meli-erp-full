import { clienteServidor } from "@/lib/supabase/server";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { ConciliarAmazon } from "@/components/conciliar-amazon";

export const dynamic = "force-dynamic";

/**
 * Conciliación del dinero de Amazon contra el reporte de transacciones de
 * Seller Central: la prueba de que lo que el ERP tiene por pedido es lo que
 * Amazon dice, al centavo.
 */
export default async function ConciliarAmazonPagina() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaAmazon(supabase);
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Amazon no está conectado</h1>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">Conciliar Amazon</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Sube el reporte de transacciones de Seller Central de un mes y se cruza contra los eventos de la Finances API que el ERP guardó para ese mismo rango: total,
          tipo por tipo y orden por orden. Nada se estima ni se ajusta: lo que no cuadra se enseña con su monto.
        </p>
      </div>
      <ConciliarAmazon />
    </div>
  );
}
