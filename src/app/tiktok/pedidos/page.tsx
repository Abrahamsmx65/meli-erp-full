import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { desdeSugerido, listarPedidosAlmacen } from "@/lib/servicios/tiktok-pedidos-almacen";
import { fechaMx } from "@/lib/servicios/ventas-monitor";
import { PedidosAlmacenTikTok } from "@/components/pedidos-almacen-tiktok";

export const dynamic = "force-dynamic";

/**
 * Pedidos de almacén de TikTok: qué reponerle a la bodega de TikTok desde
 * Industher, Caseshop y EnvioPack con lo que se va vendiendo.
 */
export default async function PedidosAlmacen() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Conecta Mercado Libre primero</h1>
      </div>
    );
  }

  const [pedidos, sugerido] = await Promise.all([
    listarPedidosAlmacen(supabase, cuenta.id),
    desdeSugerido(supabase, cuenta.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">Pedidos de almacén · TikTok</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          La bodega de TikTok se vacía con lo que se vende. Aquí se arma qué reponerle —por modelo,
          color y talla— y de qué bodega sale: primero Industher, luego Caseshop, luego EnvioPack.
          El pedido se guarda y el siguiente arranca donde terminó este.
        </p>
      </div>
      <PedidosAlmacenTikTok pedidos={pedidos} desdeSugerido={sugerido} hoy={fechaMx(0)} />
    </div>
  );
}
