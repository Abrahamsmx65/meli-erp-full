import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { listarGastosEmpresariales } from "@/lib/servicios/gastos-empresariales";
import { CATEGORIAS_GASTO, finDelMes, listarGastosFijos, mesSiguiente } from "@/lib/servicios/gastos-fijos";
import { nombreDelPeriodo, periodoActual, validarPeriodo } from "@/lib/servicios/corte-meli";
import { Ficha } from "@/components/tiles";
import { GastosDelMes, GastosFijosVista } from "@/components/gastos";
import { Cifras, Encabezado, Pagina, Seccion, SinCuenta, Tabla } from "@/components/ui/pagina";
import { Pestanas } from "@/components/ui/pestanas";

export const dynamic = "force-dynamic";

function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

/**
 * Gastos empresariales (dueño, 9-oct-2026): nómina, fletes, renta,
 * logística 3PL… La mayoría se repite cada mes, así que se dan de alta UNA
 * vez como gasto fijo y cada mes aparecen solos; aquí se corrige el monto de
 * un mes, se omite, o se agrega un gasto suelto. El Estado de resultados los
 * descuenta del total del negocio (no se reparten por canal ni por modelo) y,
 * en el mes en curso, cuenta los fijos en proporción a los días transcurridos.
 */
export default async function Gastos({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const sp = await searchParams;
  const mesActual = periodoActual();
  const periodo = validarPeriodo(sp.mes) ?? mesActual;
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Gastos" />;

  const [fijos, gastos] = await Promise.all([
    listarGastosFijos(supabase, cuenta.id),
    listarGastosEmpresariales(supabase, cuenta.id, `${periodo}-01`, finDelMes(periodo)),
  ]);
  // Fijos primero (por categoría), luego los sueltos por fecha.
  gastos.sort((a, b) =>
    (a.fijoId == null ? 1 : 0) - (b.fijoId == null ? 1 : 0) ||
    a.categoria.localeCompare(b.categoria, "es") ||
    b.fecha.localeCompare(a.fecha),
  );

  const delMes = gastos.reduce((s, g) => s + (g.montoMes ?? g.monto), 0);
  const aHoy = gastos.reduce((s, g) => s + g.monto, 0);
  const fijosMes = gastos.filter((g) => g.fijoId != null).reduce((s, g) => s + (g.montoMes ?? g.monto), 0);
  const sueltos = delMes - fijosMes;
  const porCategoria = new Map<string, number>();
  for (const g of gastos) porCategoria.set(g.categoria, (porCategoria.get(g.categoria) ?? 0) + (g.montoMes ?? g.monto));
  const categorias = [...porCategoria.entries()].sort((a, b) => b[1] - a[1]);
  const enCurso = periodo === mesActual;
  const siguiente = mesSiguiente(periodo);

  return (
    <Pagina>
      <Encabezado
        ceja="Negocio"
        titulo="Gastos"
        acciones={
          <div className="flex items-center gap-2">
            <Link className="boton boton-fantasma boton-chico" href={`/gastos?mes=${mesSiguiente(periodo, -1)}`}>←</Link>
            <span className="text-sm font-medium">{nombreDelPeriodo(periodo)}</span>
            {siguiente <= mesActual ? (
              <Link className="boton boton-fantasma boton-chico" href={`/gastos?mes=${siguiente}`}>→</Link>
            ) : null}
          </div>
        }
      />
      <Cifras columnas={4}>
        <Ficha titulo={`Gastos de ${nombreDelPeriodo(periodo)}`} valor={pesos(delMes)} nota={`${gastos.length} conceptos`} />
        <Ficha titulo="Fijos" valor={pesos(fijosMes)} />
        <Ficha titulo="Sueltos" valor={pesos(sueltos)} />
        {enCurso ? (
          <Ficha titulo="Contado a hoy en el estado de resultados" valor={pesos(aHoy)} nota="Fijos en proporción a los días transcurridos" />
        ) : (
          <Ficha titulo="Contado en el estado de resultados" valor={pesos(aHoy)} />
        )}
      </Cifras>
      <Pestanas
        pestanas={[
          {
            id: "mes",
            titulo: "Del mes",
            cuenta: gastos.length,
            contenido: (
              <div className="flex flex-col gap-4">
                <GastosDelMes gastos={gastos} periodo={periodo} categorias={CATEGORIAS_GASTO} />
                {categorias.length ? (
                  <Seccion titulo="Por categoría" sinRelleno>
                    <Tabla>
                      <table className="datos">
                        <thead><tr><th>Categoría</th><th className="num">Del mes</th><th className="num">% del total</th></tr></thead>
                        <tbody>
                          {categorias.map(([c, m]) => (
                            <tr key={c}>
                              <td>{c}</td>
                              <td className="num cifra">{pesos(m)}</td>
                              <td className="num cifra">{delMes > 0 ? `${((m / delMes) * 100).toFixed(1)}%` : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Tabla>
                  </Seccion>
                ) : null}
              </div>
            ),
          },
          {
            id: "fijos",
            titulo: "Gastos fijos",
            cuenta: fijos.filter((f) => !f.hasta || f.hasta >= mesActual).length,
            contenido: <GastosFijosVista fijos={fijos} mesActual={mesActual} categorias={CATEGORIAS_GASTO} />,
          },
        ]}
      />
    </Pagina>
  );
}
