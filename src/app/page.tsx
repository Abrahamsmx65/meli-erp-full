import Link from "next/link";
import { ArrowRight, Container, Package, ShoppingBag, Truck, TriangleAlert } from "lucide-react";
import { cronometro } from "@/lib/servicios/cronometro";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { fechaMx } from "@/lib/servicios/ventas-monitor";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { cuentaActiva as cuentaFundas } from "@/lib/yapanizcel/cuenta";
import { leerConsolidadoGuardado } from "@/lib/servicios/consolidado-cargar";
import { nombreDelPeriodo, periodoActual } from "@/lib/servicios/corte-meli";
import { leerPlanParcial } from "@/lib/servicios/cache";
import { NOMBRE_CANAL } from "@/lib/servicios/consolidado";
import { Ficha } from "@/components/tiles";
import { Aviso, Cifras, Encabezado, Pagina, Seccion, SinCuenta } from "@/components/ui/pagina";
import { GraficaVentasTiempo } from "@/components/ui/grafica-ventas-tiempo";
import { servirVariosCanalesConFecha } from "@/lib/servicios/ventas-tiempo";
import { MonitorHoy } from "@/components/ui/monitor-hoy";
import { armarMonitorHoy, cambio, minutoMx } from "@/lib/graficas/monitor-hoy";
import { leerFotosProducto } from "@/lib/servicios/fotos-producto";
import { fotoDeProducto } from "@/lib/fotos/producto";
import { ModeloConFoto, esDisenoDeFunda } from "@/components/ui/foto-producto";
import { PuntoCanal } from "@/components/ui/punto-canal";
import { colorDeCanal } from "@/lib/graficas/canales";

export const dynamic = "force-dynamic";

/**
 * Inicio (pedido del dueño, 9-oct-2026: «sí quiero una página de inicio»):
 * lo que pasa HOY en el negocio y lo que toca hacer, en una sola vista.
 *
 * Es de TODO el negocio, no solo de MELI (dueño, 9-oct-2026: «no te enfoques
 * solo en MELI sino en todo junto»): calzado en MELI, fundas, Amazon y
 * TikTok, juntos y por canal.
 *
 * Regla de arquitectura: aquí no se calcula NADA. La venta por día y por hora
 * de cada canal sale masticada de `ventas_por_hora` (las mismas reglas que
 * cada pantalla de ventas, el correo y el Estado de resultados); el mes
 * del corte general guardado (`consolidado_cache`); el plan solo por sus
 * claves; y dos conteos baratos (TikTok sin corte, contenedores).
 */
export default async function Inicio() {
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
  const [mes, plan, tiktok, contenedores, serie, fotos] = await Promise.all([
    leerConsolidadoGuardado(supabase, cuenta, periodo).catch(() => null),
    leerPlanParcial(supabase, cuenta.id, ["resumen", "pendientes"]).catch(() => null),
    supabase
      .from("tiktok_ordenes")
      .select("order_id", { count: "exact", head: true })
      .eq("account_id", cuenta.id)
      .is("corte_id", null)
      .in("estado", ["AWAITING_SHIPMENT", "PARTIALLY_SHIPPING", "AWAITING_COLLECTION"]),
    supabase
      .from("contenedores")
      .select("numero, estado, fecha_llegada_est")
      .eq("account_id", cuenta.id)
      .in("estado", ["en_transito", "borrador"])
      .order("fecha_llegada_est", { ascending: true, nullsFirst: false }),
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
  const sumaDia = (f: string) => porDia.get(f)?.importe ?? 0;
  const unidadesDia = (f: string) => porDia.get(f)?.unidades ?? 0;
  const ventaHoy = sumaDia(hoy);
  const ventaAyer = sumaDia(fechaMx(1));
  const ultimos7 = Array.from({ length: 7 }, (_, i) => fechaMx(i));
  const venta7 = ultimos7.reduce((a, f) => a + sumaDia(f), 0);
  const unidades7 = ultimos7.reduce((a, f) => a + unidadesDia(f), 0);
  const hayVentas = porDia.size > 0;

  const resumen = plan?.resumen as { totalCajas?: number; skusCriticos?: number; skusUrgentes?: number } | undefined;
  const pend = plan?.pendientes as { sinCorrida?: unknown[]; sinAmarre?: unknown[] } | undefined;
  const pedidosTikTok = tiktok.count ?? 0;
  const conts = (contenedores.data ?? []) as { numero: string; estado: string; fecha_llegada_est: string | null }[];
  const enCamino = conts.filter((c) => c.estado === "en_transito");
  const porConfirmar = conts.filter((c) => c.estado === "borrador").length;
  const sinResolver = (pend?.sinCorrida?.length ?? 0) + (pend?.sinAmarre?.length ?? 0);

  const tareas: Tarea[] = [
    {
      href: "/envios",
      icono: Truck,
      titulo: "Cajas por mandar a Full",
      valor: resumen?.totalCajas ?? null,
      detalle: resumen?.skusCriticos ? `${n(resumen.skusCriticos)} SKUs en crítico` : "Según el plan de hoy",
      urgente: (resumen?.skusCriticos ?? 0) > 0,
    },
    {
      href: "/tiktok/despacho",
      icono: ShoppingBag,
      titulo: "Pedidos de TikTok sin corte",
      valor: pedidosTikTok,
      detalle: pedidosTikTok ? "Listos para el siguiente corte" : "Todo despachado",
      urgente: pedidosTikTok > 0,
    },
    {
      href: "/contenedores",
      icono: Container,
      titulo: "Contenedores en camino",
      valor: enCamino.length,
      detalle: porConfirmar ? `${porConfirmar} por confirmar desde Drive` : proximaLlegada(enCamino),
      urgente: porConfirmar > 0,
    },
    {
      href: "/pendientes",
      icono: TriangleAlert,
      titulo: "Pendientes por resolver",
      valor: sinResolver,
      detalle: sinResolver ? "SKUs sin corrida o sin amarrar" : "Nada pendiente",
      urgente: sinResolver > 0,
    },
  ];

  const canales = (mes?.canales ?? []).filter((k) => k.ventaBruta > 0);
  const maxVenta = Math.max(1, ...canales.map((k) => k.ventaBruta));
  const conFotos = fotos && Object.keys(fotos.modelos).length ? fotos : null;
  const masVendidos = [...(mes?.porModelo ?? [])].sort((x, y) => y.importe - x.importe).slice(0, 8);

  // Lo más importante del día en UNA línea, solo con lo que ya se leyó arriba.
  const sinCosto = (mes?.porModelo ?? []).filter((x) => x.costo == null && x.unidades > 0);
  const llegaPronto = enCamino.find((c) => {
    if (!c.fecha_llegada_est) return false;
    const dias = Math.round((Date.parse(c.fecha_llegada_est) - Date.parse(hoy)) / 86_400_000);
    return dias >= 0 && dias <= 1;
  });
  const vsAyer = cambio(monitor.total.hoyContraAyer.i, monitor.total.ayer?.i);
  const hallazgo = hallazgoDelDia({
    skusCriticos: resumen?.skusCriticos ?? 0,
    cajas: resumen?.totalCajas ?? null,
    pedidosTikTok,
    porConfirmar,
    sinCosto: sinCosto.length,
    unidadesSinCosto: sinCosto.reduce((a, x) => a + x.unidades, 0),
    llegaPronto: llegaPronto ? proximaLlegada([llegaPronto]) : null,
    vsAyer,
  });

  return (
    <Pagina vivo={120_000}>
      <Encabezado
        ceja={fechaLarga()}
        cejaFija
        titulo="Hoy"
        descripcion="Lo que se vendió, lo que se gana y lo que toca hacer hoy."
        frescura={mes?.generadoEn ?? null}
      />

      <Cifras columnas={4}>
        <Ficha
          titulo="Vendido hoy · todos los canales"
          valor={hayVentas ? pesos(ventaHoy) : "—"}
          nota={`${n(unidadesDia(hoy))} unidades · ayer ${pesos(ventaAyer)}`}
        />
        <Ficha
          titulo="Últimos 7 días · todos los canales"
          valor={hayVentas ? pesos(venta7) : "—"}
          nota={`${n(unidades7)} unidades`}
        />
        <Ficha
          titulo={`Venta de ${nombreDelPeriodo(periodo)}`}
          valor={mes ? pesos(mes.total.ventaBruta) : "—"}
          nota={mes ? `${n(mes.total.unidades)} unidades en todos los canales` : "El corte del mes aún no se calcula"}
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

      {/* «Qué hago hoy» va primero: el hallazgo del día y las tareas, antes de las gráficas. */}
      {hallazgo ? (
        <Aviso tono={hallazgo.tono}>
          {hallazgo.texto}
          {hallazgo.href ? (
            <>
              {" "}
              <Link href={hallazgo.href} className="enlace">
                {hallazgo.enlace}
              </Link>
            </>
          ) : null}
        </Aviso>
      ) : null}

      <Seccion titulo="Para hoy" sinRelleno>
        <ul className="grid sm:grid-cols-2">
          {tareas.map((t, i) => (
            <li
              key={t.href}
              className={`border-b ${i >= tareas.length - (tareas.length % 2 || 2) ? "sm:border-b-0" : ""} last:border-b-0 ${i % 2 === 0 ? "sm:border-r" : ""}`}
              style={{ borderColor: "var(--grid)" }}
            >
              <Link href={t.href} className="fila-inicio flex items-center gap-3 px-4 py-2.5">
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-md"
                  style={{
                    background: t.urgente ? "var(--alerta-suave)" : "var(--surface-2)",
                    color: t.urgente ? "var(--alerta-texto)" : "var(--ink-2)",
                  }}
                >
                  <t.icono size={15} strokeWidth={1.9} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{t.titulo}</span>
                  <span className="texto-tenue block truncate text-xs">{t.detalle}</span>
                </span>
                <span className="cifra text-lg font-semibold">{t.valor == null ? "—" : n(t.valor)}</span>
                <ArrowRight size={15} className="texto-tenue shrink-0" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </Seccion>

      <Seccion titulo="Hoy contra ayer y la semana pasada" descripcion="A la misma hora">
        <MonitorHoy monitor={monitor} />
      </Seccion>

      <Seccion titulo="Venta por canal, por día y por hora" descripcion="Últimos 30 días">
        <GraficaVentasTiempo datos={diario} desde={desde30} hasta={hoy} />
      </Seccion>

      <div className="grid gap-6 xl:grid-cols-[1fr_1.6fr]">
        <Seccion
          titulo={`${capital(nombreDelPeriodo(periodo))} por canal`}
          acciones={
            <Link href="/cortes" className="enlace text-[13px]">
              Ver el corte
            </Link>
          }
        >
          {canales.length ? (
            <ul className="flex flex-col gap-4">
              {canales.map((k) => (
                <li key={k.canal}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <PuntoCanal canal={k.canal} />
                      {NOMBRE_CANAL[k.canal]}
                    </span>
                    <span className="cifra">{pesos(k.ventaBruta)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(k.ventaBruta / maxVenta) * 100}%`, background: colorDeCanal(k.canal) ?? "var(--acento)" }}
                    />
                  </div>
                  <div className="texto-tenue mt-1 flex justify-between text-xs">
                    <span>{n(k.unidades)} unidades</span>
                    <span>
                      {k.calculable ? (
                        <>
                          Utilidad{" "}
                          <span style={{ color: k.utilidadNeta < 0 ? "var(--critico-texto)" : "var(--exito-texto)" }}>
                            {pesos(k.utilidadNeta)}
                          </span>
                        </>
                      ) : (
                        "Utilidad aún no calculable"
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="texto-2 text-sm">Calculando el corte del mes…</p>
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

interface Tarea {
  href: string;
  icono: typeof Package;
  titulo: string;
  valor: number | null;
  detalle: string;
  urgente: boolean;
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

interface Hallazgo {
  texto: string;
  tono: "info" | "bien" | "alerta" | "critico";
  href?: string;
  enlace?: string;
}

/**
 * El hallazgo más importante del día, en una línea, con lo que la página ya
 * leyó (nada se consulta aquí). Va de lo que cuesta venta (Full en crítico)
 * a lo que solo informa (hoy contra ayer a la misma hora).
 */
function hallazgoDelDia(d: {
  skusCriticos: number;
  cajas: number | null;
  pedidosTikTok: number;
  porConfirmar: number;
  sinCosto: number;
  unidadesSinCosto: number;
  llegaPronto: string | null;
  vsAyer: number | null;
}): Hallazgo | null {
  if (d.skusCriticos > 0) {
    return {
      tono: "critico",
      texto: `${n(d.skusCriticos)} SKUs en crítico en Full${d.cajas ? `; el plan pide mandar ${n(d.cajas)} cajas` : ""}.`,
      href: "/envios",
      enlace: "Ver el plan",
    };
  }
  if (d.pedidosTikTok > 0) {
    return {
      tono: "alerta",
      texto: `${n(d.pedidosTikTok)} ${d.pedidosTikTok === 1 ? "pedido de TikTok espera" : "pedidos de TikTok esperan"} corte.`,
      href: "/tiktok/despacho",
      enlace: "Ir a despacho",
    };
  }
  if (d.porConfirmar > 0) {
    return {
      tono: "alerta",
      texto: `${n(d.porConfirmar)} ${d.porConfirmar === 1 ? "contenedor llegó" : "contenedores llegaron"} de Drive y ${d.porConfirmar === 1 ? "espera" : "esperan"} confirmación.`,
      href: "/contenedores",
      enlace: "Revisar",
    };
  }
  if (d.sinCosto > 0) {
    return {
      tono: "alerta",
      texto: `${n(d.sinCosto)} ${d.sinCosto === 1 ? "modelo vendió" : "modelos vendieron"} ${n(d.unidadesSinCosto)} unidades este mes sin costo capturado: su ganancia no se cuenta.`,
      href: "/productos",
      enlace: "Capturar costos",
    };
  }
  if (d.llegaPronto) {
    return { tono: "info", texto: `El contenedor ${d.llegaPronto}.`, href: "/contenedores", enlace: "Ver contenedores" };
  }
  if (d.vsAyer != null && Math.abs(d.vsAyer) >= 0.05) {
    const pct = Math.round(Math.abs(d.vsAyer) * 100);
    return {
      tono: d.vsAyer > 0 ? "bien" : "info",
      texto: `Hoy vas ${pct} % ${d.vsAyer > 0 ? "arriba" : "abajo"} de lo que ayer llevaba a esta hora.`,
    };
  }
  return null;
}

function fechaLarga(): string {
  return new Date(`${fechaMx(0)}T12:00:00Z`).toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

function proximaLlegada(conts: { numero: string; fecha_llegada_est: string | null }[]): string {
  const c = conts.find((x) => x.fecha_llegada_est);
  if (!c?.fecha_llegada_est) return conts.length ? "Sin fecha de llegada" : "Nada en el mar";
  const dias = Math.round((Date.parse(c.fecha_llegada_est) - Date.parse(fechaMx(0))) / 86_400_000);
  const cuando = dias <= 0 ? "llega hoy" : dias === 1 ? "llega mañana" : `llega en ${dias} días`;
  return `${c.numero} ${cuando}`;
}
