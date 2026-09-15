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
          Ads por modelo en Amazon {cuenta.pais}: qué se vendió y cuánto costó la
          publicidad —total, por unidad y como % de la venta— en el periodo ({dias}{" "}
          días · {rango.desde} → {rango.hasta}). La ganancia vive en Ventas Amazon.
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

      {/* Decisión del dueño: esta pantalla NO enseña ganancia (esa vive en
          Ventas Amazon con la definición del corte). Solo lo de ads: unidades,
          venta, gasto, gasto por unidad y % sobre LA MISMA venta mostrada. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Ficha
          titulo="Unidades vendidas"
          valor={n(t.unidades)}
          nota={`Periodo de ${dias} días`}
        />
        <Ficha titulo="Venta del periodo" valor={pesos(t.importe)} nota="Todas las ventas del rango" />
        <Ficha
          titulo="Gasto en publicidad"
          valor={p.aviso ? "—" : pesos(t.gastoAds)}
          nota={p.aviso ? "Sin datos del rango" : "Reporte de economía por SKU"}
          tono={p.aviso ? "neutro" : "alerta"}
        />
        <Ficha
          titulo="Gasto por unidad"
          valor={!p.aviso && t.unidades > 0 ? pesosFinos(t.gastoAds / t.unidades) : "—"}
          nota="Gasto ÷ unidades vendidas del periodo"
        />
        <Ficha
          titulo="% de la venta"
          valor={!p.aviso && t.importe > 0 ? pct(t.gastoAds / t.importe) : "—"}
          nota="Gasto ÷ la misma venta de arriba"
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
            Todas las tallas de cada modelo, juntas. Venta y unidades son TODAS las
            ventas del periodo; el gasto viene del reporte de economía por SKU, y el
            gasto por unidad y el % se calculan sobre esas mismas unidades y venta,
            para que siempre cuadren con lo que ves. La ganancia vive en Ventas
            Amazon.
          </p>
        </header>
        <div className="max-h-[40rem] overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>Modelo</th>
                <th className="num">Unidades</th>
                <th className="num">Venta</th>
                <th className="num">Gasto ads</th>
                <th className="num">Gasto por unidad</th>
                <th className="num">% de la venta</th>
              </tr>
            </thead>
            <tbody>
              {p.filas.map((f) => {
                const gasto = f.gastoAds ?? 0;
                return (
                  <tr key={f.modelo}>
                    <td className="font-medium">{f.modelo}</td>
                    <td className="num cifra font-semibold">{n(f.unidades)}</td>
                    <td className="num cifra">{pesos(f.importe)}</td>
                    <td className="num cifra">{gasto > 0 ? pesos(gasto) : "—"}</td>
                    <td className="num cifra font-semibold">
                      {gasto > 0 && f.unidades > 0 ? pesosFinos(gasto / f.unidades) : "—"}
                    </td>
                    <td
                      className="num cifra"
                      style={gasto > 0 && f.importe > 0 && gasto / f.importe > 0.3 ? { color: "var(--estado-critico)" } : { color: "var(--ink-2)" }}
                    >
                      {gasto > 0 && f.importe > 0 ? pct(gasto / f.importe) : "—"}
                    </td>
                  </tr>
                );
              })}
              {p.filas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>
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
