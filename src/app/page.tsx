import Link from "next/link";
import { cronometro } from "@/lib/servicios/cronometro";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { fechaMx } from "@/lib/servicios/ventas-monitor";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { cuentaActiva as cuentaFundas } from "@/lib/yapanizcel/cuenta";
import { leerConsolidadoGuardado } from "@/lib/servicios/consolidado-cargar";
import { nombreDelPeriodo, periodoActual } from "@/lib/servicios/corte-meli";
import { NOMBRE_CANAL } from "@/lib/servicios/consolidado";
import { Ficha } from "@/components/tiles";
import { Cifras, Encabezado, Pagina, Seccion, SinCuenta } from "@/components/ui/pagina";
import { GraficaVentasTiempo } from "@/components/ui/grafica-ventas-tiempo";
import { servirVariosCanalesConFecha } from "@/lib/servicios/ventas-tiempo";
import { MonitorHoy } from "@/components/ui/monitor-hoy";
import { armarMonitorHoy, minutoMx } from "@/lib/graficas/monitor-hoy";
import { leerFotosProducto } from "@/lib/servicios/fotos-producto";
import { fotoDeProducto } from "@/lib/fotos/producto";
import { ModeloConFoto, esDisenoDeFunda } from "@/components/ui/foto-producto";
import { PuntoCanal } from "@/components/ui/punto-canal";
import { colorDeCanal, ORDEN_CANALES, type CanalVenta } from "@/lib/graficas/canales";

export const dynamic = "force-dynamic";

/**
 * Inicio (pedido del dueño, 9-oct-2026: «sí quiero una página de inicio»):
 * lo que pasa en el negocio, en una sola vista. Sin «Para hoy» ni el aviso
 * rojo del plan (dueño, 19-oct-2026: «no me interesa ver esto»); arriba se
 * elige Hoy, Ayer, 7 días, 30 días o Este mes y las cifras y la venta por
 * canal siguen a ese periodo.
 *
 * Es de TODO el negocio, no solo de MELI (dueño, 9-oct-2026: «no te enfoques
 * solo en MELI sino en todo junto»): calzado en MELI, fundas, Amazon y
 * TikTok, juntos y por canal.
 *
 * Regla de arquitectura: aquí no se calcula NADA. La venta por día y por hora
 * de cada canal sale masticada de `ventas_por_hora` (las mismas reglas que
 * cada pantalla de ventas, el correo y el Estado de resultados); el mes
 * del corte general guardado (`consolidado_cache`).
 */
export default async function Inicio({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const sp = await searchParams;
  const elegido: PeriodoInicio = PERIODOS.some((p) => p.clave === sp.periodo) ? (sp.periodo as PeriodoInicio) : "hoy";
  const t = cronometro("/");
  const supabase = await clienteServidor();
  // Las tres cuentas a la vez: no dependen una de otra.
  const [cuenta, amz, yz] = await Promise.all([
    cuentaActiva(supabase),
    cuentaAmazon(supabase).catch(() => null),
    cuentaFundas(supabase).catch(() => null),
  ]);
  t.marca("cuentas");
  if (!cuenta) return <SinCuenta titulo="Inicio" />;

  const periodo = periodoActual();
  const hoy = fechaMx(0);
  const desde30 = fechaMx(29);
  const [mes, serie, fotos] = await Promise.all([
    leerConsolidadoGuardado(supabase, cuenta, periodo).catch(() => null),
    servirVariosCanalesConFecha(
      clienteAdmin(),
      [
        { canal: "meli_calzado", accountId: cuenta.id },
        { canal: "amazon", accountId: amz?.id },
        { canal: "meli_fundas", accountId: yz?.id },
        { canal: "tiktok", accountId: cuenta.id },
      ],
      { desde: desde30, hasta: hoy },
    ),
    // Fotos de los modelos que más venden: un renglón masticado; si falla, sin fotos.
    leerFotosProducto(supabase, cuenta.id).catch(() => null),
  ]);

  t.fin();
  const diario = serie.series;
  // El monitor corta a la hora en que se leyó la serie (puede ser de hace
  // unos minutos): comparar contra ayer a la hora de AHORA castigaría a hoy.
  const leidoEn = serie.generadoEn ? Date.parse(serie.generadoEn) : Date.now();
  const minuto = fechaDe(leidoEn) === hoy ? minutoMx(leidoEn) : minutoMx();
  const monitor = armarMonitorHoy(diario, hoy, minuto);

  // Los totales de arriba salen de la MISMA serie que la gráfica.
  const porDia = new Map<string, { importe: number; unidades: number }>();
  for (const c of diario) {
    for (const d of c.dias) {
      const v = porDia.get(d.f) ?? { importe: 0, unidades: 0 };
      v.importe += d.i;
      v.unidades += d.u;
      porDia.set(d.f, v);
    }
  }
  const hayVentas = porDia.size > 0;

  // El periodo elegido (Hoy, Ayer, 7 días, 30 días, Este mes; dueño,
  // 19-oct-2026). Los días sueltos salen de la serie de 30 días; el mes, del
  // corte general guardado (la serie no siempre llega al día 1).
  const diasDe: Record<Exclude<PeriodoInicio, "mes">, string[]> = {
    hoy: [hoy],
    ayer: [fechaMx(1)],
    "7d": Array.from({ length: 7 }, (_, i) => fechaMx(i)),
    "30d": Array.from({ length: 30 }, (_, i) => fechaMx(i)),
  };
  let filas: FilaCanal[];
  let venta: number | null;
  let unidades: number | null;
  if (elegido === "mes") {
    filas = (mes?.canales ?? [])
      .filter((k) => k.ventaBruta > 0)
      .map((k) => ({ canal: k.canal, venta: k.ventaBruta, unidades: k.unidades, utilidad: k.calculable ? k.utilidadNeta : null }));
    venta = mes ? mes.total.ventaBruta : null;
    unidades = mes ? mes.total.unidades : null;
  } else {
    const dias = new Set(diasDe[elegido]);
    filas = ORDEN_CANALES.map((canal) => {
      const s = diario.find((x) => x.canal === canal);
      let v = 0;
      let u = 0;
      for (const d of s?.dias ?? []) {
        if (!dias.has(d.f)) continue;
        v += d.i;
        u += d.u;
      }
      return { canal, venta: v, unidades: u };
    }).filter((f) => f.venta > 0);
    venta = hayVentas ? filas.reduce((x, f) => x + f.venta, 0) : null;
    unidades = hayVentas ? filas.reduce((x, f) => x + f.unidades, 0) : null;
  }
  const nombrePeriodo = elegido === "mes" ? nombreDelPeriodo(periodo) : PERIODOS.find((p) => p.clave === elegido)!.texto.toLowerCase();
  const maxVenta = Math.max(1, ...filas.map((k) => k.venta));
  const conFotos = fotos && Object.keys(fotos.modelos).length ? fotos : null;
  const masVendidos = [...(mes?.porModelo ?? [])].sort((x, y) => y.importe - x.importe).slice(0, 8);

  return (
    <Pagina vivo={120_000}>
      <Encabezado
        ceja={fechaLarga()}
        cejaFija
        titulo="Hoy"
        descripcion="Lo que se vendió y lo que se gana, en todos los canales."
        frescura={mes?.generadoEn ?? null}
      />

      <div className="atajos-fechas">
        {PERIODOS.map((p) => {
          const activo = p.clave === elegido;
          return (
            <Link
              key={p.clave}
              href={p.clave === "hoy" ? "/" : `/?periodo=${p.clave}`}
              className="shrink-0 rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap"
              style={
                activo
                  ? { background: "var(--acento)", color: "#fff", borderColor: "var(--acento)" }
                  : { borderColor: "var(--borde)" }
              }
            >
              {p.texto}
            </Link>
          );
        })}
      </div>

      <Cifras columnas={4}>
        <Ficha
          titulo={`Vendido · ${nombrePeriodo}`}
          valor={venta != null ? pesos(venta) : "—"}
          nota="Todos los canales"
        />
        <Ficha titulo={`Unidades · ${nombrePeriodo}`} valor={unidades != null ? n(unidades) : "—"} />
        <Ficha
          titulo="Precio promedio por unidad"
          valor={venta != null && unidades ? pesos(venta / unidades) : "—"}
        />
        <Ficha
          titulo={`Utilidad de ${nombreDelPeriodo(periodo)}`}
          valor={mes ? pesos(mes.total.utilidadNeta) : "—"}
          nota={
            mes?.total.margenSobreVenta != null
              ? `${(mes.total.margenSobreVenta * 100).toFixed(1)} % de la venta`
              : undefined
          }
          tono={mes ? (mes.total.utilidadNeta < 0 ? "critico" : "bien") : "neutro"}
        />
      </Cifras>

      <Seccion titulo="Hoy contra ayer y la semana pasada" descripcion="A la misma hora">
        <MonitorHoy monitor={monitor} />
      </Seccion>

      <Seccion titulo="Venta por canal, por día y por hora" descripcion="Últimos 30 días">
        <GraficaVentasTiempo datos={diario} desde={desde30} hasta={hoy} />
      </Seccion>

      <div className="grid gap-6 xl:grid-cols-[1fr_1.6fr]">
        <Seccion
          titulo={`${capital(nombrePeriodo)} por canal`}
          acciones={
            <Link href="/cortes" className="enlace text-[13px]">
              Ver el corte
            </Link>
          }
        >
          {filas.length ? (
            <ul className="flex flex-col gap-4">
              {filas.map((k) => (
                <li key={k.canal}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <PuntoCanal canal={k.canal} />
                      {NOMBRE_CANAL[k.canal]}
                    </span>
                    <span className="cifra">{pesos(k.venta)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(k.venta / maxVenta) * 100}%`, background: colorDeCanal(k.canal) ?? "var(--acento)" }}
                    />
                  </div>
                  <div className="texto-tenue mt-1 flex justify-between text-xs">
                    <span>{n(k.unidades)} unidades</span>
                    {k.utilidad === undefined ? null : (
                      <span>
                        {k.utilidad !== null ? (
                          <>
                            Utilidad{" "}
                            <span style={{ color: k.utilidad < 0 ? "var(--critico-texto)" : "var(--exito-texto)" }}>
                              {pesos(k.utilidad)}
                            </span>
                          </>
                        ) : (
                          "Utilidad aún no calculable"
                        )}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="texto-2 text-sm">{elegido === "mes" ? "Calculando el corte del mes…" : "Sin ventas en este periodo."}</p>
          )}
        </Seccion>

        {masVendidos.length ? (
          <Seccion
            titulo={`Modelos que más venden en ${nombreDelPeriodo(periodo)}`}
            descripcion="Todos los canales juntos"
            acciones={
              <Link href="/cortes?pestana=modelo" className="enlace text-[13px]">
                Ver todos
              </Link>
            }
            sinRelleno
          >
            <div className="overflow-x-auto">
              <table className="datos">
                <thead>
                  <tr>
                    <th>Modelo</th>
                    <th>Canales</th>
                    <th className="num">Unidades</th>
                    <th className="num">Venta</th>
                    <th className="num">Ganancia</th>
                  </tr>
                </thead>
                <tbody>
                  {masVendidos.map((x) => (
                    <tr key={x.modelo}>
                      <td className="font-medium">
                        {conFotos ? (
                          <ModeloConFoto modelo={x.modelo} url={fotoDeProducto(conFotos, x.modelo)} conFoto={!esDisenoDeFunda(x.modelo)} />
                        ) : (
                          x.modelo
                        )}
                      </td>
                      <td>
                        <span className="flex items-center gap-1" title={x.canales.map((k) => NOMBRE_CANAL[k]).join(", ")}>
                          {x.canales.map((k) => (
                            <PuntoCanal key={k} canal={k} />
                          ))}
                          <span className="sr-only">{x.canales.map((k) => NOMBRE_CANAL[k]).join(", ")}</span>
                        </span>
                      </td>
                      <td className="num cifra">{n(x.unidades)}</td>
                      <td className="num cifra">{pesos(x.importe)}</td>
                      <td
                        className="num cifra"
                        style={{
                          color: x.ganancia == null ? "var(--ink-muted)" : x.ganancia < 0 ? "var(--critico-texto)" : "var(--exito-texto)",
                        }}
                      >
                        {x.ganancia == null ? "—" : pesos(x.ganancia)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Seccion>
        ) : null}
      </div>
    </Pagina>
  );
}

// El color de cada canal vive en `lib/graficas/canales.ts` (una sola fuente).

type PeriodoInicio = "hoy" | "ayer" | "7d" | "30d" | "mes";

const PERIODOS: { clave: PeriodoInicio; texto: string }[] = [
  { clave: "hoy", texto: "Hoy" },
  { clave: "ayer", texto: "Ayer" },
  { clave: "7d", texto: "7 días" },
  { clave: "30d", texto: "30 días" },
  { clave: "mes", texto: "Este mes" },
];

interface FilaCanal {
  canal: CanalVenta;
  venta: number;
  unidades: number;
  /** solo en «Este mes» (corte general); null = aún no calculable */
  utilidad?: number | null;
}

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function pesos(x: number): string {
  return (x < 0 ? "-$" : "$") + Math.round(Math.abs(x)).toLocaleString("es-MX");
}

function fechaDe(ms: number): string {
  return new Date(ms - 6 * 3_600_000).toISOString().slice(0, 10);
}

function capital(x: string): string {
  return x.charAt(0).toUpperCase() + x.slice(1);
}

function fechaLarga(): string {
  return new Date(`${fechaMx(0)}T12:00:00Z`).toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}
