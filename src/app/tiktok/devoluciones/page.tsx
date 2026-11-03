import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { listarDevoluciones } from "@/lib/servicios/tiktok-devoluciones";
import { DevolucionesTikTok } from "@/components/devoluciones-tiktok";
import { Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/**
 * Devoluciones de TikTok: encontrar el paquete que llegó (por la guía de
 * regreso o el pedido), confirmarlo para que TikTok reembolse y decidir si
 * el par vuelve al stock o se tira.
 */
export default async function Devoluciones() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Devoluciones" />;
  const devoluciones = await listarDevoluciones(supabase, cuenta.id);
  return (
    <Pagina>
      <Encabezado
        ceja="TikTok Shop"
        titulo="Devoluciones"
        descripcion="Lo que los clientes regresan: encontrar el paquete, confirmar que llegó y decidir si el par vuelve al stock."
        ayuda={
          <p>
            Escanea la guía del paquete o teclea el pedido. Al confirmar que llegó, TikTok le reembolsa al cliente en ese
            momento. Por cada par se decide si vuelve al stock (entra al kardex y se le ofrece a TikTok otra vez; Industher
            lo cuenta en su foto) o si se tira (queda como merma). El cron de TikTok lee las devoluciones cada 15 minutos.
          </p>
        }
      />
      <DevolucionesTikTok devoluciones={devoluciones} ahora={Date.now()} />
    </Pagina>
  );
}
