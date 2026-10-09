import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Container, Package, ShoppingBag, Truck, TriangleAlert } from "lucide-react";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { servirMonitor, fechaMx } from "@/lib/servicios/ventas-monitor";
import { leerConsolidadoGuardado } from "@/lib/servicios/consolidado-cargar";
import { nombreDelPeriodo, periodoActual } from "@/lib/servicios/corte-meli";
import { leerPlanParcial } from "@/lib/servicios/cache";
import { NOMBRE_CANAL } from "@/lib/servicios/consolidado";
import { Ficha } from "@/components/tiles";
import { Cifras, Encabezado, Pagina, Seccion, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/**
 * Inicio (pedido del dueño, 9-oct-2026: «sí quiero una página de inicio»):
 * lo que pasa HOY en el negocio y lo que toca hacer, en una sola vista.
 *
 * Regla de arquitectura: aquí no se calcula NADA. Todo sale de renglones ya
 * masticados —el monitor de ventas (`app_cache`, lo deja listo el latido),
 * el corte general del mes (`consolidado_cache`), el resumen y los
 * pendientes del plan (`plan_cache`, solo esas claves)— más tres conteos
 * baratos (pedidos de TikTok sin corte y contenedores). Si un renglón aún no
 * existe, su bloque simplemente no sale.
 */
export default async function Inicio() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Inicio" />;

  const periodo = periodoActual();
  const [monitor, mes, plan, tiktok, contenedores] = await Promise.all([
    servirMonitor(supabase, cuenta.id).catch(() => null),
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
  ]);

  const m = monitor?.datos ?? null;
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
        titulo={saludo()}
        descripcion="Lo que se vendió, lo que se gana y lo que toca hacer hoy."
        frescura={monitor?.generadoEn ?? mes?.generadoEn ?? null}
        refrescando={monitor?.refrescando}
      />

      <Cifras columnas={4}>
        <Ficha
          titulo="Vendido hoy · Mercado Libre"
          valor={m ? pesos(m.hoy.importe) : "—"}
          nota={m ? `${n(m.hoy.unidades)} pares · ayer ${pesos(m.ayer.importe)}` : "Sin datos de hoy todavía"}
        />
        <Ficha
          titulo="Últimos 7 días · Mercado Libre"
          valor={m ? pesos(m.semana.importe) : "—"}
          nota={m ? `${n(m.semana.unidades)} pares · ${n(m.semana.ordenes)} órdenes` : undefined}
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

      {m && (m.subiendo.length || m.bajando.length) ? (
        <div className="grid gap-6 md:grid-cols-2">
          <Movimientos titulo="Suben esta semana" lista={m.subiendo} sube />
          <Movimientos titulo="Bajan esta semana" lista={m.bajando} />
        </div>
      ) : null}
    </Pagina>
  );
}

interface Tarea {
  href: string;
  icono: typeof Package;
  titulo: string;
  valor: number | null;
  detalle: string;
  urgente: boolean;
}

function Movimientos({
  titulo,
  lista,
  sube,
}: {
  titulo: string;
  lista: { producto: string; antes: number; ahora: number; delta: number }[];
  sube?: boolean;
}) {
  const Flecha = sube ? ArrowUpRight : ArrowDownRight;
  const color = sube ? "var(--exito-texto)" : "var(--critico-texto)";
  return (
    <Seccion
      titulo={titulo}
      acciones={
        <Link href="/ventas" className="enlace text-[13px]">
          Ver ventas
        </Link>
      }
      sinRelleno
    >
      {lista.length ? (
        <table className="datos">
          <thead>
            <tr>
              <th>Producto</th>
              <th className="num">Antes</th>
              <th className="num">Ahora</th>
              <th className="num">Cambio</th>
            </tr>
          </thead>
          <tbody>
            {lista.slice(0, 5).map((x) => (
              <tr key={x.producto}>
                <td className="font-medium">{x.producto}</td>
                <td className="num cifra texto-2">{n(x.antes)}</td>
                <td className="num cifra">{n(x.ahora)}</td>
                <td className="num cifra" style={{ color }}>
                  <span className="inline-flex items-center gap-0.5">
                    <Flecha size={14} aria-hidden="true" />
                    {n(Math.abs(x.delta))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="vacio">Sin cambios fuertes esta semana.</p>
      )}
    </Seccion>
  );
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
