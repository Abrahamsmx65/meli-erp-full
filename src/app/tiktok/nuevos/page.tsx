import { rolDeSesion } from "@/lib/acceso/roles";
import { cuentaActiva } from "@/lib/datos/repos";
import { listarProductosNuevos } from "@/lib/servicios/tiktok-publicar";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { ProductosNuevosTikTok } from "@/components/productos-nuevos-tiktok";

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
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Conecta Mercado Libre primero</h1>
      </div>
    );
  }

  const datos = await listarProductosNuevos(clienteAdmin(), cuenta.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">Productos nuevos · TikTok</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Todo el calzado publicado en Amazon, por modelo con sus colores y tallas. Marca los que quieras,
          corrige el título si hace falta, ponles precio y «Publicar en TikTok»: las fotos, la descripción y las
          variantes salen de la ficha de Amazon; los colores van en español; la categoría, la marca y los atributos
          se copian de un producto que la tienda ya tiene. Lo que TikTok ya vende se queda tachado. La publicación
          corre por atrás y se ve en la cola de abajo.
        </p>
      </div>
      <ProductosNuevosTikTok inicial={datos} esDueno={rolDeSesion(user) === "dueño"} />
    </div>
  );
}
