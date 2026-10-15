import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { listarOfertas, modelosParaOferta, ofertasGuardadas } from "@/lib/servicios/tiktok-promociones";
import { PromocionesTikTok } from "@/components/promociones-tiktok";
import { Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/**
 * Ofertas relámpago de TikTok desde el panel: ver las que TikTok tiene y
 * crear la general de 3 días con los precios de la estrategia.
 */
export default async function Promociones() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Ofertas relámpago" />;
  const admin = clienteAdmin();
  const [ofertas, catalogo, guardadas] = await Promise.all([
    listarOfertas(admin, cuenta.id),
    modelosParaOferta(admin, cuenta.id),
    ofertasGuardadas(admin, cuenta.id),
  ]);
  return (
    <Pagina>
      <Encabezado
        ceja="TikTok Shop"
        titulo="Ofertas relámpago"
        descripcion="Las ofertas que TikTok tiene hoy y una nueva relámpago de 3 días con los precios de la estrategia, sin salir del panel."
        ayuda={
          <p>
            La oferta se crea en TikTok tal cual: tipo relámpago, por variante, con el precio de oferta por modelo (todas sus
            tallas igual) y un tope de unidades por talla y por comprador (1 a 99, o sin tope). El precio sugerido es el de
            Estrategia de precios en el nivel que elijas; se puede corregir por modelo antes de crear. Lo que el API de TikTok
            no permite y sigue en el Seller Center: la relámpago de LIVE, las existencias reservadas para el creador y la
            inscripción a campañas de la plataforma.
          </p>
        }
      />
      <PromocionesTikTok ofertas={ofertas} modelos={catalogo.modelos} avisos={catalogo.avisos} guardadas={guardadas} ahora={Date.now()} />
    </Pagina>
  );
}
