import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { publicacionesParaLigar, stockExterno } from "@/lib/servicios/tiktok-externos";
import { pendientesDeCorte } from "@/lib/servicios/tiktok-despacho";
import { agruparPublicaciones, nombreDeVendedor, VENDEDOR_DAVID } from "@/lib/tiktok/externos";
import { ExternosTikTok } from "@/components/externos-tiktok";
import { Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/**
 * Lo de David en la tienda de TikTok: qué publicaciones son suyas, el stock
 * que él captura (sale de su bodega, no de Industher) y sus cortes aparte.
 */
export default async function ExternosPagina() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  const nombre = nombreDeVendedor(VENDEDOR_DAVID);
  if (!cuenta) return <SinCuenta titulo={`Productos de ${nombre}`} />;

  const [catalogo, stock, pendientes, cortesRes] = await Promise.all([
    publicacionesParaLigar(supabase, cuenta.id),
    stockExterno(supabase, cuenta.id, VENDEDOR_DAVID),
    pendientesDeCorte(supabase, cuenta.id, VENDEDOR_DAVID).catch(() => []),
    supabase
      .from("tiktok_cortes")
      .select("id, numero, creado_en, pedidos, pares")
      .eq("account_id", cuenta.id)
      .eq("vendedor", VENDEDOR_DAVID)
      .order("numero", { ascending: false })
      .limit(10),
  ]);
  const publicaciones = agruparPublicaciones(catalogo.skus, catalogo.ligadas);

  return (
    <Pagina>
      <Encabezado
        ceja="TikTok Shop"
        titulo={`Productos de ${nombre}`}
        descripcion={`Lo que ${nombre} vende en la tienda: él captura su stock, lo despacha desde su bodega y sus pedidos van en su propio corte.`}
        ayuda={
          <p>
            Una publicación ligada a {nombre} se sale de todo lo del dueño: Industher no la cuenta, la alarma no la juzga, al 3PL
            no se le mandan sus salidas, y su venta no entra a Ventas TikTok ni al Estado de resultados. Un pedido con algún
            producto suyo (aunque traiga también algo de GETAC) se va a su corte. El stock que capture aquí se escribe en
            TikTok en ese momento, después de leer los pedidos recientes.
          </p>
        }
      />
      <ExternosTikTok
        vendedor={VENDEDOR_DAVID}
        nombre={nombre}
        publicaciones={publicaciones}
        stock={stock}
        pendientes={pendientes.length}
        cortes={(cortesRes.data ?? []).map((c: any) => ({ id: Number(c.id), numero: Number(c.numero), creadoEn: String(c.creado_en), pedidos: Number(c.pedidos ?? 0), pares: Number(c.pares ?? 0) }))}
      />
    </Pagina>
  );
}
