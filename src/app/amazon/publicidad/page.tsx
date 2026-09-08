import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { obtenerPublicidadAmazon } from "@/lib/servicios/publicidad-amazon";
import { diasDeRango, fechaMx, normalizarRango } from "@/lib/servicios/ventas-monitor";
import { Ficha } from "@/components/tiles";
import { FiltroFechas } from "@/components/filtro-fechas";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

function pesosFinos(x: number): string {
  return (
    "$" +
    x.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/**
 * Publicidad de Amazon por modelo: el espejo del panel de MELI. El gasto sale
 * del reporte de economía por SKU (Data Kiosk), que llega con unos días de
 * retraso; por eso el por-unidad usa las unidades de ese mismo reporte.
 */
export default async function PublicidadAmazon({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const sp = await searchParams;
  // Sin rango en la URL, los últimos 30 días, igual que el panel de MELI.
  const rango = normalizarRango(sp.desde ?? fechaMx(29), sp.hasta);
  const dias = diasDeRango(rango);

  const supabase = await clienteServidor();
  const cuenta = await cuentaAmazon(supabase);
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Amazon no está conectado</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          No hay ninguna cuenta de Amazon asociada a este usuario.
        </p>
      </div>
    );
  }

  const cuentaMeli = await cuentaActiva(supabase);
  const p = await obtenerPublicidadAmazon(supabase, cuenta.id, cuentaMeli?.id ?? null, rango);
  const t = p.totales;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">Publicidad Amazon</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Ads por modelo en Amazon {cuenta.pais}: qué se vendió, qué se ganó y cuánto
          costó la publicidad por unidad vendida en el periodo ({dias} días ·{" "}
          {rango.desde} → {rango.hasta}).
        </p>
      </div>

      <FiltroFechas
        base="/amazon/publicidad"
        desde={rango.desde}
        hasta={rango.hasta}
        hoy={fechaMx(0)}
      />

      {p.aviso ? (
        <div
          className="tarjeta border p-4 text-sm"
          style={{ borderColor: "var(--estado-alerta)" }}
        >
          <div className="font-semibold">Sin datos de publicidad en el rango</div>
          <p className="mt-1" style={{ color: "var(--ink-2)" }}>
            {p.aviso}
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Ficha
          titulo="Gasto en publicidad"
          valor={p.aviso ? "—" : pesos(t.gastoAds)}
          nota={
            p.aviso
              ? "Sin datos del rango"
              : `${t.tacos != null ? pct(t.tacos) : "—"} de la venta del reporte de economía`
          }
          tono={p.aviso ? "neutro" : "alerta"}
        />
        <Ficha
          titulo="Venta del periodo"
          valor={pesos(t.importe)}
          nota={`${n(t.unidades)} unidades`}
        />
        <Ficha
          titulo="Ganancia estimada"
          valor={t.coberturaCosto > 0 ? pesos(t.ganancia) : "—"}
          nota={
            t.coberturaCosto > 0
              ? `Venta − costo · ${pct(t.coberturaCosto)} de la venta con costo`
              : "Captura costos en Productos y costos"
          }
        />
        <Ficha
          titulo="Costo por unidad vendida"
          valor={!p.aviso && t.costoPorUnidad != null ? pesosFinos(t.costoPorUnidad) : "—"}
          nota="Gasto ÷ unidades del mismo reporte de economía"
        />
        <Ficha
          titulo="Ganancia después de ads"
          valor={t.coberturaCosto > 0 && !p.aviso ? pesos(t.ganancia - t.gastoAds) : "—"}
          nota="Ganancia estimada − publicidad"
          tono={
            t.coberturaCosto > 0 && !p.aviso
              ? t.ganancia - t.gastoAds < 0
                ? "critico"
                : "bien"
              : "neutro"
          }
        />
      </div>

      {p.economiaHasta && p.economiaHasta < rango.hasta ? (
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          La economía por SKU tiene datos hasta el {p.economiaHasta}; los días
          posteriores del rango aún no traen gasto de publicidad.
        </p>
      ) : null}

      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="text-base font-semibold">Por modelo</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Todas las tallas de cada modelo, juntas, en orden alfabético. Venta y
            unidades son TODAS las ventas del periodo; “$ ads/unidad” y el % usan las
            unidades y ventas del reporte de economía (mismos días que el gasto).
            Ganancia neta = ganancia estimada − publicidad.
          </p>
        </header>
        <div className="max-h-[40rem] overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>Modelo</th>
                <th className="num">Unidades</th>
                <th className="num">Venta</th>
                <th className="num">Ganancia</th>
                <th className="num">Gasto ads</th>
                <th className="num">$ ads/unidad</th>
                <th className="num">% de la venta</th>
                <th className="num">Ganancia neta</th>
              </tr>
            </thead>
            <tbody>
              {p.filas.map((f) => (
                <tr key={f.modelo}>
                  <td className="font-medium">{f.modelo}</td>
                  <td className="num cifra font-semibold">{n(f.unidades)}</td>
                  <td className="num cifra">{pesos(f.importe)}</td>
                  <td
                    className="num cifra"
                    style={{
                      color:
                        f.ganancia != null && f.ganancia < 0
                          ? "var(--estado-critico)"
                          : "var(--ink-1)",
                    }}
                  >
                    {f.ganancia == null ? "—" : pesos(f.ganancia)}
                  </td>
                  <td className="num cifra">
                    {f.gastoAds != null && f.gastoAds > 0 ? pesos(f.gastoAds) : "—"}
                  </td>
                  <td className="num cifra font-semibold">
                    {f.costoPorUnidad != null && f.gastoAds ? pesosFinos(f.costoPorUnidad) : "—"}
                  </td>
                  <td className="num cifra" style={{ color: "var(--ink-2)" }}>
                    {f.tacos != null && f.gastoAds ? pct(f.tacos) : "—"}
                  </td>
                  <td
                    className="num cifra"
                    style={{
                      color:
                        f.gananciaNeta != null && f.gananciaNeta < 0
                          ? "var(--estado-critico)"
                          : "var(--ink-1)",
                    }}
                  >
                    {f.gananciaNeta == null ? "—" : pesos(f.gananciaNeta)}
                  </td>
                </tr>
              ))}
              {p.filas.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>
                    Sin ventas ni publicidad en el periodo.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
