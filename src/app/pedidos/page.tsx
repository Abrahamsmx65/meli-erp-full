import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { estadoPlan } from "@/lib/servicios/cache";
import { cronometro } from "@/lib/servicios/cronometro";
import { listarPedidos } from "@/lib/servicios/pedidos";
import { servirCompraChina } from "@/lib/servicios/compras-china";
import { Ficha } from "@/components/tiles";
import { Aviso, Cifras, Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";
import { PedidoPorModelo } from "@/components/pedido-modelo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

export default async function Pedidos() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);

  if (!cuenta) return <SinCuenta titulo="Planeación de compras" />;

  // La sugerencia se lee MASTICADA (un renglón de app_cache): el plan, el
  // inventario y las sumas de Amazon y TikTok solo se bajan cuando hay que
  // calcularla, y eso pasa por atrás (latido o refresco tras servir lo
  // guardado). Aquí solo se leen además los pedidos (fichas) y si el plan
  // sigue vigente (dos columnas, sin su JSON).
  const t = cronometro("/pedidos");
  const [guardada, pedidos, planEstado] = await Promise.all([
    t.medir("compra", servirCompraChina(supabase, cuenta.id)),
    t.medir("pedidos", listarPedidos(supabase, cuenta.id)),
    t.medir("plan", estadoPlan(supabase, cuenta.id)),
  ]);
  t.fin();
  const { compra, amazon: amazonEstado, tiktok: tiktokEstado } = guardada.datos;

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
    <Pagina>
      <Encabezado
        ceja="Abastecimiento"
        titulo="Planeación de compras"
        descripcion="Qué conviene pedir, con la venta de Mercado Libre, Amazon y TikTok y todo el inventario que existe."
        frescura={guardada.generadoEn}
        ayudaTitulo="Cómo salió cada número"
        ayuda={
          <>
            <p>
              Se mira al mismo tiempo lo que se vende en Mercado Libre, Amazon y TikTok, lo que
              hay en Full, FBA y la bodega de TikTok, lo que hay en bodega y lo que ya viene en el
              barco. Los pedidos cargados, con su contenedor y sus filtros, viven en Cargar pedidos.
            </p>
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
          </>
        }
      />

      <Cifras columnas={5}>
        <Ficha
          titulo="Hay que pedir"
          valor={amazonEstado.disponible ? n(compra.totales.cajas) : "—"}
          nota={amazonEstado.disponible ? `${n(compra.totales.pares)} pares · ${compra.totales.modelosAPedir} modelos` : "Amazon no disponible"}
          tono={compra.totales.cajas > 0 ? "alerta" : "bien"}
        />
        <Ficha
          titulo="Se acaban antes"
          valor={amazonEstado.disponible ? n(compra.totales.enQuiebre) : "—"}
          nota={amazonEstado.disponible ? `No aguantan los ${ciclo} días del ciclo` : "Amazon no disponible"}
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
      </Cifras>

      {amazonEstado.advertencias.length ? (
        <Aviso tono="alerta">
          <strong>Amazon no está completo.</strong> La recomendación se calculó con los demás
          datos disponibles y puede cambiar cuando se recupere la lectura.
          <ul className="mt-1 list-disc pl-5">
            {amazonEstado.advertencias.map((mensaje) => (
              <li key={mensaje}>{mensaje}</li>
            ))}
          </ul>
        </Aviso>
      ) : null}

      {tiktokEstado.advertencias.length ? (
        <Aviso tono="alerta">
          <strong>TikTok no está completo.</strong> La recomendación se calculó sin su venta ni
          su bodega y saldría corta en lo que también se vende ahí.
          <ul className="mt-1 list-disc pl-5">
            {tiktokEstado.advertencias.map((mensaje) => (
              <li key={mensaje}>{mensaje}</li>
            ))}
          </ul>
        </Aviso>
      ) : null}

      {planEstado && !planEstado.vigente ? (
        <Aviso tono="alerta">
          La demanda que se usa aquí viene del último cálculo y ya cambió algo:{" "}
          {planEstado.motivo ?? "hay datos nuevos"}. Recalcula en{" "}
          <Link href="/envios" className="enlace">
            Envíos a Full
          </Link>{" "}
          para afinar los números.
        </Aviso>
      ) : null}

      {compra.totales.sinCorrida > 0 ? (
        <Aviso tono="alerta">
          {compra.totales.sinCorrida} modelos necesitan producto pero no tienen corrida
          cargada, así que no puedo convertir los pares en cajas. Se resuelven cargando la
          proforma del pedido que los trajo.
        </Aviso>
      ) : null}

      {amazonEstado.disponible ? <PedidoPorModelo renglones={compra.renglones} /> : null}
    </Pagina>
  );
}
