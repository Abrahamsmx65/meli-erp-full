import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { mapaCostosUnificado } from "@/lib/servicios/costos-unificados";
import { cuentaActiva } from "@/lib/yapanizcel/cuenta";
import { cargarEnvios, obtenerPlanPantallaYz } from "@/lib/yapanizcel/envios";
import { desglosar } from "@/lib/yapanizcel/sku";
import { Ficha } from "@/components/tiles";
import { PlanEnvios, type LineaPantalla } from "@/components/yapanizcel/plan-envios";
import { n } from "@/components/yapanizcel/comunes";
import { Aviso, Cifras, Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function EnviosYz() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta servicio="yapanizcel" titulo="Envíos a Full de fundas" />;

  // El plan vive masticado en yz_cache y aquí se lee su vista CHICA
  // («plan:pantalla»: solo las líneas con algo que decir, con título; el
  // renglón completo pesa ~4 MB). La lista de envíos y el mapa de
  // categorías (productos_config, unos cientos de renglones) sí se leen
  // frescos y en paralelo: son baratos y cambian con cada registro o captura.
  const pPlan = obtenerPlanPantallaYz(supabase, cuenta.id);
  const [{ datos: plan, generadoEn }, { envios }, config] = await Promise.all([
    pPlan,
    pPlan.then(({ datos }) => cargarEnvios(supabase, cuenta.id, datos.parametros.diasCaducidadEnvio)),
    mapaCostosUnificado(supabase, { yzAccountId: cuenta.id }),
  ]);
  const lineas: LineaPantalla[] = plan.lineas.map((l) => ({
    ...l,
    categoria: config.get(desglosar(l.sku).diseno.toUpperCase())?.categoria ?? null,
  }));
  const sinInventario = plan.sinInventario;

  return (
    <Pagina>
      <Encabezado
        ceja="Fundas"
        titulo="Envíos a Full de fundas"
        descripcion={`Qué mandar a Full para ${plan.parametros.diasObjetivo} días de cobertura, en decenas cerradas.`}
        frescura={generadoEn}
        acciones={
          <a href="/api/yapanizcel/envios/excel" className="boton boton-borde">
            Excel del plan
          </a>
        }
        ayuda={
          <>
            <p>
              Con la venta de los últimos {plan.parametros.diasVenta} días completos ({plan.desde} → {plan.hasta}), pesando más
              lo reciente, y lo que hay en Full, esto es lo que hay que mandar para dejar {plan.parametros.diasObjetivo} días de
              cobertura, en decenas cerradas y topado por lo que hay en bodega. Ordenado por categoría y SKU.
            </p>
            <p>
              Venta/día = 50% la última semana + 30% la anterior + 20% el resto de la ventana, hasta ayer (hoy va a medias).
              El asterisco (*) marca la venta corregida por los días que el SKU estuvo agotado (se activa cuando hay fotos
              diarias suficientes).
            </p>
            {plan.descontinuados.activo && plan.descontinuados.skus ? (
              <p>{plan.descontinuados.skus} SKUs descontinuados (sin una venta en 180 días) no se ofrecen aquí.</p>
            ) : null}
          </>
        }
      />

      <Cifras columnas={4}>
        <Ficha titulo="Unidades a mandar" valor={n(plan.unidades)} nota={`${plan.skus} SKUs`} tono="bien" />
        <Ficha titulo="Falta sin cubrir" valor={n(plan.faltanteSinCubrir)} nota="no hay en bodega para completarlo" tono={plan.faltanteSinCubrir ? "alerta" : "neutro"} />
        <Ficha titulo="Sin inventario en bodega" valor={sinInventario} nota="SKUs con faltante y nada que mandar" tono={sinInventario ? "alerta" : "neutro"} />
        <Ficha titulo="Sin amarrar" valor={plan.sinAmarrar.renglones} nota={`${n(plan.sinAmarrar.unidades)} unidades que el plan no ve`} tono={plan.sinAmarrar.renglones ? "critico" : "bien"} />
      </Cifras>

      {plan.sinAmarrar.renglones ? (
        <Aviso tono="alerta">
          Hay inventario en bodega que el plan no puede usar porque su SKU no está amarrado.{" "}
          <Link href="/yapanizcel/skus" className="enlace">
            Resolverlo en SKUs
          </Link>
          .
        </Aviso>
      ) : null}

      <PlanEnvios lineas={lineas} multiplo={plan.parametros.multiploEnvio} envios={envios} />
    </Pagina>
  );
}
