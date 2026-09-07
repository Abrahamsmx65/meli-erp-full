import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/yapanizcel/cuenta";
import { cargarMonitor, normalizarRango, type FilaVentas, type Totales } from "@/lib/yapanizcel/ventas";
import { hoyMx } from "@/lib/yapanizcel/db";
import { Ficha } from "@/components/tiles";
import { FiltroFechas } from "@/components/filtro-fechas";
import { Encabezado, SinCuenta, n, pesos } from "@/components/yapanizcel/comunes";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function pct(x: number | null): string {
  return x == null ? "—" : `${Math.round(x * 100)}%`;
}

function Tabla({ titulo, filas, conTitulo }: { titulo: string; filas: FilaVentas[]; conTitulo?: boolean }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">{titulo}</h2>
      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
              <th className="px-3 py-2">{conTitulo ? "SKU" : "Diseño"}</th>
              {conTitulo ? <th className="px-3 py-2">Título</th> : null}
              <th className="px-3 py-2 text-right">Unidades</th>
              <th className="px-3 py-2 text-right">Órdenes</th>
              <th className="px-3 py-2 text-right">Precio prom.</th>
              <th className="px-3 py-2 text-right">Ventas</th>
              <th className="px-3 py-2 text-right">Comisión</th>
              <th className="px-3 py-2 text-right">Neto</th>
              <th className="px-3 py-2 text-right">Costo</th>
              <th className="px-3 py-2 text-right">Ganancia</th>
              <th className="px-3 py-2 text-right">Margen</th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center" style={{ color: "var(--ink-muted)" }}>
                  Sin ventas en el periodo.
                </td>
              </tr>
            ) : null}
            {filas.map((f) => (
              <tr key={f.clave} className="border-t" style={{ borderColor: "var(--grid)" }}>
                <td className="num px-3 py-1.5 font-medium">{f.clave}</td>
                {conTitulo ? (
                  <td className="max-w-[280px] truncate px-3 py-1.5" style={{ color: "var(--ink-2)" }} title={f.titulo ?? ""}>
                    {f.titulo ?? ""}
                  </td>
                ) : null}
                <td className="num px-3 py-1.5 text-right">{n(f.unidades)}</td>
                <td className="num px-3 py-1.5 text-right">{n(f.ordenes)}</td>
                <td className="num px-3 py-1.5 text-right">{pesos(f.precioPromedio)}</td>
                <td className="num px-3 py-1.5 text-right">{pesos(f.importe)}</td>
                <td className="num px-3 py-1.5 text-right">{pesos(f.comision)}</td>
                <td className="num px-3 py-1.5 text-right" title={f.unidadesEstimadas ? `${f.unidadesEstimadas} unidades con neto estimado` : undefined}>
                  {pesos(f.neto)}
                  {f.unidadesEstimadas ? "*" : ""}
                </td>
                <td className="num px-3 py-1.5 text-right" style={{ color: f.unidadesSinCosto ? "var(--estado-serio)" : undefined }} title={f.unidadesSinCosto ? `${f.unidadesSinCosto} unidades sin costo` : undefined}>
                  {f.unidadesSinCosto ? `${pesos(f.costo)} ?` : pesos(f.costo)}
                </td>
                <td className="num px-3 py-1.5 text-right font-medium" style={{ color: f.unidadesSinCosto ? "var(--ink-muted)" : f.ganancia >= 0 ? "var(--exito-texto)" : "var(--estado-critico)" }}>
                  {pesos(f.ganancia)}
                </td>
                <td className="num px-3 py-1.5 text-right">{pct(f.margen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

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
          {m.skusSinCosto} SKUs vendieron sin costo cargado: su ganancia no se puede calcular. Sube el Excel de costos en Ajustes de fundas.
        </p>
      ) : null}

      <Tabla titulo="Por diseño" filas={m.porDiseno} />
      <Tabla titulo="Por SKU" filas={m.porSku} conTitulo />
    </div>
  );
}
