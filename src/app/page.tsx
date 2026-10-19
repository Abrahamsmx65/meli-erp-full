import Link from "next/link";
import { cronometro } from "@/lib/servicios/cronometro";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { fechaMx, normalizarRango } from "@/lib/servicios/ventas-monitor";
import { FiltroFechas } from "@/components/filtro-fechas";
import { modeloUnificado } from "@/lib/servicios/costos-unificados";
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
 * lo que se vendió en el negocio, en una sola vista. Sin «Para hoy» ni el
 * aviso rojo del plan (dueño, 19-oct-2026: «no me interesa ver esto»). Arriba
 * va el MISMO filtro de fechas de Ventas (Hoy por omisión) y TODO lo de
 * abajo sigue a ese rango: cifras, gráfica, venta por canal y modelos («solo
 * se cambia la barra de arriba, no todo el contenido de abajo»). «Hoy contra
 * ayer» solo sale en Hoy, y la utilidad solo en «Este mes» (el estado de
 * resultados guardado es por mes).
 *
 * Es de TODO el negocio, no solo de MELI (dueño, 9-oct-2026: «no te enfoques
 * solo en MELI sino en todo junto»): calzado en MELI, fundas, Amazon y
 * TikTok, juntos y por canal.
 *
 * Regla de arquitectura: aquí no se calcula NADA. La venta por día y por hora
 * de cada canal sale masticada de `ventas_por_hora` (las mismas reglas que
 * cada pantalla de ventas, el correo y el Estado de resultados); el mes
 * del estado de resultados guardado (`consolidado_cache`); los modelos de
 * `inicio_ventas_skus` (migración 0149, lo ya sumado por día, ~85 ms en 30
 * días).
 */
export default async function Inicio({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const sp = await searchParams;
  const hoy = fechaMx(0);
  // Por omisión, HOY (en Ventas es 7 días); el filtro es el mismo de Ventas.
  const rango = normalizarRango(sp.desde ?? hoy, sp.hasta ?? hoy);
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
  const inicioMes = `${hoy.slice(0, 8)}01`;
  const esHoy = rango.desde === hoy && rango.hasta === hoy;
  // El estado de resultados guardado solo sabe de meses: la utilidad sale
  // cuando el rango es «Este mes».
  const esMes = rango.desde === inicioMes && rango.hasta === hoy;
  const cuentas = [
    { canal: "meli_calzado" as const, accountId: cuenta.id },
    { canal: "amazon" as const, accountId: amz?.id },
    { canal: "meli_fundas" as const, accountId: yz?.id },
    { canal: "tiktok" as const, accountId: cuenta.id },
  ];
  const admin = clienteAdmin();
  const [mes, serie, serie30, skus, fotos] = await Promise.all([
    esMes ? leerConsolidadoGuardado(supabase, cuenta, periodo).catch(() => null) : null,
    servirVariosCanalesConFecha(admin, cuentas, rango),
    // «Hoy contra ayer» necesita ayer y hace 7 días (la serie de 30 días).
    esHoy ? servirVariosCanalesConFecha(admin, cuentas, { desde: fechaMx(29), hasta: hoy }) : null,
    // Lo vendido por SKU de los cuatro canales en el rango (migración 0149).
    supabase
      .rpc("inicio_ventas_skus", {
        p_meli: cuenta.id,
        p_amazon: amz?.id ?? null,
        p_yz: yz?.id ?? null,
        p_desde: rango.desde,
        p_hasta: rango.hasta,
      })
      .then((r) => (r.error ? null : ((r.data ?? []) as [CanalVenta, string, number, number][]))),
    // Fotos de los modelos que más venden: un renglón masticado; si falla, sin fotos.
    leerFotosProducto(supabase, cuenta.id).catch(() => null),
  ]);
  t.fin();

  const series = serie.series;
  let monitor: ReturnType<typeof armarMonitorHoy> | null = null;
  if (serie30) {
    // El monitor corta a la hora en que se leyó la serie (puede ser de hace
    // unos minutos): comparar contra ayer a la hora de AHORA castigaría a hoy.
    const leidoEn = serie30.generadoEn ? Date.parse(serie30.generadoEn) : Date.now();
    const minuto = fechaDe(leidoEn) === hoy ? minutoMx(leidoEn) : minutoMx();
    monitor = armarMonitorHoy(serie30.series, hoy, minuto);
  }

  // Las cifras y la venta por canal salen de la MISMA serie que la gráfica.
  const utilidadDe = new Map((mes?.canales ?? []).map((k) => [k.canal, k.calculable ? k.utilidadNeta : null]));
  const filas: FilaCanal[] = ORDEN_CANALES.map((canal) => {
    const s = series.find((x) => x.canal === canal);
    let venta = 0;
    let unidades = 0;
    let ordenes = 0;
    for (const d of s?.dias ?? []) {
      if (d.f < rango.desde || d.f > rango.hasta) continue;
      venta += d.i;
      unidades += d.u;
      ordenes += d.o;
    }
    return { canal, venta, unidades, ordenes, utilidad: mes ? (utilidadDe.get(canal) ?? null) : undefined };
  }).filter((f) => f.venta > 0 || f.unidades > 0);
  const hayVentas = series.length > 0;
  const venta = filas.reduce((x, f) => x + f.venta, 0);
  const unidades = filas.reduce((x, f) => x + f.unidades, 0);
  const ordenes = filas.reduce((x, f) => x + f.ordenes, 0);
  const maxVenta = Math.max(1, ...filas.map((k) => k.venta));

  // Modelos del periodo: se juntan los SKU de los cuatro canales por modelo.
  // En «Este mes» van los del estado de resultados, que traen la ganancia.
  const masVendidos: ModeloInicio[] = mes?.porModelo?.length
    ? [...mes.porModelo]
        .sort((x, y) => y.importe - x.importe)
        .slice(0, 10)
        .map((x) => ({ modelo: x.modelo, canales: x.canales, unidades: x.unidades, importe: x.importe, ganancia: x.ganancia }))
    : modelosDeSkus(skus ?? []).slice(0, 10);
  const conGanancia = !!mes?.porModelo?.length;
  const conFotos = fotos && Object.keys(fotos.modelos).length ? fotos : null;
  const nombre = nombreDeRango(rango, hoy, inicioMes, nombreDelPeriodo(periodo));

  return (
    <Pagina vivo={120_000}>
      <Encabezado
        ceja={fechaLarga()}
        cejaFija
        titulo="Inicio"
        descripcion="Lo que se vendió en todos los canales."
        frescura={serie.generadoEn}
      />

      <FiltroFechas base="/" desde={rango.desde} hasta={rango.hasta} hoy={hoy} />

      <Cifras columnas={4}>
        <Ficha titulo={`Vendido ${nombre}`} valor={hayVentas ? pesos(venta) : "—"} nota="Todos los canales" />
        <Ficha titulo="Unidades" valor={hayVentas ? n(unidades) : "—"} nota={hayVentas ? `${n(ordenes)} pedidos` : undefined} />
        <Ficha titulo="Precio promedio por unidad" valor={unidades ? pesos(venta / unidades) : "—"} />
        {esMes ? (
          <Ficha
            titulo={`Utilidad de ${nombreDelPeriodo(periodo)}`}
            valor={mes ? pesos(mes.total.utilidadNeta) : "—"}
            nota={
              mes?.total.margenSobreVenta != null
                ? `${(mes.total.margenSobreVenta * 100).toFixed(1)} % de la venta`
                : "El estado del mes aún no se calcula"
            }
            tono={mes ? (mes.total.utilidadNeta < 0 ? "critico" : "bien") : "neutro"}
          />
        ) : (
          <Ficha titulo="Venta por pedido" valor={ordenes ? pesos(venta / ordenes) : "—"} />
        )}
      </Cifras>

      {monitor ? (
        <Seccion titulo="Hoy contra ayer y la semana pasada" descripcion="A la misma hora">
          <MonitorHoy monitor={monitor} />
        </Seccion>
      ) : null}

      <Seccion titulo="Venta por canal, por día y por hora" descripcion={capital(nombre)}>
        <GraficaVentasTiempo
          datos={series}
          desde={rango.desde}
          hasta={rango.hasta}
          inicial={rango.desde === rango.hasta ? "hora" : "dia"}
        />
      </Seccion>

      <div className="grid gap-6 xl:grid-cols-[1fr_1.6fr]">
        <Seccion
          titulo="Por canal"
          descripcion={capital(nombre)}
          acciones={
            <Link href="/cortes" className="enlace text-[13px]">
              Estado de resultados
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
                    <span>
                      {n(k.unidades)} unidades · {venta > 0 ? Math.round((k.venta / venta) * 100) : 0} %
                    </span>
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
            <p className="texto-2 text-sm">Sin ventas en este periodo.</p>
          )}
        </Seccion>

        <Seccion
          titulo="Modelos que más venden"
          descripcion={`${capital(nombre)} · todos los canales`}
          acciones={
            <Link href="/cortes?pestana=modelo" className="enlace text-[13px]">
              Ver todos
            </Link>
          }
          sinRelleno
        >
          {masVendidos.length ? (
            <div className="overflow-x-auto">
              <table className="datos">
                <thead>
                  <tr>
                    <th>Modelo</th>
                    <th>Canales</th>
                    <th className="num">Unidades</th>
                    <th className="num">Venta</th>
                    {conGanancia ? <th className="num">Ganancia</th> : null}
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
                      {conGanancia ? (
                        <td
                          className="num cifra"
                          style={{
                            color:
                              x.ganancia == null ? "var(--ink-muted)" : x.ganancia < 0 ? "var(--critico-texto)" : "var(--exito-texto)",
                          }}
                        >
                          {x.ganancia == null ? "—" : pesos(x.ganancia)}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="texto-2 px-4 py-3 text-sm">{skus ? "Sin ventas en este periodo." : "No se pudieron leer los modelos."}</p>
          )}
        </Seccion>
      </div>
    </Pagina>
  );
}

// El color de cada canal vive en `lib/graficas/canales.ts` (una sola fuente).

interface FilaCanal {
  canal: CanalVenta;
  venta: number;
  unidades: number;
  ordenes: number;
  /** solo en «Este mes» (estado de resultados); null = aún no calculable */
  utilidad?: number | null;
}

interface ModeloInicio {
  modelo: string;
  canales: CanalVenta[];
  unidades: number;
  importe: number;
  ganancia?: number | null;
}

/**
 * Junta por modelo lo vendido por SKU en los cuatro canales
 * (`inicio_ventas_skus`). Los SKU de David («D-…») no son del dueño.
 */
function modelosDeSkus(filas: [CanalVenta, string, number, number][]): ModeloInicio[] {
  const por = new Map<string, ModeloInicio>();
  for (const [canal, sku, u, i] of filas) {
    if (/^D-/i.test(sku)) continue;
    const modelo = modeloUnificado(sku);
    if (!modelo) continue;
    const m = por.get(modelo) ?? { modelo, canales: [], unidades: 0, importe: 0 };
    m.unidades += Number(u) || 0;
    m.importe += Number(i) || 0;
    if (!m.canales.includes(canal)) m.canales.push(canal);
    por.set(modelo, m);
  }
  for (const m of por.values()) m.canales.sort((a, b) => ORDEN_CANALES.indexOf(a) - ORDEN_CANALES.indexOf(b));
  return [...por.values()].sort((x, y) => y.importe - x.importe);
}

/** «hoy», «ayer», «los últimos 7 días», «octubre» o el rango a mano. */
function nombreDeRango(r: { desde: string; hasta: string }, hoy: string, inicioMes: string, mes: string): string {
  if (r.desde === hoy && r.hasta === hoy) return "hoy";
  if (r.desde === r.hasta && r.desde === fechaMx(1)) return "ayer";
  if (r.hasta === hoy && r.desde === inicioMes) return `en ${mes}`;
  if (r.hasta === hoy) {
    const dias = Math.round((Date.parse(hoy) - Date.parse(r.desde)) / 86_400_000) + 1;
    return `en los últimos ${dias} días`;
  }
  const corta = (f: string) =>
    new Date(`${f}T12:00:00Z`).toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
  return r.desde === r.hasta ? `el ${corta(r.desde)}` : `del ${corta(r.desde)} al ${corta(r.hasta)}`;
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
