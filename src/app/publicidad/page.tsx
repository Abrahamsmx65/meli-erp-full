import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { diasDeRango, fechaMx, normalizarRango } from "@/lib/servicios/ventas-monitor";
import { cargarPublicidad, type RecomendacionAds } from "@/lib/servicios/publicidad";
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
 * Publicidad de Mercado Libre por modelo (el "parent": MY2307, GT128…).
 *
 * Aparte del monitor de ventas a propósito: aquí la pregunta no es "¿cómo
 * vendo?", sino "¿cuánto me cuesta la publicidad por cada par que vendo y
 * cuánta ganancia queda después de pagarla?". Por omisión, los últimos 30 días.
 */
export default async function Publicidad({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const sp = await searchParams;
  // Sin rango en la URL, los últimos 30 días (no los 7 del monitor de ventas).
  const rango = normalizarRango(sp.desde ?? fechaMx(29), sp.hasta);
  const dias = diasDeRango(rango);

  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">Conecta Mercado Libre</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          La publicidad sale de tu cuenta de Mercado Libre; primero hay que conectarla
          en Ajustes.
        </p>
      </div>
    );
  }

  const p = await cargarPublicidad(supabase, cuenta, rango);
  const t = p.totales;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Publicidad</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Product Ads por modelo: qué se vendió, qué se ganó y cuánto costó la
          publicidad por unidad vendida en el periodo ({dias} días · {rango.desde} →{" "}
          {rango.hasta}).
        </p>
      </div>

      <FiltroFechas base="/publicidad" desde={rango.desde} hasta={rango.hasta} hoy={fechaMx(0)} />

      {p.errorAds ? (
        <div
          className="tarjeta border p-4 text-sm"
          style={{ borderColor: "var(--estado-alerta)" }}
        >
          <div className="font-semibold">Sin datos de Product Ads</div>
          <p className="mt-1" style={{ color: "var(--ink-2)" }}>
            {p.errorAds}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
            Las ventas y la ganancia de abajo sí están completas; solo falta el gasto
            de publicidad.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Ficha
          titulo="Gasto en publicidad"
          valor={p.errorAds ? "—" : pesos(t.gastoAds)}
          nota={p.errorAds ? "Sin datos de ads" : `${pct(t.tacos ?? 0)} de la venta del periodo`}
          tono={p.errorAds ? "neutro" : "alerta"}
        />
        <Ficha
          titulo="Venta del periodo"
          valor={pesos(t.importe)}
          nota={`${n(t.unidades)} unidades`}
        />
        <Ficha
          titulo="Venta por publicidad"
          valor={p.errorAds ? "—" : pesos(t.ventaAds)}
          nota={
            p.errorAds
              ? "Sin datos de ads"
              : `${n(t.unidadesAds)} unidades atribuidas · ACOS ${
                  t.acos != null ? pct(t.acos) : "—"
                }`
          }
        />
        <Ficha
          titulo="Costo por unidad vendida"
          valor={!p.errorAds && t.costoPorUnidad != null ? pesosFinos(t.costoPorUnidad) : "—"}
          nota="Gasto en ads ÷ TODAS las unidades vendidas"
          tono="neutro"
        />
        <Ficha
          titulo="Ganancia después de ads"
          valor={t.coberturaCosto > 0 && !p.errorAds ? pesos(t.ganancia - t.gastoAds) : "—"}
          nota={
            t.coberturaCosto > 0
              ? `Ganancia ${pesos(t.ganancia)} − ads · ${pct(t.coberturaCosto)} de la venta con costo`
              : "Captura costos en Productos y costos"
          }
          tono={
            t.coberturaCosto > 0 && !p.errorAds
              ? t.ganancia - t.gastoAds < 0
                ? "critico"
                : "bien"
              : "neutro"
          }
        />
      </div>

      {p.recomendaciones.length > 0 ? (
        <section className="tarjeta overflow-hidden">
          <header className="border-b p-4 hairline">
            <h2 className="text-base font-semibold">Recomendaciones</h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
              Qué hacer hoy con cada modelo, cruzando la publicidad con el stock de
              Full y el margen. Los cambios se hacen en la consola de Product Ads de
              Mercado Libre; su API no acepta modificarlos desde aquí.
            </p>
          </header>
          <table className="datos">
            <thead>
              <tr>
                <th>Modelo</th>
                <th>Qué hacer</th>
                <th>Por qué</th>
              </tr>
            </thead>
            <tbody>
              {p.recomendaciones.map((r) => (
                <tr key={`${r.accion}|${r.modelo}`}>
                  <td className="font-semibold">
                    {r.modelo}
                    {r.publicaciones.length ? (
                      <span
                        className="mt-0.5 block text-[10px] leading-tight"
                        style={{ color: "var(--ink-muted)" }}
                      >
                        {r.publicaciones.join(" · ")}
                      </span>
                    ) : null}
                  </td>
                  <td
                    className="font-semibold"
                    style={{ color: COLOR_ACCION[r.accion], whiteSpace: "normal" }}
                  >
                    {r.queHacer}
                  </td>
                  <td style={{ color: "var(--ink-2)", whiteSpace: "normal" }}>
                    {r.razon}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {p.sinAmarre.anuncios > 0 ? (
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {p.sinAmarre.anuncios} anuncios con {pesos(p.sinAmarre.gasto)} de gasto no
          amarraron a ningún modelo del catálogo (publicaciones fuera de la
          sincronización); ese gasto sí cuenta en el total de arriba.
        </p>
      ) : null}

      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="text-base font-semibold">Por modelo</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Todas las tallas y colores de cada modelo, juntos. Venta y unidades son
            TODAS las ventas del periodo; “$ ads/unidad” reparte el gasto de
            publicidad entre ellas. Un anuncio compartido por varios modelos se
            reparte entre ellos según sus ventas. Ganancia neta = ganancia (neto −
            costo) − ads.
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
                <th className="num">Venta por ads</th>
                <th className="num">Ganancia neta</th>
              </tr>
            </thead>
            <tbody>
              {p.filas.map((f) => (
                <tr key={f.modelo}>
                  <td className="font-medium">
                    {f.modelo}
                    {f.anuncios > 0 ? (
                      <span className="ml-1.5 text-[10px]" style={{ color: "var(--ink-muted)" }}>
                        {f.anuncios} {f.anuncios === 1 ? "anuncio" : "anuncios"}
                      </span>
                    ) : null}
                  </td>
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
                  <td className="num cifra">{f.gastoAds > 0 ? pesos(f.gastoAds) : "—"}</td>
                  <td className="num cifra font-semibold">
                    {f.gastoAds > 0 && f.costoPorUnidad != null
                      ? pesosFinos(f.costoPorUnidad)
                      : "—"}
                  </td>
                  <td className="num cifra" style={{ color: "var(--ink-2)" }}>
                    {f.gastoAds > 0 && f.tacos != null ? pct(f.tacos) : "—"}
                  </td>
                  <td className="num cifra" style={{ color: "var(--ink-2)" }}>
                    {f.ventaAds > 0 ? pesos(f.ventaAds) : "—"}
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
                  <td colSpan={9} className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>
                    Sin ventas ni anuncios en el periodo.
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

const COLOR_ACCION: Record<RecomendacionAds["accion"], string> = {
  pausar: "var(--estado-critico)",
  encender: "var(--exito-texto)",
  apagar: "var(--estado-critico)",
  bajar: "var(--estado-alerta)",
  subir: "var(--exito-texto)",
  activar: "var(--acento)",
};
