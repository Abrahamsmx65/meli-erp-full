import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { listarPedidosTienda } from "@/lib/servicios/tienda-pedidos";
import { PedidosTienda } from "@/components/pedidos-tienda";
import { Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/**
 * Pedidos de la tienda en línea de GETAC. Comparten el almacén de TikTok:
 * lo que se aparta aquí deja de ofrecerse en TikTok y al revés.
 */
export default async function TiendaEnLinea() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Tienda en línea" />;

  const [pedidos, productosRes, ultimoRes] = await Promise.all([
    listarPedidosTienda(supabase, cuenta.id),
    supabase.from("tienda_productos").select("product_id", { count: "exact", head: true }).eq("account_id", cuenta.id).eq("activo", true),
    supabase
      .from("tienda_productos")
      .select("leido_en")
      .eq("account_id", cuenta.id)
      .order("leido_en", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const urlTienda = (process.env.TIENDA_URL ?? "").trim() || null;

  return (
    <Pagina>
      <Encabezado
        ceja="TikTok Shop"
        titulo="Tienda en línea"
        descripcion="Pedidos de la página de GETAC, que vende del mismo almacén que TikTok."
        acciones={
          <>
            {urlTienda && (
              <a href={urlTienda} target="_blank" rel="noreferrer" className="boton boton-borde">
                Abrir la tienda ↗
              </a>
            )}
            <Link href="/tiktok/despacho" className="boton boton-fantasma">
              ← Despacho TikTok
            </Link>
          </>
        }
        ayuda={
          <p>
            Lo que se aparta aquí deja de ofrecerse en TikTok en el acto, y al revés. Catálogo, fotos y precios salen de
            TikTok.
          </p>
        }
      />
      <PedidosTienda
        pedidos={pedidos}
        productosActivos={productosRes.count ?? 0}
        catalogoLeidoEn={ultimoRes.data?.leido_en ?? null}
      />
    </Pagina>
  );
}
