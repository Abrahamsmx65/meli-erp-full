import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { listarPedidosTienda } from "@/lib/servicios/tienda-pedidos";
import { PedidosTienda } from "@/components/pedidos-tienda";

export const dynamic = "force-dynamic";

/**
 * Pedidos de la tienda en línea de GETAC. Comparten el almacén de TikTok:
 * lo que se aparta aquí deja de ofrecerse en TikTok y al revés.
 */
export default async function TiendaEnLinea() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <p className="text-sm">Conecta tu cuenta en Ajustes.</p>;

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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pagina">Tienda en línea</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            La página de GETAC vende del mismo almacén que TikTok: lo que se aparta aquí deja de
            ofrecerse en TikTok en el acto, y al revés. Catálogo, fotos y precios salen de TikTok.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {urlTienda && (
            <a href={urlTienda} target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--ink-2)" }}>
              Abrir la tienda ↗
            </a>
          )}
          <Link href="/tiktok/despacho" className="underline" style={{ color: "var(--ink-2)" }}>
            ← Despacho TikTok
          </Link>
        </div>
      </div>
      <PedidosTienda
        pedidos={pedidos}
        productosActivos={productosRes.count ?? 0}
        catalogoLeidoEn={ultimoRes.data?.leido_en ?? null}
      />
    </div>
  );
}
