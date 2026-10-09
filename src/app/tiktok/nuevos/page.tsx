import { cuentaActiva } from "@/lib/datos/repos";
import { listarProductosNuevos } from "@/lib/servicios/tiktok-publicar";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { ProductosNuevosTikTok } from "@/components/productos-nuevos-tiktok";
import { Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/**
 * Productos nuevos de TikTok: el catálogo de calzado de Amazon (SKUs,
 * fotos, colores y tallas), con el precio que se le va a poner, para
 * publicarlo masivamente en TikTok Shop. Pedido del dueño, 30-sep-2026.
 */
export default async function ProductosNuevosTikTokPage() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Productos nuevos · TikTok" />;

  // Lo guardado aunque esté viejo; se refresca por atrás (solo sin renglón se calcula aquí).
  const datos = await listarProductosNuevos(clienteAdmin(), cuenta.id, { servirGuardado: true });

  return (
    <Pagina>
      <Encabezado
        ceja="TikTok Shop"
        titulo="Productos nuevos · TikTok"
        descripcion="El calzado de Amazon por modelo, con sus colores y tallas, para publicarlo en TikTok Shop."
        ayuda={
          <>
            <p>
              Marca los que quieras, corrige el título si hace falta, ponles precio y «Publicar en TikTok»: las fotos, la
              descripción y las variantes salen de la ficha de Amazon; los colores van en español; la categoría, la marca y
              los atributos se copian de un producto que la tienda ya tiene.
            </p>
            <p>Lo que TikTok ya vende se queda tachado. La publicación corre por atrás y se ve en la cola de abajo.</p>
          </>
        }
      />
      {/* El rol de TikTok también publica desde el 2-oct-2026 (dueño: «acceso a todas las secciones adentro de TikTok»). */}
      <ProductosNuevosTikTok inicial={datos} esDueno={Boolean(user)} />
    </Pagina>
  );
}
