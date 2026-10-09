import Link from "next/link";
import { ArrowRight, Container, Package, ShoppingBag, Truck, TriangleAlert } from "lucide-react";
import { cronometro } from "@/lib/servicios/cronometro";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { fechaMx } from "@/lib/servicios/ventas-monitor";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { cuentaActiva as cuentaFundas } from "@/lib/yapanizcel/cuenta";
import { leerConsolidadoGuardado } from "@/lib/servicios/consolidado-cargar";
import { nombreDelPeriodo, periodoActual } from "@/lib/servicios/corte-meli";
import { leerPlanParcial } from "@/lib/servicios/cache";
import { NOMBRE_CANAL } from "@/lib/servicios/consolidado";
import { Ficha } from "@/components/tiles";
import { Cifras, Encabezado, Pagina, Seccion, SinCuenta } from "@/components/ui/pagina";
import { BarrasApiladasPorDia, type PuntoApilado, type SerieApilada } from "@/components/ui/graficas";

export const dynamic = "force-dynamic";

/**
 * Inicio (pedido del dueño, 9-oct-2026: «sí quiero una página de inicio»):
 * lo que pasa HOY en el negocio y lo que toca hacer, en una sola vista.
 *
 * Es de TODO el negocio, no solo de MELI (dueño, 9-oct-2026: «no te enfoques
 * solo en MELI sino en todo junto»): calzado en MELI, fundas, Amazon y
 * TikTok, juntos y por canal.
 *
 * Regla de arquitectura: aquí no se calcula NADA. La venta por día y canal
 * sale del RPC `ventas_por_dia_canales` (sumas en Postgres, ~35 ms); el mes
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
  const [mes, plan, tiktok, contenedores, diario] = await Promise.all([
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
    supabase.rpc("ventas_por_dia_canales", {
      p_meli: cuenta.id,
      p_amazon: amz?.id ?? null,
      p_yz: yz?.id ?? null,
      p_desde: desde30,
      p_hasta: hoy,
    }),
  ]);

  t.fin();

  // La serie apilada de 30 días, un valor por canal y día (los días sin venta van en cero).
  const filas = (diario.data ?? []) as { fecha: string; canal: string; unidades: number; importe: number }[];
  const porDia = new Map<string, Record<string, number>>();
  const unidadesPorDia = new Map<string, number>();
  for (const f of filas) {
    const dia = String(f.fecha).slice(0, 10);
    const v = porDia.get(dia) ?? {};
    v[f.canal] = (v[f.canal] ?? 0) + Number(f.importe ?? 0);
    porDia.set(dia, v);
    unidadesPorDia.set(dia, (unidadesPorDia.get(dia) ?? 0) + Number(f.unidades ?? 0));
  }
  const serie: PuntoApilado[] = [];
  for (let i = 29; i >= 0; i--) {
    const f = fechaMx(i);
    serie.push({ fecha: f, valores: porDia.get(f) ?? {} });
  }
  const sumaDia = (f: string) => Object.values(porDia.get(f) ?? {}).reduce((a, x) => a + x, 0);
  const ventaHoy = sumaDia(hoy);
  const ventaAyer = sumaDia(fechaMx(1));
  const ultimos7 = Array.from({ length: 7 }, (_, i) => fechaMx(i));
  const venta7 = ultimos7.reduce((a, f) => a + sumaDia(f), 0);
  const unidades7 = ultimos7.reduce((a, f) => a + (unidadesPorDia.get(f) ?? 0), 0);
  const conDatos = SERIES.filter((s) => filas.some((f) => f.canal === s.clave));

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

  return (
    <Pagina>
      <Encabezado
        ceja={fechaLarga()}
        cejaFija
        titulo={saludo()}
        descripcion="Lo que se vendió, lo que se gana y lo que toca hacer hoy."
        frescura={mes?.generadoEn ?? null}
      />

      <Cifras columnas={4}>
        <Ficha
          titulo="Vendido hoy · todos los canales"
          valor={filas.length ? pesos(ventaHoy) : "—"}
          nota={`${n(unidadesPorDia.get(hoy) ?? 0)} unidades · ayer ${pesos(ventaAyer)}`}
        />
        <Ficha
          titulo="Últimos 7 días · todos los canales"
          valor={filas.length ? pesos(venta7) : "—"}
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

      <Seccion titulo="Venta diaria por canal" descripcion="Últimos 30 días · venta registrada antes de cargos">
        <BarrasApiladasPorDia puntos={serie} series={conDatos.length ? conDatos : SERIES} etiqueta="Venta" />
      </Seccion>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <Seccion titulo="Para hoy" sinRelleno>
          <ul>
            {tareas.map((t) => (
              <li key={t.href} className="border-b last:border-b-0" style={{ borderColor: "var(--grid)" }}>
                <Link href={t.href} className="fila-inicio flex items-center gap-4 px-4 py-3.5">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      background: t.urgente ? "var(--alerta-suave)" : "var(--surface-2)",
                      color: t.urgente ? "var(--alerta-texto)" : "var(--ink-2)",
                    }}
                  >
                    <t.icono size={18} strokeWidth={1.9} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{t.titulo}</span>
                    <span className="texto-tenue block truncate text-xs">{t.detalle}</span>
                  </span>
                  <span className="cifra text-xl font-semibold">{t.valor == null ? "—" : n(t.valor)}</span>
                  <ArrowRight size={16} className="texto-tenue shrink-0" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Seccion>

        <Seccion
          titulo={`${nombreDelPeriodo(periodo)} por canal`}
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
                    <span className="font-medium">{NOMBRE_CANAL[k.canal]}</span>
                    <span className="cifra">{pesos(k.ventaBruta)}</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(k.ventaBruta / maxVenta) * 100}%`, background: "var(--acento)" }}
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
            <p className="texto-2 text-sm">El corte del mes se está calculando; aparece aquí en unos minutos.</p>
          )}
        </Seccion>
      </div>

      {mes?.porModelo?.length ? (
        <Seccion
          titulo={`Modelos que más venden en ${nombreDelPeriodo(periodo)}`}
          descripcion="Todos los canales juntos"
          acciones={
            <Link href="/cortes" className="enlace text-[13px]">
              Ver el corte
            </Link>
          }
          sinRelleno
        >
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
              {[...mes.porModelo]
                .sort((x, y) => y.importe - x.importe)
                .slice(0, 8)
                .map((x) => (
                  <tr key={x.modelo}>
                    <td className="font-medium">{x.modelo}</td>
                    <td className="texto-2 text-xs">{x.canales.map((k) => NOMBRE_CANAL[k].split(" ·")[0]).join(", ")}</td>
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
        </Seccion>
      ) : null}
    </Pagina>
  );
}

/** Orden de colores fijo y validado (índigo, naranja, aqua, rosa); no se cicla. */
const SERIES: SerieApilada[] = [
  { clave: "calzado", nombre: "Calzado · MELI", color: "#4f46e5" },
  { clave: "amazon", nombre: "Amazon", color: "#eb6834" },
  { clave: "fundas", nombre: "Fundas · MELI", color: "#1baf7a" },
  { clave: "tiktok", nombre: "TikTok", color: "#e87ba4" },
];

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

function horaMx(): number {
  return new Date(Date.now() - 6 * 3_600_000).getUTCHours();
}

function saludo(): string {
  const h = horaMx();
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
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
