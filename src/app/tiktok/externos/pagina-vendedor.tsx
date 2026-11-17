import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { publicacionesParaLigar, stockExterno } from "@/lib/servicios/tiktok-externos";
import { pendientesDeCorte } from "@/lib/servicios/tiktok-despacho";
import { agruparPublicaciones, fichaDeVendedor, nombreDeVendedor, publicacionesSinPrefijo } from "@/lib/tiktok/externos";
import { ExternosTikTok } from "@/components/externos-tiktok";
import { Aviso, Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

/**
 * La pantalla de UN vendedor externo de la tienda de TikTok: qué
 * publicaciones son suyas, el stock que se captura a mano (sale de SU bodega,
 * no de Industher) y sus cortes aparte. La misma para David
 * (`/tiktok/externos`) y para los saldos (`/tiktok/saldos`).
 */
export async function PaginaVendedorExterno({ vendedor }: { vendedor: string }) {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  const ficha = fichaDeVendedor(vendedor);
  const nombre = nombreDeVendedor(vendedor);
  const titulo = ficha?.titulo ?? `Productos de ${nombre}`;
  if (!cuenta) return <SinCuenta titulo={titulo} />;

  const [catalogo, stock, pendientes, cortesRes] = await Promise.all([
    publicacionesParaLigar(supabase, cuenta.id),
    stockExterno(supabase, cuenta.id, vendedor),
    pendientesDeCorte(supabase, cuenta.id, vendedor).catch(() => []),
    supabase
      .from("tiktok_cortes")
      .select("id, numero, creado_en, pedidos, pares")
      .eq("account_id", cuenta.id)
      .eq("vendedor", vendedor)
      .order("numero", { ascending: false })
      .limit(10),
  ]);
  const publicaciones = agruparPublicaciones(catalogo.skus, catalogo.ligadas);
  const sinPrefijo = ficha?.prefijo ? publicacionesSinPrefijo(publicaciones, vendedor) : [];
  const persona = ficha?.persona !== false;

  return (
    <Pagina>
      <Encabezado
        ceja="TikTok Shop"
        titulo={titulo}
        descripcion={
          persona
            ? `Lo que ${nombre} vende en la tienda: él captura su stock, lo despacha desde su bodega y sus pedidos van en su propio corte.`
            : `Los ${nombre.toLowerCase()} de la tienda: se despachan desde otra bodega, su stock se captura aquí y sus pedidos van en su propio corte.`
        }
        ayuda={
          <p>
            Una publicación ligada a {nombre} se sale de todo lo del dueño: Industher no la cuenta, la alarma no la juzga, al 3PL
            no se le mandan sus salidas, y su venta no entra a Ventas TikTok ni al Estado de resultados. Un pedido con algún
            producto de {nombre} (aunque traiga también algo de GETAC) se va a su corte. El stock que se capture aquí se escribe
            en TikTok en ese momento, después de leer los pedidos recientes.
            {ficha?.prefijo ? ` Sus SKU en TikTok empiezan con «${ficha.prefijo}» para no confundirse con los del inventario de GETAC.` : ""}
          </p>
        }
      />
      {sinPrefijo.length ? (
        <Aviso tono="alerta">
          {sinPrefijo.length === 1 ? "Una publicación ligada" : `${sinPrefijo.length} publicaciones ligadas`} a {nombre} {sinPrefijo.length === 1 ? "trae" : "traen"} SKU que no
          empiezan con «{ficha?.prefijo}»: {sinPrefijo.slice(0, 5).map((p) => p.titulo).join(", ")}
          {sinPrefijo.length > 5 ? ` y ${sinPrefijo.length - 5} más` : ""}. Si el SKU es igual al de un zapato de GETAC, los dos comparten el renglón del
          kardex; corrige el SKU en el Seller Center para que empiece con «{ficha?.prefijo}».
        </Aviso>
      ) : null}
      <ExternosTikTok
        vendedor={vendedor}
        nombre={nombre}
        persona={persona}
        publicaciones={publicaciones}
        stock={stock}
        pendientes={pendientes.length}
        cortes={(cortesRes.data ?? []).map((c: any) => ({ id: Number(c.id), numero: Number(c.numero), creadoEn: String(c.creado_en), pedidos: Number(c.pedidos ?? 0), pares: Number(c.pares ?? 0) }))}
      />
    </Pagina>
  );
}
