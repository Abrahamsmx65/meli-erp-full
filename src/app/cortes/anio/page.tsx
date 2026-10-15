import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { leerAnio, PRIMER_PERIODO_CORTES } from "@/lib/servicios/consolidado-cargar";
import { nombreDelPeriodo } from "@/lib/servicios/corte-meli";
import { ejercicioDeFecha, nombreEjercicio } from "@/lib/finanzas/cuenta";
import { fechaMx } from "@/lib/servicios/ventas-monitor";
import { Ficha } from "@/components/tiles";
import { Aviso, Cifras, Encabezado, Pagina, Seccion, SinCuenta, Tabla } from "@/components/ui/pagina";
import { Pestanas } from "@/components/ui/pestanas";

export const dynamic = "force-dynamic";

function redondo(x: number): string {
  return (x < 0 ? "-$" : "$") + Math.round(Math.abs(x)).toLocaleString("es-MX");
}
function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}
function pct(x: number | null | undefined): string {
  return x == null ? "—" : `${(x * 100).toFixed(1)}%`;
}
const colorGanancia = (g: number | null) => (g == null ? "var(--ink-muted)" : g < 0 ? "var(--critico-texto)" : "var(--exito-texto)");

/**
 * Cómo va el AÑO del negocio, de mayo a abril (dueño, 15-oct-2026: «ver cómo
 * va el año en total, mi cuenta es de mayo a abril»). Suma los estados de
 * resultados mensuales ya guardados: la pantalla solo lee doce renglones.
 */
export default async function AnioDelNegocio({ searchParams }: { searchParams: Promise<{ ejercicio?: string }> }) {
  const sp = await searchParams;
  const actual = ejercicioDeFecha(fechaMx(0));
  const primero = ejercicioDeFecha(`${PRIMER_PERIODO_CORTES}-01`);
  const pedido = Number(sp.ejercicio);
  const ejercicio = Number.isInteger(pedido) && pedido >= primero && pedido <= actual ? pedido : actual;

  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Año del negocio" />;

  const a = await leerAnio(supabase, cuenta, ejercicio);
  const t = a.total;
  const ejercicios: number[] = [];
  for (let e = actual; e >= primero; e--) ejercicios.push(e);
  const conDatos = a.meses.filter((m) => !m.sinDatos);
  const maxAbs = Math.max(1, ...conDatos.map((m) => Math.abs(m.utilidadNeta)));
  const faltantes = a.meses.filter((m) => m.sinDatos && m.periodo <= fechaMx(0).slice(0, 7));
  const enCurso = a.meses.find((m) => m.enCurso && !m.sinDatos);
  const perdieron = a.modelos.filter((m) => (m.ganancia ?? 0) < 0);

  return (
    <Pagina>
      <Encabezado
        ceja="Negocio"
        titulo="Año del negocio"
        descripcion={`${nombreEjercicio(ejercicio)}: calzado, fundas, Amazon y TikTok, mes por mes y en total.`}
        frescura={a.generadoEn}
        acciones={
          <Link href="/cortes" className="boton boton-borde boton-chico">
            Ver por mes
          </Link>
        }
        ayuda={
          <p>
            Suma el Estado de resultados de cada mes del ejercicio (mayo a abril). El mes en curso va con lo que lleva; un mes
            sin estado guardado no suma y se dice. Utilidad neta = lo que pagaron las plataformas − producto − publicidad −
            gastos de cada plataforma − gastos del negocio.
          </p>
        }
      />

      {ejercicios.length > 1 ? (
        <nav aria-label="Ejercicio" className="flex flex-wrap gap-1.5">
          {ejercicios.map((e) => {
            const activo = e === ejercicio;
            return (
              <Link
                key={e}
                href={`/cortes/anio?ejercicio=${e}`}
                aria-current={activo ? "page" : undefined}
                className="rounded-full border px-3 py-1 text-xs font-medium"
                style={activo ? { background: "var(--acento)", borderColor: "var(--acento)", color: "#fff" } : { borderColor: "var(--borde)", background: "var(--surface-1)" }}
              >
                {nombreEjercicio(e)}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {faltantes.length ? (
        <Aviso tono="info">
          Sin estado de resultados: {faltantes.map((m) => nombreDelPeriodo(m.periodo)).join(", ")}. Esos meses no suman
          {faltantes.some((m) => m.periodo < PRIMER_PERIODO_CORTES) ? " (el sistema lleva cortes desde enero 2026)" : ""}.
        </Aviso>
      ) : null}

      <Cifras columnas={4}>
        <Ficha
          titulo="Utilidad neta del año"
          valor={redondo(t.utilidadNeta)}
          nota={`${pct(t.margen)} de la venta · ${a.mesesConDatos} de ${a.mesesTranscurridos} meses${enCurso ? ` · ${nombreDelPeriodo(enCurso.periodo)} en curso` : ""}`}
          tono={t.utilidadNeta < 0 ? "critico" : "bien"}
        />
        <Ficha titulo="Venta bruta" valor={redondo(t.ventaBruta)} nota={`${n(t.unidades)} unidades`} />
        <Ficha
          titulo="Pagaron las plataformas"
          valor={redondo(t.neto)}
          nota={`producto ${redondo(t.costoProducto)} · publicidad ${redondo(t.publicidad)} · gastos ${redondo(t.gastosGenerales + t.gastosEmpresariales)}`}
        />
        <Ficha
          titulo="Promedio por mes cerrado"
          valor={a.promedioMensual == null ? "—" : redondo(a.promedioMensual)}
          nota={a.promedioMensual == null ? "Todavía no hay un mes cerrado con datos" : "Utilidad neta, sin el mes en curso"}
        />
      </Cifras>

      <Pestanas
        pestanas={[
          {
            id: "meses",
            titulo: "Mes por mes",
            contenido: (
              <Seccion titulo="Mes por mes" sinRelleno>
                <Tabla>
                  <table className="datos">
                    <thead>
                      <tr>
                        <th>Mes</th>
                        <th className="num">Unidades</th>
                        <th className="num">Venta bruta</th>
                        <th className="num">Pagaron</th>
                        <th className="num">Producto</th>
                        <th className="num">Publicidad</th>
                        <th className="num">Gastos plataforma</th>
                        <th className="num">Gastos negocio</th>
                        <th className="num">Utilidad neta</th>
                        <th className="num">Margen</th>
                        <th aria-label="Utilidad" style={{ width: 140 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {a.meses.map((m) => (
                        <tr key={m.periodo}>
                          <td>
                            <Link href={`/cortes?mes=${m.periodo}`} className="enlace">
                              {nombreDelPeriodo(m.periodo)}
                            </Link>
                            {m.enCurso ? <span className="chip ml-2 text-[10px]">en curso</span> : null}
                            {!m.sinDatos && !m.enCurso && !m.exacto ? <span className="chip ml-2 text-[10px]">preliminar</span> : null}
                          </td>
                          {m.sinDatos ? (
                            <td colSpan={10} className="texto-tenue">
                              {m.periodo > fechaMx(0).slice(0, 7) ? "Todavía no llega" : "Sin datos"}
                            </td>
                          ) : (
                            <>
                              <td className="num cifra">{n(m.unidades)}</td>
                              <td className="num cifra">{redondo(m.ventaBruta)}</td>
                              <td className="num cifra">{redondo(m.neto)}</td>
                              <td className="num cifra">{redondo(-m.costoProducto)}</td>
                              <td className="num cifra">{redondo(-m.publicidad)}</td>
                              <td className="num cifra">{redondo(-m.gastosGenerales)}</td>
                              <td className="num cifra">{redondo(-m.gastosEmpresariales)}</td>
                              <td className="num cifra" style={{ color: colorGanancia(m.utilidadNeta), fontWeight: 600 }}>
                                {redondo(m.utilidadNeta)}
                              </td>
                              <td className="num cifra">{pct(m.margen)}</td>
                              <td>
                                <div
                                  aria-hidden="true"
                                  style={{
                                    height: 8,
                                    borderRadius: 4,
                                    width: `${Math.round((Math.abs(m.utilidadNeta) / maxAbs) * 100)}%`,
                                    background: m.utilidadNeta < 0 ? "var(--estado-critico)" : "var(--acento)",
                                    opacity: m.enCurso ? 0.5 : 1,
                                  }}
                                />
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                      <tr style={{ fontWeight: 700 }}>
                        <td>Total del año</td>
                        <td className="num cifra">{n(t.unidades)}</td>
                        <td className="num cifra">{redondo(t.ventaBruta)}</td>
                        <td className="num cifra">{redondo(t.neto)}</td>
                        <td className="num cifra">{redondo(-t.costoProducto)}</td>
                        <td className="num cifra">{redondo(-t.publicidad)}</td>
                        <td className="num cifra">{redondo(-t.gastosGenerales)}</td>
                        <td className="num cifra">{redondo(-t.gastosEmpresariales)}</td>
                        <td className="num cifra" style={{ color: colorGanancia(t.utilidadNeta) }}>
                          {redondo(t.utilidadNeta)}
                        </td>
                        <td className="num cifra">{pct(t.margen)}</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </Tabla>
              </Seccion>
            ),
          },
          {
            id: "canales",
            titulo: "Por canal",
            contenido: (
              <Seccion titulo="Por canal" descripcion="Antes de los gastos del negocio, que no son de ninguna plataforma." sinRelleno>
                <Tabla>
                  <table className="datos">
                    <thead>
                      <tr>
                        <th>Canal</th>
                        <th className="num">Unidades</th>
                        <th className="num">Venta bruta</th>
                        <th className="num">Pagaron</th>
                        <th className="num">Producto</th>
                        <th className="num">Publicidad</th>
                        <th className="num">Gastos plataforma</th>
                        <th className="num">Utilidad</th>
                        <th className="num">Margen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.canales.map((k) => (
                        <tr key={k.canal}>
                          <td>
                            {k.nombre}
                            {k.mesesSinCalcular.length ? (
                              <span className="chip aviso-critico ml-2 text-[10px]">
                                sin calcular: {k.mesesSinCalcular.map(nombreDelPeriodo).join(", ")}
                              </span>
                            ) : null}
                          </td>
                          <td className="num cifra">{n(k.unidades)}</td>
                          <td className="num cifra">{redondo(k.ventaBruta)}</td>
                          <td className="num cifra">{redondo(k.neto)}</td>
                          <td className="num cifra">{redondo(-k.costoProducto)}</td>
                          <td className="num cifra">{redondo(-k.publicidad)}</td>
                          <td className="num cifra">{redondo(-k.gastosGenerales)}</td>
                          <td className="num cifra" style={{ color: colorGanancia(k.utilidadNeta), fontWeight: 600 }}>
                            {redondo(k.utilidadNeta)}
                          </td>
                          <td className="num cifra">{pct(k.margen)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td colSpan={7}>Gastos del negocio (nómina, rentas, fletes…)</td>
                        <td className="num cifra">{redondo(-t.gastosEmpresariales)}</td>
                        <td />
                      </tr>
                      <tr style={{ fontWeight: 700 }}>
                        <td colSpan={7}>Utilidad neta del año</td>
                        <td className="num cifra" style={{ color: colorGanancia(t.utilidadNeta) }}>
                          {redondo(t.utilidadNeta)}
                        </td>
                        <td className="num cifra">{pct(t.margen)}</td>
                      </tr>
                    </tbody>
                  </table>
                </Tabla>
              </Seccion>
            ),
          },
          {
            id: "categorias",
            titulo: "Por categoría",
            cuenta: a.categorias.length,
            contenido: (
              <Seccion titulo="Por categoría" sinRelleno>
                <Tabla>
                  <table className="datos">
                    <thead>
                      <tr>
                        <th>Categoría</th>
                        <th className="num">Unidades</th>
                        <th className="num">Venta</th>
                        <th className="num">Ganancia</th>
                        <th className="num">Por unidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.categorias.map((f) => (
                        <tr key={f.categoria}>
                          <td>
                            {f.categoria}
                            {f.parcial ? <span className="chip ml-2 text-[10px]">sin costo algún mes</span> : null}
                          </td>
                          <td className="num cifra">{n(f.unidades)}</td>
                          <td className="num cifra">{redondo(f.importe)}</td>
                          <td className="num cifra" style={{ color: colorGanancia(f.ganancia) }}>
                            {f.ganancia == null ? "—" : redondo(f.ganancia)}
                          </td>
                          <td className="num cifra">
                            {f.ganancia == null || !f.unidades ? "—" : redondo(f.ganancia / f.unidades)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Tabla>
              </Seccion>
            ),
          },
          {
            id: "modelos",
            titulo: "Por modelo",
            cuenta: a.modelos.length,
            alerta: perdieron.length > 0,
            contenido: (
              <Seccion
                titulo="Por modelo"
                descripcion={perdieron.length ? `${perdieron.length} modelos perdieron dinero en el año` : undefined}
                sinRelleno
              >
                <Tabla alta>
                  <table className="datos">
                    <thead>
                      <tr>
                        <th>Modelo</th>
                        <th>Categoría</th>
                        <th className="num">Unidades</th>
                        <th className="num">Venta</th>
                        <th className="num">Ganancia</th>
                        <th className="num">Por unidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.modelos.map((f) => (
                        <tr key={f.modelo}>
                          <td>
                            {f.modelo}
                            {f.parcial ? <span className="chip ml-2 text-[10px]">sin costo algún mes</span> : null}
                          </td>
                          <td>{f.categoria}</td>
                          <td className="num cifra">{n(f.unidades)}</td>
                          <td className="num cifra">{redondo(f.importe)}</td>
                          <td className="num cifra" style={{ color: colorGanancia(f.ganancia) }}>
                            {f.ganancia == null ? "—" : redondo(f.ganancia)}
                          </td>
                          <td className="num cifra">
                            {f.ganancia == null || !f.unidades ? "—" : redondo(f.ganancia / f.unidades)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Tabla>
              </Seccion>
            ),
          },
        ]}
      />
    </Pagina>
  );
}
