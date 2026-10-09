import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { nombreDelPeriodo, periodoActual, periodoAnterior, validarPeriodo } from "@/lib/servicios/corte-meli";
import { leerConsolidadoGuardado, leerMismosDiasGuardado, listarCortesGenerales, obtenerConsolidado, periodosDesde, PRIMER_PERIODO_CORTES } from "@/lib/servicios/consolidado-cargar";
import { compararMeses } from "@/lib/servicios/consolidado-comparar";
import { fechaMx } from "@/lib/servicios/ventas-monitor";
import { ComparacionMensualVista } from "@/components/comparacion-mensual";
import { NOMBRE_CANAL, adsPorModeloTotal, repartosPorUnidad, type Canal } from "@/lib/servicios/consolidado";
import { CANAL_CORTO, avisosParaMostrar, cascadaDelMes, estadoDelCorte, loQuePaso, repartoDelPeso } from "@/lib/servicios/consolidado-informe";
import { Ficha } from "@/components/tiles";
import { AccionesCorteGeneral } from "@/components/corte-general";
import { CascadaVista, RepartoPesoVista } from "@/components/corte-general-graficas";
import { Aviso, Cifras, Encabezado, Pagina, Seccion, SinCuenta, Tabla } from "@/components/ui/pagina";
import { Pestanas } from "@/components/ui/pestanas";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function pesos(x: number): string {
  return (x < 0 ? "-$" : "$") + Math.abs(x).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function redondo(x: number): string {
  return (x < 0 ? "-$" : "$") + Math.round(Math.abs(x)).toLocaleString("es-MX");
}
function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}
function pct(x: number | null | undefined): string {
  return x == null ? "—" : `${(x * 100).toFixed(1)}%`;
}
/** Un reparto por unidad; sin unidades, raya. */
function unidad(x: number | null | undefined): string {
  return x == null ? "—" : pesos(x);
}
const colorGanancia = (g: number | null) => (g == null ? "var(--ink-muted)" : g < 0 ? "var(--critico-texto)" : "var(--exito-texto)");

/**
 * Corte general del mes: calzado + fundas + Amazon + TikTok, con la ganancia
 * total, por canal, por categoría y por modelo, cargando a cada unidad su
 * parte de los gastos de su plataforma.
 *
 * Orden de lectura (dueño, 9-oct-2026: «ordenar la info de una manera más
 * legible y coherente»): primero si el corte es confiable y la utilidad;
 * luego, con palabras y dos gráficas, de dónde salió; y el detalle por
 * canal, categoría y modelo en sus pestañas. Lo que falta se separa entre
 * lo que pide acción, lo que llega solo y lo que solo explica.
 */
export default async function CorteGeneral({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const sp = await searchParams;
  const periodo = validarPeriodo(sp.mes) ?? periodoActual();
  const hoy = periodoActual();
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Estado de resultados" />;
  // El consolidado vive en consolidado_cache (10 min): correr los cuatro
  // canales completos en cada visita costaba hasta 300 s de función.
  const [cns, cortes, anterior, mismosDias] = await Promise.all([
    obtenerConsolidado(supabase, cuenta, periodo),
    listarCortesGenerales(supabase, cuenta.id),
    // El mes anterior (completo y cortado a los mismos días) solo se LEE:
    // lo calcula el cron, nunca el clic.
    leerConsolidadoGuardado(supabase, cuenta, periodoAnterior(periodo)),
    leerMismosDiasGuardado(supabase, cuenta, periodo),
  ]);
  const comparacion = anterior ? compararMeses(cns, anterior, fechaMx(0), mismosDias) : null;
  const corteDelMes = cortes.find((c) => c.periodo === periodo) ?? null;
  const calculables = cns.canales.filter((k) => k.calculable !== false);
  const canales: Canal[] = calculables.map((k) => k.canal);
  const repartos = repartosPorUnidad(cns);
  const estado = estadoDelCorte(cns);
  const avisos = avisosParaMostrar(cns);
  const frases = loQuePaso(cns, comparacion);
  const t = cns.total;
  const adsModelo = adsPorModeloTotal(cns);
  const gastoAparte = adsModelo + t.gastosGenerales;
  const modelosPorGanancia = [...cns.porModelo].sort((a, b) => (b.ganancia ?? -Infinity) - (a.ganancia ?? -Infinity));
  const perdieron = cns.porModelo.filter((m) => (m.ganancia ?? 0) < 0).length;

  const tonoEstado = estado.estado === "definitivo" ? "bien" : estado.estado === "preliminar" ? "info" : "alerta";

  return (
    <Pagina>
      <Encabezado
        ceja="Negocio"
        titulo="Estado de resultados"
        descripcion="La ganancia real del mes de calzado, fundas, Amazon y TikTok."
        frescura={cns.generadoEn}
        acciones={<AccionesCorteGeneral periodo={periodo} corteId={corteDelMes?.id ?? null} />}
        ayuda={
          <>
            <p>
              Es el estado al día de hoy: puede cambiar mientras Mercado Pago, Amazon o TikTok terminan de asentar cargos.
              «Hacer corte» lo congela con su informe en PDF; rehacerlo reemplaza el del mismo mes.
            </p>
            <p>
              Venta bruta = lo que pagaron los clientes. Neto de plataforma = lo que de verdad depositaron (o TikTok dice que
              pagará), ya sin comisión, envío ni retenciones. Utilidad = neto − costo del producto − publicidad − gastos de la
              plataforma.
            </p>
            <p>
              La publicidad se descuenta al modelo que la gastó. Los gastos generales de cada plataforma (Full, FBA, colecta,
              devoluciones netas, otros cargos) se dividen entre las unidades vendidas en esa plataforma, así cada modelo y
              categoría carga su parte.
            </p>
          </>
        }
      />

      {/* Todos los meses a la vista (dueño, 25-sep-2026: «elegir, no pasar de mes en mes»). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <nav aria-label="Mes del corte" className="flex flex-wrap gap-1.5">
          {periodosDesde(PRIMER_PERIODO_CORTES, hoy).map((p) => {
            const activo = p === periodo;
            return (
              <Link
                key={p}
                href={`/cortes?mes=${p}`}
                aria-current={activo ? "page" : undefined}
                className="rounded-full border px-3 py-1 text-xs font-medium capitalize"
                style={activo ? { background: "var(--acento)", borderColor: "var(--acento)", color: "#fff" } : { borderColor: "var(--borde)", background: "var(--surface-1)" }}
              >
                {nombreDelPeriodo(p)}
              </Link>
            );
          })}
        </nav>
        <span className="texto-tenue text-xs">
          {cns.desde} → {cns.hasta}
          {corteDelMes ? ` · corte guardado el ${new Date(corteDelMes.creadoEn).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short" })}` : " · sin corte guardado"}
        </span>
      </div>

      <Aviso tono={tonoEstado} titulo={estado.etiqueta}>
        {estado.explicacion}
        {estado.acciones + estado.pendientes > 0 ? (
          <>
            {" "}
            <a href={`/cortes?mes=${periodo}&pestana=falta`} className="enlace">
              Ver qué falta
            </a>
          </>
        ) : null}
      </Aviso>

      {t.ventaSinCalcular > 0 ? (
        <Aviso tono="critico">
          {pesos(t.ventaSinCalcular)} de venta de {t.canalesSinCalcular.map((k) => CANAL_CORTO[k]).join(", ")} quedó FUERA del total: no hay neto leído para ese canal.
        </Aviso>
      ) : null}

      <Cifras columnas={4}>
        <Ficha titulo="Venta bruta" valor={redondo(t.ventaBruta)} nota={`${n(t.unidades)} unidades · ${n(t.ordenes)} órdenes`} />
        <Ficha titulo="Pagaron las plataformas" valor={redondo(t.neto)} nota={`${pct(t.ventaBruta ? t.neto / t.ventaBruta : null)} de la venta, ya sin comisión, envío ni retenciones`} />
        <Ficha
          titulo="Producto, publicidad y gastos"
          valor={redondo(-(t.costoProducto + gastoAparte + t.gastosEmpresariales))}
          nota={`producto ${redondo(t.costoProducto)} · publicidad ${redondo(adsModelo)} · gastos ${redondo(t.gastosGenerales + t.gastosEmpresariales)}`}
        />
        <Ficha
          titulo="Utilidad neta"
          valor={redondo(t.utilidadNeta)}
          nota={`${pct(t.margenSobreVenta)} de la venta · ${t.gananciaPorUnidad != null ? pesos(t.gananciaPorUnidad) : "—"} por unidad`}
          tono={t.utilidadNeta < 0 ? "critico" : "bien"}
        />
      </Cifras>

      <Pestanas
        pestanas={[
          {
            id: "resumen",
            titulo: "Resumen",
            contenido: (
              <>
                <Seccion titulo="Lo que pasó en el mes">
                  <ul className="flex flex-col gap-2 text-sm">
                    {frases.map((f, i) => (
                      <li key={i} className="flex gap-2">
                        <span aria-hidden style={{ color: "var(--acento)" }}>•</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </Seccion>

                <div className="grid gap-4 xl:grid-cols-2">
                  <Seccion titulo="De la venta a la utilidad">
                    <CascadaVista pasos={cascadaDelMes(cns)} />
                  </Seccion>
                  <Seccion titulo="A dónde se fue cada peso" descripcion="De cada $100 que pagaron los clientes, por canal.">
                    <RepartoPesoVista filas={repartoDelPeso(cns)} />
                  </Seccion>
                </div>

                {comparacion ? (
                  <ComparacionMensualVista comp={comparacion} nombreActual={nombreDelPeriodo(periodo)} nombreAnterior={nombreDelPeriodo(periodoAnterior(periodo))} />
                ) : (
                  <p className="text-xs texto-tenue">
                    Sin comparación contra {nombreDelPeriodo(periodoAnterior(periodo))} (aún no calculado).
                  </p>
                )}

                <Seccion
                  titulo="Gastos empresariales"
                  descripcion={t.gastosEmpresariales ? `${pesos(t.gastosEmpresariales)} descontados del total` : undefined}
                  acciones={<Link className="boton boton-fantasma boton-chico" href={`/gastos?mes=${periodo}`}>Editar en Gastos</Link>}
                  sinRelleno
                >
                  {(cns.gastosEmpresariales ?? []).length ? (
                    <Tabla>
                      <table className="datos">
                        <thead><tr><th>Categoría</th><th>Concepto</th><th className="num">Del mes</th><th className="num">Contado</th></tr></thead>
                        <tbody>
                          {(cns.gastosEmpresariales ?? []).map((g) => (
                            <tr key={g.id}>
                              <td>{g.categoria}</td>
                              <td>{g.concepto}</td>
                              <td className="num cifra">{pesos(g.montoMes ?? g.monto)}</td>
                              <td className="num cifra">{pesos(g.monto)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Tabla>
                  ) : (
                    <p className="p-4 text-sm texto-2">Sin gastos empresariales en este mes.</p>
                  )}
                </Seccion>
              </>
            ),
          },
          {
            id: "canal",
            titulo: "Por canal",
            cuenta: cns.canales.length,
            contenido: (
              <>
                <Cifras columnas={4}>
                  {calculables.map((k) => (
                    <Ficha
                      key={k.canal}
                      titulo={CANAL_CORTO[k.canal]}
                      valor={redondo(k.utilidadNeta)}
                      nota={`${pct(k.margen)} de ${redondo(k.ventaBruta)} · ${k.gananciaPorUnidad != null ? pesos(k.gananciaPorUnidad) : "—"} por unidad · ${t.utilidadAntesGastosEmpresariales > 0 ? pct(k.utilidadNeta / t.utilidadAntesGastosEmpresariales) : "—"} de la utilidad`}
                      tono={k.utilidadNeta < 0 ? "critico" : "neutro"}
                    />
                  ))}
                </Cifras>

                <Seccion
                  titulo="Estado de resultados por canal"
                  sinRelleno
                  ayuda={<p>El neto sale de la fuente de cada canal (renglón «Fuente»). Las deducciones ya vienen descontadas del neto y no se restan dos veces. «Otros cargos y ajustes» incluye los reembolsos que la plataforma ya descontó al depositar.</p>}
                >
                  <Tabla>
                    <table className="datos">
                      <thead>
                        <tr>
                          <th>Concepto</th>
                          {cns.canales.map((k) => (
                            <th key={k.canal} className="num">
                              {CANAL_CORTO[k.canal]}
                              {k.calculable === false ? <span className="chip aviso-critico ml-1 text-[10px]">no calculable</span> : null}
                            </th>
                          ))}
                          <th className="num">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(
                          [
                            ["grupo", "Venta"],
                            ["Unidades", (k) => n(k.unidades), n(t.unidades)],
                            ["Venta bruta", (k) => pesos(k.ventaBruta), pesos(t.ventaBruta), "fuerte"],
                            ["grupo", "Se quedó la plataforma"],
                            ["Comisión", (k) => pesos(-k.desglosePlataforma.comision), pesos(-t.comision)],
                            ["Envío y logística", (k) => pesos(-k.desglosePlataforma.envio), pesos(-t.envio)],
                            ["Retenciones ISR + IVA", (k) => pesos(-(k.desglosePlataforma.isr + k.desglosePlataforma.iva)), pesos(-(t.isr + t.iva))],
                            [
                              "Otros cargos y ajustes",
                              (k) => pesos(k.neto - k.ventaBruta + k.desglosePlataforma.comision + k.desglosePlataforma.envio + k.desglosePlataforma.isr + k.desglosePlataforma.iva),
                              pesos(t.neto - t.ventaBruta + t.comision + t.envio + t.isr + t.iva),
                            ],
                            ["Neto de plataforma", (k) => pesos(k.neto), pesos(t.neto), "fuerte"],
                            ["Fuente", (k) => k.fuenteNeto, ""],
                            ["grupo", "Costos y gastos"],
                            ["Costo del producto", (k) => pesos(-k.costoProducto), pesos(-t.costoProducto)],
                            ["Publicidad por modelo", (k) => pesos(-k.adsPorModelo), pesos(-adsModelo)],
                            ["Gastos de plataforma", (k) => pesos(-k.gastosGenerales), pesos(-t.gastosGenerales)],
                            ["grupo", "Resultado"],
                            ["Utilidad", (k) => pesos(k.utilidadNeta), pesos(t.utilidadAntesGastosEmpresariales), "fuerte"],
                            ...(t.gastosEmpresariales
                              ? ([
                                  ["Gastos empresariales", () => "—", pesos(-t.gastosEmpresariales)],
                                  ["Utilidad neta final", () => "—", pesos(t.utilidadNeta), "fuerte"],
                                ] as const)
                              : []),
                            ["Margen sobre la venta", (k) => pct(k.margen), pct(t.margenSobreVenta)],
                            ["Utilidad por unidad", (k) => (k.gananciaPorUnidad != null ? pesos(k.gananciaPorUnidad) : "—"), t.gananciaPorUnidad != null ? pesos(t.gananciaPorUnidad) : "—"],
                            ["grupo", "Por unidad vendida"],
                            ["Publicidad", (k) => unidad(repartos.canal[k.canal]?.publicidad), unidad(repartos.total.publicidad)],
                            ["Gastos de plataforma", (k) => unidad(repartos.canal[k.canal]?.general), unidad(repartos.total.general)],
                            ["Publicidad + gastos", (k) => unidad(repartos.canal[k.canal]?.ambos), unidad(repartos.total.ambos)],
                          ] as ([string, string] | readonly [string, (k: (typeof cns.canales)[number]) => string, string, string?])[]
                        ).map((r, i) => {
                          if (r[0] === "grupo") {
                            return (
                              <tr key={`g${i}`}>
                                <td colSpan={cns.canales.length + 2} className="text-[11px] font-semibold uppercase tracking-wide texto-tenue" style={{ background: "var(--surface-2)" }}>
                                  {r[1] as string}
                                </td>
                              </tr>
                            );
                          }
                          const [concepto, f, total, estilo] = r as readonly [string, (k: (typeof cns.canales)[number]) => string, string, string?];
                          const fuerte = estilo === "fuerte";
                          const siempre = concepto === "Unidades" || concepto === "Venta bruta" || concepto === "Fuente";
                          return (
                            <tr key={`${concepto}${i}`}>
                              <td className={fuerte ? "font-semibold" : ""}>{concepto}</td>
                              {cns.canales.map((k) => (
                                <td
                                  key={k.canal}
                                  className={`num ${concepto === "Fuente" ? "text-xs texto-tenue" : "cifra"} ${fuerte ? "font-semibold" : ""}`}
                                  style={concepto === "Utilidad" && k.calculable !== false ? { color: colorGanancia(k.utilidadNeta) } : undefined}
                                >
                                  {k.calculable === false && !siempre ? "—" : f(k)}
                                </td>
                              ))}
                              <td className={`num cifra ${fuerte ? "font-semibold" : ""}`} style={concepto.startsWith("Utilidad neta final") || (concepto === "Utilidad" && !t.gastosEmpresariales) ? { color: colorGanancia(t.utilidadNeta) } : undefined}>
                                {total}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </Tabla>
                </Seccion>

              </>
            ),
          },
          {
            id: "gastos",
            titulo: "Gastos generales",
            cuenta: cns.canales.reduce((a, k) => a + k.gastos.length, 0) || null,
            contenido: (
              <>
                <Seccion titulo="Gastos generales por canal" sinRelleno>
                  {cns.canales.every((k) => k.gastos.length === 0) ? (
                    <p className="p-4 text-sm texto-2">Sin gastos generales registrados.</p>
                  ) : (
                    <Tabla>
                      <table className="datos">
                        <thead>
                          <tr>
                            <th>Concepto</th>
                            <th className="num">Monto</th>
                            <th className="num">Por unidad</th>
                          </tr>
                        </thead>
                        <tbody>
                          {calculables
                            .filter((k) => k.gastos.length > 0)
                            .flatMap((k) => [
                              <tr key={`g-${k.canal}`}>
                                <td colSpan={3} className="text-[11px] font-semibold uppercase tracking-wide texto-tenue" style={{ background: "var(--surface-2)" }}>
                                  {CANAL_CORTO[k.canal]} · {n(k.unidades)} unidades
                                </td>
                              </tr>,
                              ...[...k.gastos]
                                .sort((x, y) => y.monto - x.monto)
                                .map((g) => (
                                  <tr key={`${k.canal}-${g.concepto}`}>
                                    <td>{g.concepto.replace(/^(Amazon|TikTok) · /, "")}</td>
                                    <td className="num cifra">{pesos(g.monto)}</td>
                                    <td className="num cifra texto-2">{unidad(k.unidades ? g.monto / k.unidades : null)}</td>
                                  </tr>
                                )),
                              <tr key={`t-${k.canal}`}>
                                <td className="font-semibold">Total {CANAL_CORTO[k.canal]}</td>
                                <td className="num cifra font-semibold">{pesos(k.gastosGenerales)}</td>
                                <td className="num cifra font-semibold">{unidad(repartos.canal[k.canal]?.general)}</td>
                              </tr>,
                            ])}
                          <tr style={{ background: "var(--acento-suave)" }}>
                            <td className="font-semibold">Total gastos generales</td>
                            <td className="num cifra font-semibold">{pesos(t.gastosGenerales)}</td>
                            <td className="num cifra font-semibold">{unidad(repartos.total.general)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </Tabla>
                  )}
                </Seccion>
              </>
            ),
          },
          {
            id: "categoria",
            titulo: "Por categoría",
            cuenta: cns.porCategoria.length,
            contenido: (
              <Seccion
                titulo="Por categoría"
                sinRelleno
                ayuda={<p>Ganancia = neto − costo − publicidad − su parte de los gastos de plataforma. El desglose de comisión, envío y retenciones está en el Excel.</p>}
              >
                <Tabla>
                  <table className="datos">
                    <thead>
                      <tr>
                        <th>Categoría</th>
                        <th className="num">Unidades</th>
                        <th className="num">Venta</th>
                        <th className="num">Neto</th>
                        <th className="num">Costo</th>
                        <th className="num">Publicidad</th>
                        <th className="num">Gastos</th>
                        <th className="num">Ganancia</th>
                        <th className="num">Margen</th>
                        <th className="num">Por unidad</th>
                        {canales.map((k) => (
                          <th key={k} className="num">{CANAL_CORTO[k]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...cns.porCategoria]
                        .sort((a, b) => (b.ganancia ?? -Infinity) - (a.ganancia ?? -Infinity))
                        .map((k) => (
                          <tr key={k.categoria}>
                            <td className="font-medium">{k.categoria}</td>
                            <td className="num cifra">{n(k.unidades)}</td>
                            <td className="num cifra">{redondo(k.importe)}</td>
                            <td className="num cifra">{redondo(k.neto)}</td>
                            <td className="num cifra">{k.costo == null ? "sin costo" : redondo(k.costo)}</td>
                            <td className="num cifra">{k.ads ? redondo(k.ads) : "—"}</td>
                            <td className="num cifra">{redondo(k.cargoGeneral)}</td>
                            <td className="num cifra font-semibold" style={{ color: colorGanancia(k.ganancia) }}>{k.ganancia == null ? "—" : redondo(k.ganancia)}</td>
                            <td className="num cifra">{k.ganancia == null || !k.importe ? "—" : pct(k.ganancia / k.importe)}</td>
                            <td className="num cifra">{k.ganancia == null || !k.unidades ? "—" : pesos(k.ganancia / k.unidades)}</td>
                            {canales.map((c) => (
                              <td key={c} className="num cifra text-xs texto-2">
                                {k.porCanal[c] ? `${n(k.porCanal[c]!.unidades)} u · ${k.porCanal[c]!.ganancia == null ? "—" : redondo(k.porCanal[c]!.ganancia!)}` : "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </Tabla>
              </Seccion>
            ),
          },
          {
            id: "modelo",
            titulo: "Por modelo",
            cuenta: cns.porModelo.length,
            contenido: (
              <Seccion
                titulo="Por modelo"
                descripcion={perdieron ? `${perdieron} modelos perdieron dinero` : undefined}
                sinRelleno
              >
                <div className="max-h-[40rem] overflow-auto">
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
                        <th className="num">Gastos</th>
                        <th className="num">Ganancia</th>
                        <th className="num">Margen</th>
                        <th className="num">Por unidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modelosPorGanancia.map((m) => (
                        <tr key={m.modelo}>
                          <td className="font-medium">{m.modelo}</td>
                          <td className="texto-2">{m.categoria}</td>
                          <td className="text-xs texto-tenue">{m.canales.map((c) => CANAL_CORTO[c] ?? NOMBRE_CANAL[c]).join(", ")}</td>
                          <td className="num cifra">{n(m.unidades)}</td>
                          <td className="num cifra">{redondo(m.importe)}</td>
                          <td className="num cifra">{redondo(m.neto)}</td>
                          <td className="num cifra" style={{ color: m.costo == null ? "var(--alerta-texto)" : undefined }}>{m.costo == null ? "sin costo" : redondo(m.costo)}</td>
                          <td className="num cifra">{m.ads ? redondo(m.ads) : "—"}</td>
                          <td className="num cifra">{redondo(m.cargoGeneral)}</td>
                          <td className="num cifra font-semibold" style={{ color: colorGanancia(m.ganancia) }}>{m.ganancia == null ? "—" : redondo(m.ganancia)}</td>
                          <td className="num cifra">{m.ganancia == null || !m.importe ? "—" : pct(m.ganancia / m.importe)}</td>
                          <td className="num cifra">{m.ganancia == null || !m.unidades ? "—" : pesos(m.ganancia / m.unidades)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Seccion>
            ),
          },
          {
            id: "falta",
            titulo: "Qué falta",
            cuenta: estado.acciones || null,
            alerta: estado.acciones > 0,
            contenido: (
              <>
                <Seccion titulo="Pide acción">
                  {avisos.sinCosto.length + avisos.acciones.length === 0 ? (
                    <p className="text-sm texto-2">Nada pendiente de tu lado.</p>
                  ) : (
                    <ul className="flex flex-col gap-2 text-sm">
                      {avisos.sinCosto.map((s) => (
                        <li key={`sc-${s.canal}`} className="flex gap-2">
                          <span aria-hidden style={{ color: "var(--critico-texto)" }}>●</span>
                          <span>
                            <span className="font-semibold">{s.nombre}:</span> {n(s.unidades)} unidades de {s.modelos.length} modelo(s) sin costo ({s.modelos.slice(0, 8).join(", ")}
                            {s.modelos.length > 8 ? "…" : ""}). Su neto ({pesos(s.neto)}) entra a la utilidad sin restarle costo.{" "}
                            <Link href="/productos" className="enlace">Capturar en Productos y costos</Link>
                          </span>
                        </li>
                      ))}
                      {avisos.acciones.map((a, i) => (
                        <li key={`a-${i}`} className="flex gap-2">
                          <span aria-hidden style={{ color: "var(--critico-texto)" }}>●</span>
                          <span>
                            <span className="font-semibold">{a.origen}:</span> {a.texto}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Seccion>
                {avisos.pendientes.length ? (
                  <Seccion titulo="Llega solo">
                    <ul className="flex flex-col gap-2 text-sm">
                      {avisos.pendientes.map((a, i) => (
                        <li key={`p-${i}`} className="flex gap-2">
                          <span aria-hidden style={{ color: "var(--alerta-texto)" }}>◷</span>
                          <span>
                            <span className="font-semibold">{a.origen}:</span> {a.texto}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Seccion>
                ) : null}
                {avisos.notas.length ? (
                  <Seccion titulo="Notas">
                    <ul className="flex flex-col gap-2 text-sm texto-2">
                      {avisos.notas.map((a, i) => (
                        <li key={`n-${i}`} className="flex gap-2">
                          <span aria-hidden className="texto-tenue">•</span>
                          <span>
                            <span className="font-medium">{a.origen}:</span> {a.texto}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Seccion>
                ) : null}
              </>
            ),
          },
          {
            id: "guardados",
            titulo: "Cortes guardados",
            cuenta: cortes.length,
            contenido: (
              <Seccion titulo="Cortes guardados" sinRelleno>
                {cortes.length ? (
                  <Tabla>
                    <table className="datos">
                      <thead>
                        <tr>
                          <th>Mes</th>
                          <th>Hecho el</th>
                          <th className="num">Venta bruta</th>
                          <th className="num">Utilidad neta</th>
                          <th>Estado</th>
                          <th className="num">Descargar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cortes.map((c) => (
                          <tr key={c.id}>
                            <td className="font-medium capitalize">
                              <Link href={`/cortes?mes=${c.periodo}`} className="enlace">{nombreDelPeriodo(c.periodo)}</Link>
                            </td>
                            <td className="cifra">{new Date(c.creadoEn).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                            <td className="num cifra">{redondo(c.ventaBruta)}</td>
                            <td className="num cifra font-semibold" style={{ color: colorGanancia(c.utilidadNeta) }}>{redondo(c.utilidadNeta)}</td>
                            <td>{c.exacto ? "Exacto" : "Con pendientes"}</td>
                            <td className="num whitespace-nowrap">
                              <a href={`/api/cortes/general/${c.id}/pdf`} className="enlace" target="_blank" rel="noreferrer">Ver PDF</a>
                              {" · "}
                              <a href={`/api/cortes/general/${c.id}/pdf?descargar=1`} className="enlace" download>Descargar PDF</a>
                              {" · "}
                              <a href={`/api/cortes/general/${c.id}/excel`} className="enlace">Excel</a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Tabla>
                ) : (
                  <p className="p-4 text-sm texto-2">Todavía no hay cortes generales guardados.</p>
                )}
              </Seccion>
            ),
          },
        ]}
      />
    </Pagina>
  );
}
