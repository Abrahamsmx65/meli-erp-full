import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/yapanizcel/cuenta";
import { listarCortes, periodoActual, validarPeriodo } from "@/lib/servicios/corte-meli";
import { obtenerEstadoResultadosYz } from "@/lib/servicios/corte-cache";
import { CorteVista } from "@/components/corte-vista";
import { SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Corte mensual de YAPANIZCEL: el mismo estado de resultados que calzado, armado desde las órdenes de fundas. */
export default async function CortesYz({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const sp = await searchParams;
  const periodo = validarPeriodo(sp.mes) ?? periodoActual();
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta servicio="yapanizcel" titulo="Cortes de fundas" />;

  // El corte del periodo vive masticado (yz_cache «corte:YYYY-MM»): cambiar
  // de mes es leer un renglón. La visita NO lanza el recálculo de fondo: con
  // el cliente del usuario (RLS, 8 s por consulta) el trabajo de 15–74 s se
  // cancelaba a medias. Lo refrescan los crons con el cliente admin (netos y
  // consolidado); solo sin renglón se calcula aquí.
  const [e, cortes] = await Promise.all([
    obtenerEstadoResultadosYz(supabase, cuenta, periodo, { refrescarEnFondo: false }),
    listarCortes(supabase, cuenta.id, "yz_cortes"),
  ]);
  return (
    <CorteVista
      ceja="Fundas"
      titulo="Cortes de fundas"
      descripcion="El estado de resultados del mes de fundas, sobre el depósito real de Mercado Pago."
      intro="Lo que se ganó de verdad en el mes con las fundas: el depósito real de Mercado Pago (ya sin comisión, envío ni retenciones), menos devoluciones, menos el costo por diseño, menos Product Ads y gastos de Full. Las órdenes canceladas quedan fuera. Mientras una orden no tiene depósito real, su venta queda fuera del neto y de la utilidad y el corte lo declara."
      ruta="/yapanizcel/cortes"
      apiBase="/api/yapanizcel"
      periodo={periodo}
      hoy={periodoActual()}
      e={e}
      cortes={cortes}
    />
  );
}
