import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { obtenerPlan } from "@/lib/servicios/cache";
import { cargarInventario } from "@/lib/servicios/inventario";
import { listarPedidos } from "@/lib/servicios/pedidos";
import { sugerirCompra } from "@/lib/servicios/compras";
import { Ficha } from "@/components/tiles";
import { CargarPedido } from "@/components/cargar-pedido";
import { ListaPedidos } from "@/components/lista-pedidos";
import { PedidoPorModelo } from "@/components/pedido-modelo";
import { amazonParaCompras } from "@/lib/servicios/fba";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

export default async function Pedidos() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);

  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Conecta Mercado Libre</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          Para saber qué pedirle a China hace falta ver primero cuánto se vende y
          cuánto hay en Full.
        </p>
        <Link
          href="/ajustes"
          className="mt-3 inline-block underline"
          style={{ color: "var(--acento)" }}
        >
          Ir a Ajustes
        </Link>
      </div>
    );
  }

  // Las tres piezas del problema en paralelo: cuánto se vende (plan), cuánto
  // hay en todos lados (inventario) y qué ya está pedido (pedidos).
  const [planEstado, inventario, pedidos, amazon] = await Promise.all([
    obtenerPlan(supabase, cuenta.id),
    cargarInventario(supabase, cuenta.id),
    listarPedidos(supabase, cuenta.id),
    amazonParaCompras(supabase),
  ]);

  const inventarioPorSku = new Map(
    inventario.renglones.map((r) => [
      r.sku,
      {
        enFull: r.enFull,
        enTransferencia: r.enTransferencia,
        enBodega: r.enBodega,
        enCamino: r.enCamino,
      },
    ]),
  );

  const compra = await sugerirCompra(
    supabase,
    cuenta.id,
    planEstado.plan.lineas,
    inventarioPorSku,
    undefined,
    inventario.crudos,
    amazon,
  );

  const p = compra.parametros;
  const ciclo = p.diasProduccion + p.diasTransito;

  const cajasEnCamino = pedidos
    .filter((x) => x.estado !== "cancelado")
    .reduce(
      (a, x) => a + x.contenedores.filter((c) => c.estado !== "recibido").reduce((s, c) => s + c.cajas, 0),
      0,
    );
  const cajasSinBarco = pedidos
    .filter((x) => x.estado !== "recibido" && x.estado !== "cancelado")
    .reduce((a, x) => a + Math.max(0, x.cajas - x.cajasAsignadas), 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">Pedidos a China</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Qué conviene pedir, mirando al mismo tiempo lo que se vende en Mercado
          Libre, lo que hay en Full, lo que hay en bodega y lo que ya viene en el
          barco. Y abajo, los pedidos vivos con su contenedor.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Ficha
          titulo="Hay que pedir"
          valor={n(compra.totales.cajas)}
          nota={`${n(compra.totales.pares)} pares · ${compra.totales.modelosAPedir} modelos`}
          tono={compra.totales.cajas > 0 ? "alerta" : "bien"}
        />
        <Ficha
          titulo="Se acaban antes"
          valor={n(compra.totales.enQuiebre)}
          nota={`No aguantan los ${ciclo} días del ciclo`}
          tono={compra.totales.enQuiebre > 0 ? "critico" : "bien"}
        />
        <Ficha titulo="Pedidos vivos" valor={n(pedidos.filter((x) => x.estado !== "recibido").length)} nota={`${pedidos.length} en total`} />
        <Ficha titulo="Cajas en barco" valor={n(cajasEnCamino)} nota="Ya embarcadas, sin llegar" />
        <Ficha
          titulo="Sin embarcar"
          valor={n(cajasSinBarco)}
          nota="Cajas de pedidos sin contenedor"
          tono={cajasSinBarco > 0 ? "alerta" : "neutro"}
        />
      </div>

      {!planEstado.vigente ? (
        <p
          className="rounded-lg p-3 text-sm"
          style={{
            background: "color-mix(in oklab, var(--estado-alerta) 12%, transparent)",
          }}
        >
          La demanda que se usa aquí viene del último cálculo y ya cambió algo:{" "}
          {planEstado.motivo ?? "hay datos nuevos"}. Recalcula en{" "}
          <Link href="/envios" className="underline">
            Envíos a Full
          </Link>{" "}
          para afinar los números.
        </p>
      ) : null}

      {/* ---- Cómo se calculó ------------------------------------------------ */}
      <details className="tarjeta p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Cómo salió cada número
        </summary>
        <div className="mt-3 flex flex-col gap-2 text-sm" style={{ color: "var(--ink-2)" }}>
          <p>
            De cada modelo y color se suma la <strong>demanda diaria corregida</strong> de
            todas sus tallas — la misma que usan los envíos a Full, ya arreglada por los
            días que estuvo agotado — y se compara contra{" "}
            <strong>todo el inventario que existe</strong>: Full, lo que va en camino a
            Full, las cajas cerradas en bodega y lo que viene en el barco.
          </p>
          <p>
            El objetivo son{" "}
            <strong>
              {p.diasProduccion} días de fábrica + {p.diasTransito} de barco y aduana +{" "}
              {p.diasCobertura} de piso = {p.diasProduccion + p.diasTransito + p.diasCobertura}{" "}
              días de venta
            </strong>
            . Lo que falta para llegar ahí se divide entre los pares por caja de su corrida
            y se redondea hacia arriba, porque las cajas no se abren.
          </p>
          <p>
            Un modelo marcado <strong>Pedir ya</strong> se queda sin producto antes de que
            alcance a llegar un pedido nuevo. Ábrelo para ver la cuenta completa y, cuando la
            haya, la comparación entre la corrida de la fábrica y cómo se vende de verdad.
          </p>
          {compra.totales.sinCorrida > 0 ? (
            <p style={{ color: "var(--estado-alerta)" }}>
              {compra.totales.sinCorrida} modelos necesitan producto pero no tienen corrida
              cargada, así que no puedo convertir los pares en cajas. Se resuelven cargando la
              proforma del pedido que los trajo.
            </p>
          ) : null}
        </div>
      </details>

      <PedidoPorModelo renglones={compra.renglones} />

      <CargarPedido />

      <ListaPedidos pedidos={pedidos} />
    </div>
  );
}
