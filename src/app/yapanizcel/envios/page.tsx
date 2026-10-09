import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { mapaCostosUnificado } from "@/lib/servicios/costos-unificados";
import { cuentaActiva } from "@/lib/yapanizcel/cuenta";
import { cargarEnvios, obtenerPlanPantallaYz } from "@/lib/yapanizcel/envios";
import { desglosar } from "@/lib/yapanizcel/sku";
import { Ficha } from "@/components/tiles";
import { PlanEnvios, type LineaPantalla } from "@/components/yapanizcel/plan-envios";
import { Encabezado, Frescura, SinCuenta, n } from "@/components/yapanizcel/comunes";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const btn = "rounded-lg border px-3 py-1.5 text-sm font-semibold";

export default async function EnviosYz() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta />;

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
    <div className="flex flex-col gap-6">
      <Encabezado
        titulo="Envíos a Full · YAPANIZCEL"
        texto={`Con la venta de los últimos ${plan.parametros.diasVenta} días completos (${plan.desde} → ${plan.hasta}), pesando más lo reciente, y lo que hay en Full, esto es lo que hay que mandar para dejar ${plan.parametros.diasObjetivo} días de cobertura, en decenas cerradas y topado por lo que hay en bodega. Ordenado por categoría y SKU.`}
      >
        <a href="/api/yapanizcel/envios/excel" className={btn} style={{ borderColor: "var(--borde)" }}>
          Excel del plan
        </a>
      </Encabezado>

      <Frescura generadoEn={generadoEn} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Ficha titulo="Unidades a mandar" valor={n(plan.unidades)} nota={`${plan.skus} SKUs`} tono="bien" />
        <Ficha titulo="Falta sin cubrir" valor={n(plan.faltanteSinCubrir)} nota="no hay en bodega para completarlo" tono={plan.faltanteSinCubrir ? "alerta" : "neutro"} />
        <Ficha titulo="Sin inventario en bodega" valor={sinInventario} nota="SKUs con faltante y nada que mandar" tono={sinInventario ? "alerta" : "neutro"} />
        <Ficha titulo="Sin amarrar" valor={plan.sinAmarrar.renglones} nota={`${n(plan.sinAmarrar.unidades)} unidades que el plan no ve`} tono={plan.sinAmarrar.renglones ? "critico" : "bien"} />
      </div>

      {plan.descontinuados.activo && plan.descontinuados.skus ? (
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          {plan.descontinuados.skus} SKUs descontinuados (sin una venta en 180 días) no se ofrecen aquí.
        </p>
      ) : null}
      {plan.sinAmarrar.renglones ? (
        <p className="text-sm">
          Hay inventario en bodega que el plan no puede usar porque su SKU no está amarrado.{" "}
          <Link href="/yapanizcel/skus" className="underline" style={{ color: "var(--acento)" }}>
            Resolverlo en SKUs
          </Link>
          .
        </p>
      ) : null}

      <PlanEnvios lineas={lineas} multiplo={plan.parametros.multiploEnvio} envios={envios} />
    </div>
  );
}
