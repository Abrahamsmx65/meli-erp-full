import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/yapanizcel/cuenta";
import { cargarEnvios, obtenerPlanYz } from "@/lib/yapanizcel/envios";
import { Ficha } from "@/components/tiles";
import { PlanEnvios, type LineaPantalla } from "@/components/yapanizcel/plan-envios";
import { Encabezado, SinCuenta, n } from "@/components/yapanizcel/comunes";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function EnviosYz() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta />;

  // El plan vive masticado en yz_cache; la lista de envíos sí se lee fresca
  // (es barata y cambia con cada registro).
  const plan = await obtenerPlanYz(supabase, cuenta.id);
  const { envios } = await cargarEnvios(supabase, cuenta.id, plan.parametros.diasCaducidadEnvio);
  // Un SKU con todo en cero (sin venta, sin stock, sin bodega, sin faltante)
  // no se puede mandar ni dice nada: fuera del viaje al navegador. Eran
  // miles de renglones muertos en el payload.
  const lineas: LineaPantalla[] = plan.lineas
    .filter((l) => l.vendidas + l.enFull + l.enTransferencia + l.enCamino + l.enBodega + l.falta > 0)
    .map((l) => ({ ...l, titulo: plan.titulos.get(l.sku) ?? null }));
  const sinInventario = plan.lineas.filter((l) => l.motivo === "sin_inventario").length;

  return (
    <div className="flex flex-col gap-6">
      <Encabezado
        titulo="Envíos a Full · YAPANIZCEL"
        texto={`Con la venta de los últimos ${plan.parametros.diasVenta} días completos (${plan.desde} → ${plan.hasta}), pesando más lo reciente, y lo que hay en Full, esto es lo que hay que mandar para dejar ${plan.parametros.diasObjetivo} días de cobertura, en decenas cerradas y topado por lo que hay en bodega.`}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Ficha titulo="Unidades a mandar" valor={n(plan.unidades)} nota={`${plan.skus} SKUs`} tono="bien" />
        <Ficha titulo="Falta sin cubrir" valor={n(plan.faltanteSinCubrir)} nota="no hay en bodega para completarlo" tono={plan.faltanteSinCubrir ? "alerta" : "neutro"} />
        <Ficha titulo="Sin inventario en bodega" valor={sinInventario} nota="SKUs con faltante y nada que mandar" tono={sinInventario ? "alerta" : "neutro"} />
        <Ficha titulo="Sin amarrar" valor={plan.inventario.sinAmarrar.renglones} nota={`${n(plan.inventario.sinAmarrar.unidades)} unidades que el plan no ve`} tono={plan.inventario.sinAmarrar.renglones ? "critico" : "bien"} />
      </div>

      {plan.descontinuados.activo && plan.descontinuados.skus.size ? (
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          {plan.descontinuados.skus.size} SKUs descontinuados (sin una venta en 180 días) no se ofrecen aquí.
        </p>
      ) : null}
      {plan.inventario.sinAmarrar.renglones ? (
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
