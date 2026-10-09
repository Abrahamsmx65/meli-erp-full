import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cuentaActiva as cuentaYz } from "@/lib/yapanizcel/cuenta";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { Ficha } from "@/components/tiles";
import { Aviso, Cifras, Encabezado, Pagina, Seccion, SinCuenta, Tabla } from "@/components/ui/pagina";
import { Pestanas } from "@/components/ui/pestanas";
import { NOMBRE_CANAL, periodoActualMx, revisarSalud, type Hallazgo, type MesDeCorte } from "@/lib/servicios/salud";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Revisión general: qué está mal AHORA, sin que el dueño lo busque.
 * No calcula ningún corte; lee dos RPC (un renglón por mes) y aplica las
 * reglas de `salud.ts`.
 */
export default async function Salud() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Diagnóstico" />;

  const [yz, amz] = await Promise.all([
    cuentaYz(supabase).catch(() => null),
    cuentaAmazon(supabase).catch(() => null),
  ]);
  const salud = await revisarSalud(supabase, cuenta, {
    yzAccountId: yz?.id ?? null,
    amazonAccountId: amz?.id ?? null,
  });
  const hoy = periodoActualMx();
  const todoBien = salud.graves.length === 0 && salud.faltas.length === 0;
  const canales = [...new Set(salud.meses.flatMap((m) => m.canales.map((k) => k.canal)))].sort();

  return (
    <Pagina>
      <Encabezado
        ceja="Sistema"
        titulo="Diagnóstico"
        descripcion="Lo que el sistema sabe que está mal o incompleto, en un solo lugar."
        ayuda={
          <>
            <p>Si esta pantalla está limpia, los números de los cortes se pueden creer.</p>
            <p>
              Revisado el {new Date(salud.revisadoEn).toLocaleString("es-MX")}. Se recalcula cada vez que abres la pantalla. El
              correo del cron solo sale cuando cambia lo encontrado.
            </p>
          </>
        }
      />

      <Cifras columnas={3}>
        <Ficha titulo="Problemas" valor={String(salud.graves.length)} tono={salud.graves.length > 0 ? "critico" : "bien"} />
        <Ficha titulo="Datos por llegar" valor={String(salud.faltas.length)} tono={salud.faltas.length > 0 ? "alerta" : "bien"} />
        <Ficha titulo="Meses revisados" valor={String(salud.meses.length)} nota={salud.meses.slice(0, 6).map((m) => m.periodo).join(", ") || "ninguno"} tono="bien" />
      </Cifras>

      {todoBien && salud.errores.length === 0 ? (
        <Aviso tono="bien">
          Nada que reportar.
        </Aviso>
      ) : null}

      <Pestanas
        pestanas={[
          !todoBien && {
            id: "problemas",
            titulo: "Problemas",
            cuenta: salud.graves.length,
            alerta: salud.graves.length > 0,
            contenido: (
              <>
                <Lista
                  titulo="Problemas"
                  ayuda="Hay un número EN PANTALLA que está mal o incompleto y no se nota. Esto sí hay que arreglarlo."
                  hallazgos={salud.graves}
                  vacio="Ninguno."
                  critico
                />
              </>
            ),
          },
          !todoBien && {
            id: "por-llegar",
            titulo: "Por llegar",
            cuenta: salud.faltas.length,
            contenido: (
              <>
                <Lista
                  titulo="Datos que todavía no llegan"
                  ayuda="El dato falta y el sistema ya lo dice en sus avisos. No está mal, está incompleto, y se completa solo."
                  hallazgos={salud.faltas}
                  vacio="Ninguno."
                />
              </>
            ),
          },
          {
            id: "cobertura",
            titulo: "Cobertura",
            contenido: (
              <>
                {/* ---- Cobertura por mes y canal: la señal que importa ------------ */}
                <Seccion
                  titulo="Cobertura por mes y canal"
                  sinRelleno
                >
                  <Tabla>
                    <table className="datos">
                      <thead>
                        <tr>
                          <th>Mes</th>
                          {canales.map((c) => <th key={c} className="num">{NOMBRE_CANAL[c] ?? c}</th>)}
                          <th className="num">Cuadra</th>
                        </tr>
                      </thead>
                      <tbody>
                        {salud.meses.map((m) => (
                          <tr key={m.periodo}>
                            <td className="font-medium">{m.periodo}{m.periodo === hoy ? " (en curso)" : ""}</td>
                            {canales.map((c) => {
                              const k = m.canales.find((x) => x.canal === c);
                              return <td key={c} className="num cifra">{celdaCobertura(k, m.periodo < hoy)}</td>;
                            })}
                            <td className="num">{cuadra(m)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Tabla>
                </Seccion>
              </>
            ),
          },
          {
            id: "fuentes",
            titulo: "Fuentes",
            contenido: (
              <>
                {/* ---- Fuentes por mes ------------------------------------------- */}
                <Seccion titulo="Fuentes por mes" sinRelleno>
                  <Tabla>
                    <table className="datos">
                      <thead>
                        <tr>
                          <th>Mes</th>
                          <th className="num">Órdenes calzado registradas</th>
                          <th className="num">Con depósito</th>
                          <th className="num">Facturación MELI (renglones)</th>
                          <th className="num">Publicidad MELI (días)</th>
                          <th className="num">Fundas con depósito</th>
                          <th className="num">Eventos Finances Amazon</th>
                          <th className="num">Liquidaciones sin cuadrar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {salud.fuentes.map((f) => (
                          <tr key={f.mes}>
                            <td className="font-medium">{f.mes}</td>
                            <td className="num cifra">{f.ventaCalzado > 0 ? `${n(f.ordenesRegistradas)} de ~${n(f.ordenesCalzado)}` : "—"}</td>
                            <td className="num cifra">{f.ventaCalzado > 0 ? n(f.ordenesConDeposito) : "—"}</td>
                            <td className="num cifra">{f.ventaCalzado > 0 ? n(f.cargos) : "—"}</td>
                            <td className="num cifra">{f.ventaCalzado > 0 ? n(f.diasPublicidad) : "—"}</td>
                            <td className="num cifra">{f.ventaFundas > 0 ? `${n(f.fundasConDeposito)} de ~${n(f.ordenesFundas)}` : "—"}</td>
                            <td className="num cifra">{f.ventaAmazon > 0 ? n(f.eventosAmazon) : "—"}</td>
                            <td className="num cifra">{f.gruposAmazonDescuadrados > 0 ? `${f.gruposAmazonDescuadrados} (${pesos(f.descuadreAmazon)})` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Tabla>
                </Seccion>
              </>
            ),
          },
          salud.errores.length > 0 && {
            id: "errores",
            titulo: "No se pudo leer",
            cuenta: salud.errores.length,
            alerta: true,
            contenido: (
              <>
                <Seccion titulo="Lo que la revisión NO pudo leer">
                  <ul className="texto-2 flex flex-col gap-1 text-xs">
                    {salud.errores.map((e) => <li key={e}>{e}</li>)}
                  </ul>
                </Seccion>
              </>
            ),
          },
        ]}
      />

    </Pagina>
  );
}

const n = (x: number) => x.toLocaleString("es-MX");
const pesos = (x: number) => x.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

function celdaCobertura(k: MesDeCorte["canales"][number] | undefined, cerrado: boolean) {
  if (!k) return <span className="texto-tenue">—</span>;
  if (k.venta <= 0) return <span className="texto-tenue">sin venta</span>;
  if (!k.calculable || k.cobertura === 0) return <span className="font-semibold" style={{ color: "var(--critico-texto)" }}>0 % · fuera</span>;
  if (k.cobertura == null) return <span className="texto-2">por asiento</span>;
  const color = k.cobertura >= 0.95 ? "var(--exito-texto)" : cerrado ? "var(--alerta-texto)" : "var(--ink-2)";
  return <span style={{ color }}>{Math.round(k.cobertura * 100)} %</span>;
}

function cuadra(m: MesDeCorte) {
  if (m.ventaTotal == null || m.ventaCanales == null) return "—";
  const ok = Math.abs(m.ventaTotal - m.ventaCanales) <= Math.max(1, Math.abs(m.ventaTotal) * 0.0001);
  return <span style={{ color: ok ? "var(--exito-texto)" : "var(--critico-texto)" }}>{ok ? "sí" : "NO"}</span>;
}

function Lista({ titulo, ayuda, hallazgos, vacio, critico }: { titulo: string; ayuda: string; hallazgos: Hallazgo[]; vacio: string; critico?: boolean }) {
  return (
    <Seccion titulo={`${titulo}${hallazgos.length > 0 ? ` (${hallazgos.length})` : ""}`} ayuda={<p>{ayuda}</p>} sinRelleno>
      {hallazgos.length === 0 ? (
        <p className="p-4 text-sm texto-2">{vacio}</p>
      ) : (
        <ul className="flex flex-col">
          {hallazgos.map((h, i) => (
            <li key={`${h.area}-${h.periodo}-${i}`} className="border-b p-4 hairline last:border-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{ background: critico ? "var(--critico-suave)" : "var(--alerta-suave)", color: critico ? "var(--critico-texto)" : "var(--alerta-texto)" }}
                >
                  {h.area}{h.periodo ? ` · ${h.periodo}` : ""}
                </span>
                <span className="text-sm font-medium">{h.que}</span>
              </div>
              <p className="mt-1 text-xs texto-2">{h.detalle}</p>
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  );
}
