import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/yapanizcel/cuenta";
import { cargarMonitor, normalizarRango, type Totales } from "@/lib/yapanizcel/ventas";
import { hoyMx } from "@/lib/yapanizcel/db";
import { Ficha } from "@/components/tiles";
import { FiltroFechas } from "@/components/filtro-fechas";
import { Encabezado, SinCuenta, n, pesos } from "@/components/yapanizcel/comunes";
import { TablaVentasYz } from "@/components/yapanizcel/tabla-ventas";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function notaGanancia(t: Totales): string {
  const partes = [`neto ${pesos(t.neto)}`, `costo ${pesos(t.costo)}`];
  if (t.unidadesSinCosto) partes.push(`${n(t.unidadesSinCosto)} u. sin costo`);
  return partes.join(" · ");
}

export default async function VentasYz({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const sp = await searchParams;
  const rango = normalizarRango(sp.desde, sp.hasta);
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta />;

  const m = await cargarMonitor(supabase, cuenta.id, rango);
  const variacion = m.anterior.unidades > 0 ? (m.periodo.unidades - m.anterior.unidades) / m.anterior.unidades : null;

  return (
    <div className="flex flex-col gap-6">
      <Encabezado
        titulo="Ventas · YAPANIZCEL"
        texto="Unidades, ventas, comisión de Mercado Libre, neto real depositado y ganancia contra el costo cargado. Los netos marcados con * todavía se están estimando (los cargos llegan diferidos)."
      />
      <FiltroFechas base="/yapanizcel/ventas" desde={rango.desde} hasta={rango.hasta} hoy={hoyMx()} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Ficha titulo="Hoy" valor={n(m.hoy.unidades)} nota={`${pesos(m.hoy.importe)} · ${n(m.hoy.ordenes)} órdenes`} tono="bien" />
        <Ficha titulo="Ayer" valor={n(m.ayer.unidades)} nota={pesos(m.ayer.importe)} />
        <Ficha
          titulo="Periodo"
          valor={n(m.periodo.unidades)}
          nota={`${pesos(m.periodo.importe)}${variacion != null ? ` · ${variacion >= 0 ? "+" : ""}${Math.round(variacion * 100)}% vs anterior` : ""}`}
        />
        <Ficha titulo="Neto depositado" valor={pesos(m.periodo.neto)} nota={`comisión ${pesos(m.periodo.comision)}`} />
        <Ficha titulo="Ganancia" valor={pesos(m.periodo.ganancia)} nota={notaGanancia(m.periodo)} tono={m.periodo.unidadesSinCosto ? "alerta" : m.periodo.ganancia >= 0 ? "bien" : "critico"} />
      </div>

      {m.skusSinCosto ? (
        <p className="text-sm" style={{ color: "var(--estado-serio)" }}>
          {m.skusSinCosto} SKUs vendieron sin costo cargado: su ganancia no se puede calcular. Captúralo en Productos y costos (Bodega), donde viven los costos de calzado y fundas.
        </p>
      ) : null}

      <TablaVentasYz titulo="Por diseño" filas={m.porDiseno} />
      <TablaVentasYz titulo="Por SKU" filas={m.porSku} conTitulo />
    </div>
  );
}
