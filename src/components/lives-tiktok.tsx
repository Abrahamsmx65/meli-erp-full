import type { LiveGuardado } from "@/lib/servicios/tiktok-lives";
import { NOMBRE_CUENTA } from "@/lib/tiktok/lives";
import { Seccion } from "@/components/ui/pagina";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

function pct(x: number | null): string {
  if (x == null) return "—";
  const v = x * 100;
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}%`;
}

function fechaHora(iso: string | null, conFecha = true): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-MX", {
    ...(conFecha ? { day: "2-digit", month: "short" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Mexico_City",
  });
}

function duracion(min: number | null): string {
  if (min == null) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function segundos(s: number): string {
  if (!s) return "—";
  if (s < 60) return `${Math.round(s)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

const COLOR_GANANCIA = (g: number | null) => (g == null ? "var(--ink-2)" : g < 0 ? "var(--estado-critico)" : "var(--estado-bien)");

/**
 * La lista de los LIVE propios del rango, cada uno con lo que TikTok dice
 * (venta atribuida, pedidos, espectadores, pico) y lo que el ERP sabe de los
 * pedidos de la tienda que entraron en su ventana (lo que paga TikTok, costo
 * y ganancia). Al abrir un renglón: los productos vendidos en ese live según
 * TikTok, el tráfico y la interacción, y los pedidos uno por uno.
 */
export function LivesTikTok({ lives }: { lives: LiveGuardado[] }) {
  return (
    <Seccion titulo="Cada LIVE" descripcion="Del más reciente al más viejo. Abre un renglón para ver los productos, el tráfico y los pedidos." sinRelleno>
      <div className="tabla-caja">
        <table className="datos">
          <thead>
            <tr>
              <th>LIVE</th>
              <th className="num">Duración</th>
              <th className="num">Espectadores</th>
              <th className="num">Pico</th>
              <th className="num">Venta TikTok</th>
              <th className="num">Pedidos TikTok</th>
              <th className="num">Piezas</th>
              <th className="num">Pedidos tienda</th>
              <th className="num">Me paga TikTok</th>
              <th className="num">Ganancia</th>
            </tr>
          </thead>
          <tbody>
            {lives.map((l) => {
              const s = l.sesion;
              const p = l.pedidos;
              const t = p?.totales;
              return (
                <tr key={s.liveId} className="align-top">
                  <td>
                    <details>
                      <summary className="cursor-pointer">
                        <span className="font-medium">{fechaHora(s.inicio)}</span>
                        {s.fin ? <span className="texto-2"> → {fechaHora(s.fin, false)}</span> : null}
                        <div className="text-xs texto-2">
                          {s.titulo ?? "(sin título)"}
                          {s.creador?.usuario ? ` · @${s.creador.usuario}` : ""}
                          {" · "}
                          {NOMBRE_CUENTA[s.cuentaTipo] ?? s.cuentaTipo}
                        </div>
                      </summary>
                      <DetalleLive live={l} />
                    </details>
                  </td>
                  <td className="num cifra">{duracion(s.duracionMin)}</td>
                  <td className="num cifra" title={`${n(s.trafico.vistas)} vistas`}>{n(s.trafico.espectadores)}</td>
                  <td className="num cifra" title={`${n(s.trafico.promedioConcurrentes)} en promedio al mismo tiempo`}>{n(s.trafico.pico)}</td>
                  <td className="num cifra font-medium" title={`${pesos(s.ventas.gmvDirecto)} durante el live + ${pesos(s.ventas.gmvIndirecto)} después (indirecta)`}>
                    {pesos(s.ventas.gmv)}
                  </td>
                  <td className="num cifra" title={`${n(s.ventas.clientes)} clientes · ${n(s.ventas.productosVendidos)} productos distintos`}>{n(s.ventas.pedidos)}</td>
                  <td className="num cifra">{n(s.ventas.piezas)}</td>
                  <td className="num cifra" title={t ? `${n(t.pares)} pares · ${pesos(t.cobrado)} de venta · pedidos de la tienda entre el inicio y ${p!.ventana.minutosDespues} min después del fin` : "todavía no se arman"}>
                    {t ? n(t.pedidos) : "—"}
                  </td>
                  <td className="num cifra" title={t?.pedidosSinDato ? `${t.pedidosSinDato} pedidos sin dato de TikTok todavía` : undefined}>
                    {t && t.pagaTikTok ? pesos(t.pagaTikTok) : "—"}
                    {t?.pedidosSinDato ? <div className="text-xs" style={{ color: "var(--estado-alerta)" }}>{t.pedidosSinDato} sin dato</div> : null}
                  </td>
                  <td className="num cifra font-semibold" style={{ color: COLOR_GANANCIA(t && t.pedidosConGanancia ? t.ganancia : null) }} title={t ? `sobre ${t.pedidosConGanancia} pedidos con dato y costo${t.pedidosSinCosto ? ` · ${t.pedidosSinCosto} sin costo` : ""}` : undefined}>
                    {t && t.pedidosConGanancia ? pesos(t.ganancia) : "—"}
                  </td>
                </tr>
              );
            })}
            {!lives.length ? (
              <tr>
                <td className="px-4 py-6 text-center text-sm texto-2" colSpan={10}>
                  Sin LIVE propios en estas fechas.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Seccion>
  );
}

function DetalleLive({ live }: { live: LiveGuardado }) {
  const s = live.sesion;
  const p = live.pedidos;
  const t = p?.totales;
  return (
    <div className="mt-3 grid gap-4 text-xs lg:grid-cols-2">
      <div>
        <div className="mb-1 font-medium">Según TikTok</div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt className="texto-2">Venta durante el live</dt>
          <dd className="num">{pesos(s.ventas.gmvDirecto)}</dd>
          <dt className="texto-2">Venta después (indirecta)</dt>
          <dd className="num">{pesos(s.ventas.gmvIndirecto)}</dd>
          <dt className="texto-2">Ticket promedio</dt>
          <dd className="num">{s.ventas.ticketPromedio ? pesos(s.ventas.ticketPromedio) : "—"}</dd>
          <dt className="texto-2">Pedidos pagados</dt>
          <dd className="num">{pct(s.ventas.tasaPago)}</dd>
          <dt className="texto-2">Productos agregados / vendidos</dt>
          <dd className="num">{n(s.ventas.productosAgregados)} / {n(s.ventas.productosVendidos)}</dd>
          <dt className="texto-2">Vistas / espectadores</dt>
          <dd className="num">{n(s.trafico.vistas)} / {n(s.trafico.espectadores)}</dd>
          <dt className="texto-2">Al mismo tiempo (pico / promedio)</dt>
          <dd className="num">{n(s.trafico.pico)} / {n(s.trafico.promedioConcurrentes)}</dd>
          <dt className="texto-2">Tiempo promedio viendo</dt>
          <dd className="num">{segundos(s.trafico.duracionPromedioVista)}</dd>
          <dt className="texto-2">Clics a producto</dt>
          <dd className="num">{n(s.trafico.clicsProducto)} · {pct(s.trafico.ctr)} de las vistas</dd>
          <dt className="texto-2">Venta por hora / por mil vistas</dt>
          <dd className="num">{pesos(s.trafico.gmvPorHora)} / {pesos(s.trafico.gpm)}</dd>
          <dt className="texto-2">Likes · comentarios · compartidos</dt>
          <dd className="num">{n(s.interaccion.likes)} · {n(s.interaccion.comentarios)} · {n(s.interaccion.compartidos)}</dd>
          <dt className="texto-2">Seguidores nuevos</dt>
          <dd className="num">{n(s.interaccion.seguidoresNuevos)}</dd>
        </dl>
        <div className="mb-1 mt-3 font-medium">Productos vendidos en el live</div>
        {live.productos == null ? (
          <p className="texto-2">Todavía no se leen: llegan en la siguiente hora.</p>
        ) : !live.productos.length ? (
          <p className="texto-2">TikTok no atribuye ningún producto a este live.</p>
        ) : (
          <table className="datos">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">Piezas</th>
                <th className="num">Venta</th>
                <th className="num">Pedidos</th>
                <th className="num">Clics</th>
                <th className="num">Al carrito</th>
              </tr>
            </thead>
            <tbody>
              {live.productos.map((pr) => (
                <tr key={pr.productId}>
                  <td title={pr.productId}>{pr.nombre ?? pr.productId}</td>
                  <td className="num">{n(pr.piezas)}</td>
                  <td className="num">{pesos(pr.gmv)}</td>
                  <td className="num">{n(pr.pedidos || pr.pedidosSku)}</td>
                  <td className="num" title={`${n(pr.impresiones)} impresiones · ${pct(pr.ctr)}`}>{n(pr.clics)}</td>
                  <td className="num">{n(pr.alCarrito)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div>
        <div className="mb-1 font-medium">Pedidos de la tienda en la ventana del live</div>
        {!p ? (
          <p className="texto-2">Todavía no se arman: llegan en la siguiente hora.</p>
        ) : (
          <>
            <p className="texto-2">
              Lo que entró a la tienda (sin creadores) entre {fechaHora(p.ventana.desde, false)} y {fechaHora(p.ventana.hasta, false)} ({p.ventana.minutosDespues} min después del fin). TikTok no dice qué pedido salió del live; TikTok le atribuye {n(s.ventas.pedidos)}.
              {t!.deCreadores ? ` ${n(t!.deCreadores)} pedidos de creadores en el mismo rato quedan fuera.` : ""}
              {t!.sinRevisar ? ` ${n(t!.sinRevisar)} aún sin revisar contra afiliados.` : ""}
            </p>
            <div className="num my-1">
              {n(t!.pedidos)} pedidos · {n(t!.pares)} pares · venta {pesos(t!.cobrado)} · me paga TikTok {pesos(t!.pagaTikTok)}
              {t!.pedidosSinDato ? ` (${t!.pedidosSinDato} sin dato)` : ""} · costo {pesos(t!.costo)} ·{" "}
              <span className="font-semibold" style={{ color: COLOR_GANANCIA(t!.pedidosConGanancia ? t!.ganancia : null) }}>
                ganancia {t!.pedidosConGanancia ? pesos(t!.ganancia) : "—"}
              </span>
              {t!.pedidosSinCosto ? ` · ${t!.pedidosSinCosto} sin costo` : ""}
            </div>
            {p.pedidos.length ? (
              <table className="datos">
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Pedido</th>
                    <th>SKU</th>
                    <th className="num">Venta</th>
                    <th className="num">Paga TikTok</th>
                    <th className="num">Costo</th>
                    <th className="num">Ganancia</th>
                  </tr>
                </thead>
                <tbody>
                  {p.pedidos.map((o) => (
                    <tr key={o.orderId}>
                      <td className="whitespace-nowrap">{fechaHora(o.creadoEn, false)}</td>
                      <td className="num">{o.orderId}</td>
                      <td>{o.skus.map((k) => (k.cantidad > 1 ? `${k.sku} ×${k.cantidad}` : k.sku)).join(", ")}</td>
                      <td className="num">{pesos(o.cobrado)}</td>
                      <td className="num">{o.pagaTikTok != null ? pesos(o.pagaTikTok) : <span style={{ color: "var(--estado-alerta)" }}>sin dato</span>}</td>
                      <td className="num texto-2">{o.costo != null ? pesos(o.costo) : "sin costo"}</td>
                      <td className="num font-semibold" style={{ color: COLOR_GANANCIA(o.ganancia) }}>{o.ganancia != null ? pesos(o.ganancia) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="texto-2">Ningún pedido de la tienda entró en ese rato.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
