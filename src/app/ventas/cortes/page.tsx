import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarEstadoResultados, listarCortes, periodoActual, validarPeriodo } from "@/lib/servicios/corte-meli";
import { CorteVista } from "@/components/corte-vista";

export const dynamic = "force-dynamic";

/**
 * Cortes mensuales de Mercado Libre: el estado de resultados del mes, exacto
 * al centavo, con devoluciones, cancelaciones, publicidad y gastos de Full.
 */
export default async function Cortes({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const sp = await searchParams;
  const periodo = validarPeriodo(sp.mes) ?? periodoActual();

  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Conecta Mercado Libre</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          Los cortes salen de tu cuenta de Mercado Libre; primero hay que conectarla en Ajustes.
        </p>
      </div>
    );
  }

  const [e, cortes] = await Promise.all([cargarEstadoResultados(supabase, cuenta, periodo), listarCortes(supabase, cuenta.id)]);
  return (
    <CorteVista
      titulo="Cortes y ganancia"
      intro="Lo que se ganó de verdad en el mes: el depósito real de Mercado Pago, menos devoluciones, menos el costo del producto, menos publicidad y gastos de Full. Las órdenes canceladas quedan fuera. Todo al centavo, orden por orden."
      ruta="/ventas/cortes"
      apiBase="/api/ventas"
      periodo={periodo}
      hoy={periodoActual()}
      e={e}
      cortes={cortes}
    />
  );
}
