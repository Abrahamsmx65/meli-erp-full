import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { leerPlanParcial, obtenerPlan, type PlanGuardado } from "@/lib/servicios/cache";
import { Estado, colorEstado } from "@/components/estado";
import { BarraCobertura } from "@/components/tiles";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

export default async function Skus() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);

  if (!cuenta) {
    return <p className="text-sm">Conecta tu cuenta de Mercado Libre en Ajustes.</p>;
  }

  // Esta tabla usa solo las líneas y los parámetros del plan: se leen esas
  // claves del caché sin bajar el JSON completo (las cajas y el catálogo
  // pesan varios megas); sin plan guardado, obtenerPlan como siempre.
  const parcial = await leerPlanParcial(supabase, cuenta.id, ["lineas", "parametros"]);
  const plan = (
    parcial?.lineas && parcial?.parametros
      ? { lineas: parcial.lineas, parametros: parcial.parametros }
      : (await obtenerPlan(supabase, cuenta.id)).plan
  ) as Pick<PlanGuardado, "lineas" | "parametros">;
  const p = plan.parametros;
  const maxCobertura = Math.max(p.horizonteDias * 2, 60);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="titulo-pagina">Todos los SKUs</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
          {plan.lineas.length} SKUs analizados sobre {p.diasHistoria} días de historia. La demanda
          está corregida por los días en que el producto estuvo agotado.
        </p>
      </div>

      <div className="tarjeta overflow-hidden">
        <div className="max-h-[46rem] overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Estado</th>
                <th className="num">Vendidos</th>
                <th className="num">Días agotado</th>
                <th className="num">Venta cruda</th>
                <th className="num">Venta real</th>
                <th className="num">En Full</th>
                <th>Cobertura</th>
                <th className="num">Sugerido</th>
                <th>Confianza</th>
              </tr>
            </thead>
            <tbody>
              {plan.lineas.slice(0, 500).map((l) => (
                <tr key={l.sku}>
                  <td className="font-medium">{l.sku}</td>
                  <td>
                    <Estado estado={l.estado} />
                  </td>
                  <td className="num cifra">{n(l.unidadesTotales)}</td>
                  <td
                    className="num cifra"
                    style={{
                      color:
                        l.diasSinStock >= 7 ? "var(--estado-alerta)" : "var(--ink-2)",
                    }}
                  >
                    {l.diasSinStock || "—"}
                  </td>
                  <td className="num cifra" style={{ color: "var(--ink-muted)" }}>
                    {l.tasaObservada.toFixed(2)}
                  </td>
                  <td className="num cifra font-medium">
                    {l.demandaDiaria.toFixed(2)}
                    {l.factorCorreccion > 1.15 ? (
                      <span className="ml-1 text-xs" style={{ color: "var(--estado-alerta)" }}>
                        ×{l.factorCorreccion.toFixed(1)}
                      </span>
                    ) : null}
                  </td>
                  <td className="num cifra">{n(l.disponible)}</td>
                  <td style={{ minWidth: 150 }}>
                    <div className="flex items-center gap-2">
                      <BarraCobertura
                        dias={l.coberturaDias ?? Number.POSITIVE_INFINITY}
                        horizonte={p.horizonteDias}
                        color={colorEstado(l.estado)}
                        maximo={maxCobertura}
                      />
                      <span
                        className="cifra w-12 shrink-0 text-right text-xs"
                        style={{ color: "var(--ink-2)" }}
                      >
                        {l.coberturaDias == null ? "—" : `${l.coberturaDias.toFixed(0)}d`}
                      </span>
                    </div>
                  </td>
                  <td className="num cifra">{n(l.sugerido)}</td>
                  <td className="text-xs" style={{ color: "var(--ink-2)" }}>
                    {l.confianza}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="border-t p-3 text-xs hairline" style={{ color: "var(--ink-muted)" }}>
          "Venta cruda" es lo que verías dividiendo entre días de calendario. "Venta real" divide
          solo entre los días en que sí hubo stock, que es la demanda que de verdad existe.
          La diferencia entre las dos es lo que estabas dejando de vender sin darte cuenta.
        </footer>
      </div>
    </div>
  );
}
