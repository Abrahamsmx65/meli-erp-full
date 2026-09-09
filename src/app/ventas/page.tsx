import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { diasDeRango, fechaMx, normalizarRango, type Movimiento } from "@/lib/servicios/ventas-monitor";
import { vistaVentas } from "@/lib/servicios/ventas-vista";
import { CascadaDinero } from "@/components/cascada-dinero";
import { cronometro } from "@/lib/servicios/cronometro";
import { Ficha } from "@/components/tiles";
import { FiltroFechas } from "@/components/filtro-fechas";
import { TablaModelosVentas } from "@/components/tabla-modelos-ventas";
import { compactarFilasModelo, paginarFilasTabla } from "@/lib/servicios/ventas-tabla";
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

  const t = cronometro("/ventas");
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  t.marca("cuenta");
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

  // Todo llega masticado del servicio: el monitor con la publicidad ya
  // descontada, la cascada real del dinero y los cuadres entre niveles.
  // Esta página no hace ninguna cuenta.
  const vista = await vistaVentas(supabase, cuenta, rango, t);
  t.fin();
  const { monitor: m, gastoAds, gananciaConAds, finanzas, cuadres } = vista;
  const ads = { errorAds: vista.errorAds, advertencias: vista.advertenciasAds };
  const descuadres = cuadres.filter((c) => c.diferencia !== 0);
  const etiquetaRango = `${rango.desde} → ${rango.hasta}`;

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

      {ads.errorAds || ads.advertencias.length ? (
        <div
          className="tarjeta p-4 text-sm"
          style={{ background: "color-mix(in oklab, var(--estado-alerta) 12%, transparent)" }}
        >
          <strong>Datos parciales.</strong>{" "}
          {ads.errorAds
            ? `${ads.errorAds} Las ventas siguen visibles, pero publicidad y ganancias después de ads se muestran como no disponibles.`
            : ads.advertencias.join(" ")}{" "}
          Vuelve a intentar; si continúa, revisa la conexión en Ajustes.
        </div>
      ) : null}

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
      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="text-base font-semibold">A dónde se fue el dinero del periodo</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Lo que Mercado Pago dice de cada orden: la venta bruta menos cada cargo,
            hasta lo que recibes. Lo que Mercado Pago no desglosa o cuyo pago aún no
            se ha leído aparece como «sin identificar», nunca repartido ni escondido.
            Devoluciones, cancelaciones tardías y gastos de Full entran en el{" "}
            <Link href="/cortes" style={{ color: "var(--acento)" }}>
              Corte general
            </Link>
            .
          </p>
        </header>
        <CascadaDinero finanzas={finanzas} />
        <div className="grid grid-cols-2 gap-3 border-t p-4 hairline md:grid-cols-4">
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
        {descuadres.length ? (
          <footer
            className="border-t p-3 text-xs hairline"
            style={{ color: "var(--estado-critico)" }}
            role="alert"
          >
            <strong>No cuadra:</strong>{" "}
            {descuadres
              .map((c) => `${c.que}: ${pesos(c.arriba)} arriba vs ${pesos(c.abajo)} abajo (${pesos(c.diferencia / 100)})`)
              .join(" · ")}
          </footer>
        ) : null}
      </section>

      {m.porCategoria.length ? (
        <section className="tarjeta overflow-hidden">
          <header className="border-b p-4 hairline">
            <h2 className="text-base font-semibold">Por categoría</h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
              Las categorías se capturan en Productos y costos. Neto = lo que MELI
              deposita (ya sin su comisión); ganancia = neto − costo − publicidad del
              modelo que la gastó.
              {ads.errorAds ? " Product Ads no contestó: la ganancia va SIN publicidad." : ""}
            </p>
          </header>
          <table className="datos">
            <thead>
              <tr>
                <th>Categoría</th>
                <th className="num">Unidades</th>
                <th className="num">Venta</th>
                <th className="num">Neto</th>
                <th className="num">Publicidad</th>
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
                  <td className="num cifra" style={{ color: "var(--ink-2)" }}>
                    {c.publicidad7 == null ? "—" : pesos(c.publicidad7)}
                  </td>
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
            {/* El total va abajo para cotejarlo con las fichas de arriba: si
                no cuadra, el aviso de la sección del dinero lo dice. */}
            <tfoot>
              <tr style={{ background: "var(--surface-2)" }}>
                <td className="font-semibold">Total</td>
                <td className="num cifra font-semibold">{n(m.porCategoria.reduce((a, c) => a + c.unidades7, 0))}</td>
                <td className="num cifra font-semibold">{pesos(m.porCategoria.reduce((a, c) => a + c.importe7, 0))}</td>
                <td className="num cifra font-semibold">{pesos(m.porCategoria.reduce((a, c) => a + c.neto7, 0))}</td>
                <td className="num cifra font-semibold" style={{ color: "var(--ink-2)" }}>
                  {gastoAds == null ? "—" : pesos(m.porCategoria.reduce((a, c) => a + (c.publicidad7 ?? 0), 0))}
                </td>
                <td className="num cifra font-semibold">
                  {m.coberturaCosto > 0 ? pesos(m.porCategoria.reduce((a, c) => a + (c.ganancia7 ?? 0), 0)) : "—"}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>
      ) : null}

      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="text-base font-semibold">Por modelo</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Todas las tallas y colores de cada modelo, juntos, en el periodo elegido,
            contra el periodo anterior del mismo largo. Ganancia = neto − costo −
            publicidad del modelo{ads.errorAds ? " (sin dato de ads ahora: va sin publicidad)" : ""}. Busca por
            modelo o SKU, filtra por categoría y da clic en una columna para ordenar.
          </p>
        </header>
        <TablaModelosVentas
          desde={rango.desde}
          hasta={rango.hasta}
          inicial={paginarFilasTabla(compactarFilasModelo(m.porModelo), {
            busqueda: "",
            categoria: "",
            orden: { clave: "unidades7", desc: true },
            pagina: 1,
          })}
        />
      </section>

      {/* ---- Lo que se mueve, al final: primero los números, luego el chisme */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Movimientos titulo="Suben en el periodo" lista={m.subiendo} positivo />
        <Movimientos titulo="Bajan en el periodo" lista={m.bajando} />
      </div>
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
