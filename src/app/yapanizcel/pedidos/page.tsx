import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/yapanizcel/cuenta";
import { DIAS_OBJETIVO_PEDIDO, obtenerResumenCompras } from "@/lib/yapanizcel/compras";
import { listarPedidos } from "@/lib/yapanizcel/pedidos";
import { Ficha } from "@/components/tiles";
import { CargarPedido, ListaPedidos } from "@/components/yapanizcel/pedidos";
import { PedidosChina } from "@/components/yapanizcel/pedidos-china";
import { n } from "@/components/yapanizcel/comunes";
import { Cifras, Encabezado, Pagina, Seccion, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function PedidosYz({ searchParams }: { searchParams: Promise<{ diseno?: string; disenos?: string }> }) {
  const sp = await searchParams;
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta servicio="yapanizcel" titulo="Pedidos a China de fundas" />;

  // El servidor solo pinta el resumen (unos KB, ya masticado en yz_cache) y
  // la lista de pedidos. Abrir un diseño, filtrar y elegir pasa en el
  // navegador: la página no se vuelve a construir en cada clic.
  const [resumen, pedidos] = await Promise.all([obtenerResumenCompras(supabase, cuenta.id), listarPedidos(supabase, cuenta.id)]);
  const totalPedir = resumen.disenos.reduce((a, d) => a + d.sugerido, 0);
  const disenosIniciales = (sp.disenos ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const abrirInicial = sp.diseno?.trim().toUpperCase() || undefined;

  return (
    <Pagina>
      <Encabezado
        ceja="Fundas"
        titulo="Pedidos a China de fundas"
        descripcion={`Un renglón por diseño: cuánto pedir para ${DIAS_OBJETIVO_PEDIDO} días y lo que ya viene en camino.`}
        frescura={resumen.generadoEn}
        ayuda={
          <>
            <p>
              Elige los diseños que quieras ver (o escríbelos), ábrelos aquí mismo y baja el Excel solo de esos. Cada
              variante junta todo el inventario que existe (Full, en camino, bodega y pedidos sin recibir) contra su venta de
              30 días, y cuánto pedir para {DIAS_OBJETIVO_PEDIDO} días.
            </p>
            {resumen.descontinuados.activo ? (
              <p>
                {resumen.descontinuados.skus} SKUs descontinuados (sin una venta en 180 días) no se muestran ni se piden.
                {resumen.descontinuados.disenos
                  ? ` ${resumen.descontinuados.disenos} diseños retirados completos (ninguna variante vendió en 180 días); los demás siguen con sus variantes vivas.`
                  : " Un diseño que sigue vendiendo con otras variantes sí sale."}
              </p>
            ) : (
              <p>
                La regla de descontinuados (sin venta en 180 días) se activa cuando el historial de ventas cubra medio año;
                hoy llega
                {resumen.descontinuados.historialDesde ? ` hasta el ${resumen.descontinuados.historialDesde}` : " a nada"}.
              </p>
            )}
          </>
        }
      />
      <Cifras columnas={3}>
        <Ficha titulo="Diseños" valor={resumen.disenos.length} />
        <Ficha titulo="Con algo que pedir" valor={resumen.disenos.filter((d) => d.sugerido > 0).length} tono="alerta" />
        <Ficha titulo={`Unidades a pedir (${DIAS_OBJETIVO_PEDIDO} d)`} valor={n(totalPedir)} />
      </Cifras>

      <PedidosChina disenos={resumen.disenos} diasObjetivo={DIAS_OBJETIVO_PEDIDO} abrirInicial={abrirInicial} disenosIniciales={disenosIniciales} />

      <Seccion titulo="Cargar un pedido ya hecho o en camino" suelta>
        <CargarPedido />
      </Seccion>

      <Seccion titulo="Pedidos cargados" suelta>
        <ListaPedidos pedidos={pedidos} />
      </Seccion>
    </Pagina>
  );
}
