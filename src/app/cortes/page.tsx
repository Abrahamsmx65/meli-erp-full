import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { nombreDelPeriodo, periodoActual, periodoAnterior, periodoSiguiente, validarPeriodo } from "@/lib/servicios/corte-meli";
import { cargarConsolidado, listarCortesGenerales } from "@/lib/servicios/consolidado-cargar";
import { NOMBRE_CANAL, type Canal } from "@/lib/servicios/consolidado";
import { Ficha } from "@/components/tiles";
import { AccionesCorteGeneral } from "@/components/corte-general";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function pesos(x: number): string {
  return (x < 0 ? "-$" : "$") + Math.abs(x).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}
function pct(x: number | null): string {
  return x == null ? "—" : `${(x * 100).toFixed(1)}%`;
}
const colorGanancia = (g: number | null) => (g == null ? "var(--ink-muted)" : g < 0 ? "var(--estado-critico)" : "var(--exito-texto)");

/**
 * Corte general del mes: calzado + fundas + Amazon, con la ganancia total,
 * por categoría y por modelo, cargando a cada unidad su parte de los gastos
 * generales de su plataforma.
 */
export default async function CorteGeneral({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const sp = await searchParams;
  const periodo = validarPeriodo(sp.mes) ?? periodoActual();
  const hoy = periodoActual();
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Conecta Mercado Libre</h1>
      </div>
    );
  }
  const [cns, cortes] = await Promise.all([cargarConsolidado(supabase, cuenta, periodo), listarCortesGenerales(supabase, cuenta.id)]);
  const corteDelMes = cortes.find((c) => c.periodo === periodo) ?? null;
  const canales: Canal[] = cns.canales.map((k) => k.canal);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">Corte general</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Calzado y fundas en Mercado Libre y Amazon, todo junto. La publicidad se descuenta al modelo que la gastó; los
          gastos generales de cada plataforma (Full, FBA, colecta, devoluciones netas, otros cargos) se dividen entre las
          unidades vendidas en esa plataforma, así cada modelo y categoría carga su parte y la ganancia es la real.
        </p>
      </div>

      <div className="tarjeta flex flex-wrap items-center gap-3 p-3 text-sm">
        <Link href={`/cortes?mes=${periodoAnterior(periodo)}`} className="rounded-full border px-3 py-1 text-xs font-medium" style={{ borderColor: "var(--borde)" }}>
          ← {nombreDelPeriodo(periodoAnterior(periodo))}
        </Link>
        <span className="text-base font-semibold">{nombreDelPeriodo(periodo)}</span>
        {periodo < hoy ? (
          <Link href={`/cortes?mes=${periodoSiguiente(periodo)}`} className="rounded-full border px-3 py-1 text-xs font-medium" style={{ borderColor: "var(--borde)" }}>
            {nombreDelPeriodo(periodoSiguiente(periodo))} →
          </Link>
        ) : null}
        <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {cns.desde} → {cns.hasta}
        </span>
        <span className="ml-auto rounded-full px-3 py-1 text-xs font-semibold" style={cns.exacto ? { background: "var(--acento-suave)", color: "var(--exito-texto)" } : { background: "#fff4d6", color: "#8a5a00" }}>
          {cns.exacto ? "Exacto" : `${cns.avisos.length} avisos`}
        </span>
      </div>

      <AccionesCorteGeneral periodo={periodo} corteId={corteDelMes?.id ?? null} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Ficha titulo="Venta bruta" valor={pesos(cns.total.ventaBruta)} nota={`${n(cns.total.unidades)} unidades · ${n(cns.total.ordenes)} órdenes`} />
        <Ficha titulo="Neto depositado" valor={pesos(cns.total.neto)} nota={`${pct(cns.total.ventaBruta > 0 ? cns.total.neto / cns.total.ventaBruta : null)} de la venta`} />
        <Ficha titulo="Publicidad" valor={pesos(-cns.total.publicidad)} nota="por modelo + general" tono={cns.total.publicidad > 0 ? "alerta" : "neutro"} />
        <Ficha titulo="Gastos generales" valor={pesos(-cns.total.gastosGenerales)} nota="Full, FBA, devoluciones netas, otros" tono={cns.total.gastosGenerales > 0 ? "alerta" : "neutro"} />
        <Ficha titulo="Utilidad neta total" valor={pesos(cns.total.utilidadNeta)} nota={`${pct(cns.total.margenSobreVenta)} de la venta · ${cns.total.gananciaPorUnidad != null ? pesos(cns.total.gananciaPorUnidad) : "—"} por unidad`} tono={cns.total.utilidadNeta < 0 ? "critico" : "bien"} />
      </div>

      {/* ---- Por canal ---------------------------------------------------- */}
      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="text-base font-semibold">Por canal</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Cada plataforma con su neto, su costo, su publicidad y sus gastos generales divididos entre sus unidades.
          </p>
        </header>
        <div className="overflow-x-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>Concepto</th>
                {cns.canales.map((k) => (
                  <th key={k.canal} className="num">{k.nombre}</th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Unidades", (k) => n(k.unidades), n(cns.total.unidades)],
                  ["Venta bruta", (k) => pesos(k.ventaBruta), pesos(cns.total.ventaBruta)],
                  ["Neto depositado", (k) => pesos(k.neto), pesos(cns.total.neto)],
                  ["Costo de producto", (k) => pesos(-k.costoProducto), pesos(-cns.total.costoProducto)],
                  ["Utilidad bruta", (k) => pesos(k.utilidadBruta), pesos(cns.total.neto - cns.total.costoProducto)],
                  ["Publicidad por modelo", (k) => pesos(-k.adsPorModelo), ""],
                  ["Gastos generales", (k) => pesos(-k.gastosGenerales), pesos(-cns.total.gastosGenerales)],
                  ["Gasto general por unidad", (k) => pesos(k.cargoPorUnidad), ""],
                  ["Utilidad neta", (k) => pesos(k.utilidadNeta), pesos(cns.total.utilidadNeta)],
                  ["Margen sobre la venta", (k) => pct(k.margen), pct(cns.total.margenSobreVenta)],
                  ["Ganancia por unidad", (k) => (k.gananciaPorUnidad != null ? pesos(k.gananciaPorUnidad) : "—"), cns.total.gananciaPorUnidad != null ? pesos(cns.total.gananciaPorUnidad) : "—"],
                  ["Estado", (k) => (k.exacto ? "Exacto" : `${k.avisos.length} avisos`), cns.exacto ? "Exacto" : ""],
                ] as [string, (k: (typeof cns.canales)[number]) => string, string][]
              ).map(([concepto, f, total]) => {
                const fuerte = concepto === "Utilidad neta" || concepto === "Utilidad bruta";
                return (
                  <tr key={concepto} style={fuerte ? { background: "var(--surface-2)" } : undefined}>
                    <td className={fuerte ? "font-semibold" : ""}>{concepto}</td>
                    {cns.canales.map((k) => (
                      <td key={k.canal} className={`num cifra ${fuerte ? "font-semibold" : ""}`} style={concepto === "Utilidad neta" ? { color: colorGanancia(k.utilidadNeta) } : undefined}>
                        {f(k)}
                      </td>
                    ))}
                    <td className={`num cifra ${fuerte ? "font-semibold" : ""}`} style={concepto === "Utilidad neta" ? { color: colorGanancia(cns.total.utilidadNeta) } : undefined}>
                      {total}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t p-4 text-xs hairline" style={{ color: "var(--ink-2)" }}>
          <strong>Gastos generales por concepto:</strong>{" "}
          {cns.canales.flatMap((k) => k.gastos.map((g) => `${k.nombre}: ${g.concepto} ${pesos(g.monto)}`)).join(" · ") || "ninguno"}
        </div>
      </section>

      {/* ---- Por categoría ------------------------------------------------ */}
      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="text-base font-semibold">Por categoría</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Sumando los tres canales. Ganancia = neto − costo − publicidad − gastos generales repartidos.
          </p>
        </header>
        <div className="overflow-x-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>Categoría</th>
                <th className="num">Unidades</th>
                <th className="num">Venta</th>
                <th className="num">Neto</th>
                <th className="num">Costo</th>
                <th className="num">Publicidad</th>
                <th className="num">Gastos generales</th>
                <th className="num">Ganancia</th>
                {canales.map((k) => (
                  <th key={k} className="num">{NOMBRE_CANAL[k]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cns.porCategoria.map((k) => (
                <tr key={k.categoria}>
                  <td className="font-medium">{k.categoria}</td>
                  <td className="num cifra">{n(k.unidades)}</td>
                  <td className="num cifra">{pesos(k.importe)}</td>
                  <td className="num cifra">{pesos(k.neto)}</td>
                  <td className="num cifra">{k.costo == null ? "sin costo" : pesos(k.costo)}</td>
                  <td className="num cifra">{k.ads ? pesos(k.ads) : "—"}</td>
                  <td className="num cifra">{pesos(k.cargoGeneral)}</td>
                  <td className="num cifra font-semibold" style={{ color: colorGanancia(k.ganancia) }}>{k.ganancia == null ? "—" : pesos(k.ganancia)}</td>
                  {canales.map((c) => (
                    <td key={c} className="num cifra text-xs" style={{ color: "var(--ink-2)" }}>
                      {k.porCanal[c] ? `${n(k.porCanal[c]!.unidades)} u · ${k.porCanal[c]!.ganancia == null ? "—" : pesos(k.porCanal[c]!.ganancia!)}` : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Por modelo --------------------------------------------------- */}
      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="text-base font-semibold">Por modelo</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Un modelo que se vende en varios canales aparece una vez, con todo sumado. El Excel trae además una hoja por canal.
          </p>
        </header>
        <div className="max-h-[36rem] overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>Modelo</th>
                <th>Categoría</th>
                <th>Canales</th>
                <th className="num">Unidades</th>
                <th className="num">Venta</th>
                <th className="num">Neto</th>
                <th className="num">Costo</th>
                <th className="num">Publicidad</th>
                <th className="num">Gastos generales</th>
                <th className="num">Ganancia</th>
              </tr>
            </thead>
            <tbody>
              {cns.porModelo.map((m) => (
                <tr key={m.modelo}>
                  <td className="font-medium">{m.modelo}</td>
                  <td style={{ color: "var(--ink-2)" }}>{m.categoria}</td>
                  <td className="text-xs" style={{ color: "var(--ink-muted)" }}>{m.canales.map((c) => NOMBRE_CANAL[c].split(" ·")[0]).join(", ")}</td>
                  <td className="num cifra">{n(m.unidades)}</td>
                  <td className="num cifra">{pesos(m.importe)}</td>
                  <td className="num cifra">{pesos(m.neto)}</td>
                  <td className="num cifra" style={{ color: m.costo == null ? "var(--estado-alerta)" : undefined }}>{m.costo == null ? "sin costo" : pesos(m.costo)}</td>
                  <td className="num cifra">{m.ads ? pesos(m.ads) : "—"}</td>
                  <td className="num cifra">{pesos(m.cargoGeneral)}</td>
                  <td className="num cifra font-semibold" style={{ color: colorGanancia(m.ganancia) }}>{m.ganancia == null ? "—" : pesos(m.ganancia)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Avisos ------------------------------------------------------ */}
      <section className="tarjeta p-4">
        <h2 className="text-sm font-semibold">{cns.exacto ? "Corte exacto" : "Qué le falta al corte para ser exacto"}</h2>
        {cns.avisos.length ? (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {cns.avisos.map((a, i) => (
              <li key={i} className="flex gap-2">
                <span style={{ color: "var(--acento)" }}>•</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm" style={{ color: "var(--exito-texto)" }}>Los tres canales están completos.</p>
        )}
      </section>

      {/* ---- Guardados ---------------------------------------------------- */}
      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="text-base font-semibold">Cortes generales guardados</h2>
        </header>
        {cortes.length ? (
          <table className="datos">
            <thead>
              <tr>
                <th>Mes</th>
                <th>Hecho el</th>
                <th className="num">Venta bruta</th>
                <th className="num">Utilidad neta</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cortes.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">
                    <Link href={`/cortes?mes=${c.periodo}`} style={{ color: "var(--acento)" }}>{nombreDelPeriodo(c.periodo)}</Link>
                  </td>
                  <td className="cifra">{new Date(c.creadoEn).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="num cifra">{pesos(c.ventaBruta)}</td>
                  <td className="num cifra font-semibold" style={{ color: colorGanancia(c.utilidadNeta) }}>{pesos(c.utilidadNeta)}</td>
                  <td>{c.exacto ? "Exacto" : "Con pendientes"}</td>
                  <td className="num">
                    <a href={`/api/cortes/general/${c.id}/excel`} style={{ color: "var(--acento)" }}>Excel</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>Todavía no hay cortes generales guardados.</p>
        )}
      </section>
    </div>
  );
}
