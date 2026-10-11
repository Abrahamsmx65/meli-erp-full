import { clienteServidor } from "@/lib/supabase/server";
import { clienteAdmin } from "@/lib/supabase/admin";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { cargarCuenta } from "@/lib/servicios/cuenta";
import { Ficha } from "@/components/tiles";
import { MovimientosCuenta, RetirosSocios } from "@/components/cuenta";
import { Aviso, Cifras, Encabezado, Pagina, Seccion, SinCuenta, Tabla } from "@/components/ui/pagina";
import { Pestanas } from "@/components/ui/pestanas";

export const dynamic = "force-dynamic";

const pesos = (x: number, dec = 0) => "$" + x.toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const nombreMes = (m: string) => (/^\d{4}-\d{2}$/.test(m) ? `${MESES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}` : m);

/**
 * Cuenta con Rafa y socios (dueño, 11-oct-2026): la pestaña TOTAL del sheet
 * «Cuentas YAPANIZCEL» dentro del ERP. Lo que se transfiere a Rafa menos su
 * comisión, menos lo pagado por los contenedores, la comisión del agente y
 * los gastos en efectivo = la ganancia, repartida entre los socios contra lo
 * que cada uno ha retirado.
 */
export default async function Cuenta() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Cuenta con Rafa" />;
  const d = await cargarCuenta(supabase as DB, cuenta.id, clienteAdmin() as DB);
  const r = d.resumen;

  return (
    <Pagina>
      <Encabezado ceja="Negocio" titulo="Cuenta con Rafa" frescura={d.costeoEn} />
      {d.avisos.map((a, i) => (
        <Aviso key={i} tono="alerta">{a}</Aviso>
      ))}
      <Cifras columnas={4}>
        <Ficha titulo="Transferido a Rafa" valor={pesos(r.transferencias)} nota={`Comisión ${pesos(r.comision)}`} />
        <Ficha titulo="Recibido" valor={pesos(r.recibido)} />
        <Ficha titulo="Salidas" valor={pesos(r.totalSalidas)} />
        <Ficha titulo="Ganancia" valor={pesos(r.ganancia)} tono={r.ganancia >= 0 ? "bien" : "critico"} />
      </Cifras>
      <Pestanas
        pestanas={[
          {
            id: "resumen",
            titulo: "Resumen",
            contenido: (
              <div className="flex flex-col gap-4">
                <Seccion titulo="De dónde sale la ganancia" sinRelleno>
                  <Tabla>
                    <table className="datos">
                      <tbody>
                        <tr>
                          <td>Transferencias a Rafa</td>
                          <td className="num cifra">{pesos(r.transferencias, 2)}</td>
                        </tr>
                        <tr>
                          <td>− Comisión de Rafa (2/116)</td>
                          <td className="num cifra">{pesos(-r.comision, 2)}</td>
                        </tr>
                        <tr className="font-semibold">
                          <td>Recibido</td>
                          <td className="num cifra">{pesos(r.recibido, 2)}</td>
                        </tr>
                        {r.salidas.map((s) => (
                          <tr key={s.concepto}>
                            <td>− {s.concepto}</td>
                            <td className="num cifra">{pesos(-s.monto, 2)}</td>
                          </tr>
                        ))}
                        <tr className="font-semibold">
                          <td>Ganancia</td>
                          <td className="num cifra" style={{ color: r.ganancia >= 0 ? "var(--exito-texto)" : "var(--estado-critico)" }}>
                            {pesos(r.ganancia, 2)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </Tabla>
                </Seccion>
                <Seccion titulo="Socios" sinRelleno>
                  <Tabla>
                    <table className="datos">
                      <thead>
                        <tr>
                          <th>Socio</th>
                          <th className="num">%</th>
                          <th className="num">Le toca</th>
                          <th className="num">Retirado</th>
                          <th className="num">De eso, tsedaka</th>
                          <th className="num">Sobra</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.socios.map((s) => (
                          <tr key={s.socio.id}>
                            <td className="font-medium">{s.socio.nombre}</td>
                            <td className="num cifra">{s.socio.porcentaje}%</td>
                            <td className="num cifra">{pesos(s.leToca)}</td>
                            <td className="num cifra">{s.retiros ? pesos(s.retirado) : "—"}</td>
                            <td className="num cifra">{s.tsedaka ? pesos(s.tsedaka) : "—"}</td>
                            <td className="num cifra font-semibold" style={{ color: s.sobra >= 0 ? "var(--exito-texto)" : "var(--estado-critico)" }}>
                              {pesos(s.sobra)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Tabla>
                </Seccion>
              </div>
            ),
          },
          {
            id: "movimientos",
            titulo: "Movimientos",
            cuenta: d.movimientos.length,
            contenido: (
              <div className="flex flex-col gap-4">
                <Seccion>
                  <MovimientosCuenta movimientos={d.movimientos} />
                </Seccion>
                <div className="grid gap-4 md:grid-cols-2">
                  <Seccion titulo="Por mes" sinRelleno>
                    <Tabla>
                      <table className="datos">
                        <thead>
                          <tr>
                            <th>Mes</th>
                            <th className="num">Transferido</th>
                            <th className="num">Comisión</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.porMes.map((m) => (
                            <tr key={m.mes}>
                              <td>{nombreMes(m.mes)}</td>
                              <td className="num cifra">{pesos(m.transferido)}</td>
                              <td className="num cifra">{pesos(m.comision)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Tabla>
                  </Seccion>
                  <Seccion titulo="Por beneficiario" sinRelleno>
                    <Tabla>
                      <table className="datos">
                        <thead>
                          <tr>
                            <th>Beneficiario</th>
                            <th className="num">Movimientos</th>
                            <th className="num">Monto</th>
                            <th className="num">Comisión</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.porBeneficiario.map((b) => (
                            <tr key={b.beneficiario}>
                              <td>{b.beneficiario}</td>
                              <td className="num cifra">{b.movimientos}</td>
                              <td className="num cifra">{pesos(b.monto)}</td>
                              <td className="num cifra">{pesos(b.comision)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Tabla>
                  </Seccion>
                </div>
              </div>
            ),
          },
          {
            id: "retiros",
            titulo: "Retiros de socios",
            cuenta: d.retiros.length,
            contenido: (
              <Seccion>
                <RetirosSocios socios={d.socios} retiros={d.retiros} />
              </Seccion>
            ),
          },
        ]}
      />
    </Pagina>
  );
}
