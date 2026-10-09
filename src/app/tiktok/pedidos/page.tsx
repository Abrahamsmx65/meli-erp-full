import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { desdeSugerido, listarPedidosAlmacen } from "@/lib/servicios/tiktok-pedidos-almacen";
import { fechaMx } from "@/lib/servicios/ventas-monitor";
import { PedidosAlmacenTikTok } from "@/components/pedidos-almacen-tiktok";
import { Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/**
 * Pedidos de almacén de TikTok: qué reponerle a la bodega de TikTok desde
 * Industher, Caseshop y EnvioPack con lo que se va vendiendo.
 */
export default async function PedidosAlmacen() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Reabasto de almacén" />;

  const [pedidos, sugerido] = await Promise.all([
    listarPedidosAlmacen(supabase, cuenta.id),
    desdeSugerido(supabase, cuenta.id),
  ]);

  return (
    <Pagina>
      <Encabezado
        ceja="TikTok Shop"
        titulo="Reabasto de almacén"
        descripcion="Qué reponerle a la bodega de TikTok, por modelo, color y talla, y de qué bodega sale."
        ayuda={
          <p>
            La bodega de TikTok se vacía con lo que se vende. Se pide primero a Industher, luego a Caseshop, luego a
            EnvioPack. El pedido se guarda y el siguiente arranca donde terminó este.
          </p>
        }
      />
      <PedidosAlmacenTikTok pedidos={pedidos} desdeSugerido={sugerido} hoy={fechaMx(0)} />
    </Pagina>
  );
}
