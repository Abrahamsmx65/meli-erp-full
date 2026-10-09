import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { listarDevoluciones } from "@/lib/servicios/tiktok-devoluciones";
import { DevolucionesTikTok } from "@/components/devoluciones-tiktok";

export const dynamic = "force-dynamic";

/**
 * Devoluciones de TikTok: encontrar el paquete que llegó (por la guía de
 * regreso o el pedido), confirmarlo para que TikTok reembolse y decidir si
 * el par vuelve al stock o se tira.
 */
export default async function Devoluciones() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Conecta Mercado Libre primero</h1>
      </div>
    );
  }
  const devoluciones = await listarDevoluciones(supabase, cuenta.id);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">Devoluciones · TikTok</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Lo que los clientes regresan. Escanea la guía del paquete o teclea el pedido, confirma que llegó
          —con eso TikTok le reembolsa al cliente— y di por cada par si vuelve al stock o se tira. El par que
          vuelve entra al kardex y se le ofrece a TikTok otra vez; Industher lo cuenta en su foto.
        </p>
      </div>
      <DevolucionesTikTok devoluciones={devoluciones} ahora={Date.now()} />
    </div>
  );
}
