import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import {
  cargarMonitor,
  diasDeRango,
  fechaMx,
  normalizarRango,
  type Movimiento,
} from "@/lib/servicios/ventas-monitor";
import { cargarPublicidad } from "@/lib/servicios/publicidad";
import { Ficha } from "@/components/tiles";
import { FiltroFechas } from "@/components/filtro-fechas";
import Link from "next/link";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

/**
 * Monitor de ventas de Mercado Libre.
 *
 * "Hoy" se mueve solo: los avisos de MELI actualizan las ventas al momento y
 * la página se refresca cuando hay plan nuevo. La comparación de la semana es
 * a nivel producto (modelo + color), con la razón del movimiento al lado.
 */
export default async function Ventas({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const sp = await searchParams;
  const rango = normalizarRango(sp.desde, sp.hasta);
  const dias = diasDeRango(rango);

  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Conecta Mercado Libre</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          Las ventas salen de tu cuenta de Mercado Libre; primero hay que conectarla en
          Ajustes.
        </p>
      </div>
    );
  }

  // La publicidad del mismo periodo, para que la ganancia del panel ya la
  // tenga descontada: recibo − costo − publicidad. Si Product Ads no
  // contesta, el panel lo dice y la ganancia se muestra sin ads.
  const [m, ads] = await Promise.all([
    cargarMonitor(supabase, cuenta.id, rango),
    cargarPublicidad(supabase, cuenta, rango).catch((err) => ({
      totales: { gastoAds: 0 },
      errorAds: `No se pudo leer Product Ads: ${(err as Error).message}`,
    })),
  ]);
  const gastoAds = ads.errorAds ? null : ads.totales.gastoAds;
  const gananciaConAds = gastoAds == null ? null : m.desglose.gananciaReal - gastoAds;
  const etiquetaRango = `${rango.desde} → ${rango.hasta}`;
  const mesDelRango = rango.hasta.slice(0, 7);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">Ventas</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          En vivo: los avisos de Mercado Libre actualizan estos números solos. Todo lo
          demás corre sobre el periodo elegido, comparado contra el periodo anterior
          del mismo largo.
        </p>
      </div>

      <FiltroFechas base="/ventas" desde={rango.desde} hasta={rango.hasta} hoy={fechaMx(0)} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Ficha
          titulo="Hoy"
          valor={n(m.hoy.unidades)}
          nota={`${pesos(m.hoy.importe)} · ${n(m.hoy.ordenes)} órdenes`}
          tono="bien"
        />
        <Ficha
          titulo="Ayer"
          valor={n(m.ayer.unidades)}
          nota={pesos(m.ayer.importe)}
        />
        <Ficha
          titulo={`Periodo (${dias} días)`}
          valor={n(m.semana.unidades)}
          nota={`${pesos(m.semana.importe)} · ${etiquetaRango}`}
        />
        <Ficha
          titulo="Ritmo diario"
          valor={n(m.semana.unidades / dias)}
          nota="Promedio del periodo"
        />
        <Ficha
          titulo="Ganancia del periodo"
          valor={m.coberturaCosto > 0 ? pesos(gananciaConAds ?? m.ganancia7) : "—"}
          nota={
            m.coberturaCosto > 0
              ? `Neto de MELI − costo${gastoAds != null ? " − publicidad" : ""} · ${Math.round(m.coberturaCosto * 100)}% de la venta con costo`
              : "Captura costos en Productos y costos"
          }
          tono={m.coberturaCosto > 0 && (gananciaConAds ?? m.ganancia7) < 0 ? "critico" : "neutro"}
        />
      </div>

      {/* ---- A dónde se fue el dinero del periodo ------------------------- */}
      <section className="tarjeta p-4">
        <h2 className="text-sm font-semibold">A dónde se fue el dinero del periodo</h2>
        <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
          La cuenta es: lo que Mercado Pago DEPOSITÓ por cada orden (ya sin comisión,
          envío de Full ni retenciones) − costo del producto − publicidad = ganancia. El
          neto es el depósito real donde ya llegó ({Math.round(m.desglose.coberturaNetoReal * 100)}%
          del importe del periodo); donde aún no, se estima como importe − comisión.
          Devoluciones, cancelaciones tardías y gastos de Full entran en el corte del mes:{" "}
          <Link href={`/ventas/cortes?mes=${mesDelRango}`} style={{ color: "var(--acento)" }}>
            Cortes y ganancia
          </Link>
          .
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
          <Ficha titulo="Venta bruta" valor={pesos(m.desglose.bruto)} nota="Precio × unidades" />
          <Ficha
            titulo="Comisión MELI"
            valor={pesos(-m.desglose.comision)}
            nota="Cargo por venta (sale fee)"
            tono={m.desglose.comision > 0 ? "alerta" : "neutro"}
          />
          <Ficha
            titulo="Envíos y otros"
            valor={m.desglose.enviosYOtros != null ? pesos(-m.desglose.enviosYOtros) : "—"}
            nota={
              m.desglose.enviosYOtros != null
                ? "Fletes, retenciones y cargos, según el depósito real"
                : "Se sabrá cuando llegue el neto real del periodo"
            }
            tono={(m.desglose.enviosYOtros ?? 0) > 0 ? "alerta" : "neutro"}
          />
          <Ficha
            titulo="Neto depositado"
            valor={pesos(m.desglose.neto)}
            nota="Lo que Mercado Pago deposita"
          />
          <Ficha
            titulo="Costo de producto"
            valor={m.desglose.costoProducto > 0 ? pesos(-m.desglose.costoProducto) : "—"}
            nota={`${Math.round(m.coberturaCosto * 100)}% de la venta con costo capturado`}
          />
          <Ficha
            titulo="Ganancia bruta"
            valor={m.coberturaCosto > 0 ? pesos(m.desglose.gananciaReal) : "—"}
            nota="Neto − costo de producto"
            tono={m.coberturaCosto > 0 && m.desglose.gananciaReal < 0 ? "critico" : "neutro"}
          />
          <Ficha
            titulo="Publicidad"
            valor={gastoAds != null ? pesos(-gastoAds) : "—"}
            nota={ads.errorAds ?? "Product Ads del periodo"}
            tono={(gastoAds ?? 0) > 0 ? "alerta" : "neutro"}
          />
          <Ficha
            titulo="Ganancia después de ads"
            valor={m.coberturaCosto > 0 && gananciaConAds != null ? pesos(gananciaConAds) : "—"}
            nota={gastoAds != null ? "Neto − costo − publicidad" : "Sin dato de publicidad"}
            tono={
              m.coberturaCosto > 0 && gananciaConAds != null
                ? gananciaConAds < 0
                  ? "critico"
                  : "bien"
                : "neutro"
            }
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Movimientos titulo="Suben en el periodo" lista={m.subiendo} positivo />
        <Movimientos titulo="Bajan en el periodo" lista={m.bajando} />
      </div>

      {m.porCategoria.length ? (
        <section className="tarjeta overflow-hidden">
          <header className="border-b p-4 hairline">
            <h2 className="text-base font-semibold">Por categoría</h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
              Las categorías se capturan en Productos y costos. Neto = lo que MELI
              deposita (ya sin su comisión); ganancia = neto − costo.
            </p>
          </header>
          <table className="datos">
            <thead>
              <tr>
                <th>Categoría</th>
                <th className="num">Unidades</th>
                <th className="num">Venta</th>
                <th className="num">Neto</th>
                <th className="num">Ganancia</th>
              </tr>
            </thead>
            <tbody>
              {m.porCategoria.map((c) => (
                <tr key={c.categoria}>
                  <td className="font-medium">{c.categoria}</td>
                  <td className="num cifra">{n(c.unidades7)}</td>
                  <td className="num cifra">{pesos(c.importe7)}</td>
                  <td className="num cifra">{pesos(c.neto7)}</td>
                  <td
                    className="num cifra"
                    style={{
                      color:
                        c.ganancia7 != null && c.ganancia7 < 0
                          ? "var(--estado-critico)"
                          : "var(--ink-1)",
                    }}
                  >
                    {c.ganancia7 == null ? "—" : pesos(c.ganancia7)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="text-base font-semibold">Por modelo</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Todas las tallas y colores de cada modelo, juntos, en el periodo elegido,
            contra el periodo anterior del mismo largo.
          </p>
        </header>
        <div className="max-h-[36rem] overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>Modelo</th>
                <th className="num">Colores</th>
                <th className="num">Hoy</th>
                <th className="num">Periodo</th>
                <th className="num">Previo</th>
                <th className="num">Cambio</th>
                <th className="num">Importe</th>
                <th className="num">Ganancia</th>
              </tr>
            </thead>
            <tbody>
              {m.porModelo.map((f) => {
                const delta = f.unidades7 - f.unidades7Prev;
                return (
                  <tr key={f.modelo}>
                    <td className="font-medium">{f.modelo}</td>
                    <td className="num cifra">{f.colores}</td>
                    <td className="num cifra">{n(f.unidadesHoy)}</td>
                    <td className="num cifra font-semibold">{n(f.unidades7)}</td>
                    <td className="num cifra" style={{ color: "var(--ink-muted)" }}>
                      {n(f.unidades7Prev)}
                    </td>
                    <td
                      className="num cifra"
                      style={{
                        color:
                          delta > 0
                            ? "var(--exito-texto)"
                            : delta < 0
                              ? "var(--estado-critico)"
                              : "var(--ink-muted)",
                      }}
                    >
                      {delta > 0 ? `+${n(delta)}` : n(delta)}
                    </td>
                    <td className="num cifra">{pesos(f.importe7)}</td>
                    <td
                      className="num cifra"
                      style={{
                        color:
                          f.ganancia7 != null && f.ganancia7 < 0
                            ? "var(--estado-critico)"
                            : "var(--ink-1)",
                      }}
                    >
                      {f.ganancia7 == null ? "—" : pesos(f.ganancia7)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Movimientos({
  titulo,
  lista,
  positivo,
}: {
  titulo: string;
  lista: Movimiento[];
  positivo?: boolean;
}) {
  return (
    <section className="tarjeta overflow-hidden">
      <header className="border-b p-3 hairline">
        <h2 className="text-sm font-semibold">{titulo}</h2>
      </header>
      {lista.length === 0 ? (
        <p className="p-4 text-sm" style={{ color: "var(--ink-2)" }}>
          Sin movimientos grandes esta semana.
        </p>
      ) : (
        <ul>
          {lista.map((mv) => (
            <li
              key={mv.producto}
              className="flex items-start gap-3 border-b px-4 py-2.5 last:border-b-0 hairline"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{mv.producto}</div>
                <div className="text-xs" style={{ color: "var(--ink-2)" }}>
                  {mv.razon}
                </div>
              </div>
              <div className="text-right">
                <div
                  className="cifra text-sm font-semibold"
                  style={{
                    color: positivo ? "var(--exito-texto)" : "var(--estado-critico)",
                  }}
                >
                  {mv.delta > 0 ? `+${n(mv.delta)}` : n(mv.delta)}
                </div>
                <div className="cifra text-xs" style={{ color: "var(--ink-muted)" }}>
                  {n(mv.antes)} → {n(mv.ahora)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
