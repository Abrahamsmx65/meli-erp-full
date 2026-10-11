import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";
import { NuevoPedido } from "@/components/nuevo-pedido";

export const dynamic = "force-dynamic";

/**
 * Nuevo pedido a China: la lista del dueño → borrador por modelo con su IN →
 * confirmar = pedido dado de alta + Excel en el formato de la fábrica por
 * correo. Ver `servicios/pedidos-borradores.ts`.
 */
export default async function NuevoPedidoPagina() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Nuevo pedido" />;

  return (
    <Pagina>
      <Encabezado ceja="Abastecimiento" titulo="Nuevo pedido" />
      <NuevoPedido />
    </Pagina>
  );
}
