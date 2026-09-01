import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarPanelTikTok, DIAS_VENTA } from "@/lib/servicios/tiktok-panel";
import { AccionesTikTok } from "@/components/tiktok-acciones";
import { EntradasTikTok } from "@/components/tiktok-entradas";
import { PendientesTikTok } from "@/components/tiktok-pendientes";
import { Ficha } from "@/components/tiles";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function cuando(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const NOMBRE_TIPO: Record<string, string> = {
  entrada: "Entrada",
  salida: "Salida",
  devolucion: "Devolución",
  merma: "Merma",
  ajuste: "Ajuste",
};

/**
 * El almacén de TikTok Shop.
 *
 * Es el único canal donde el ERP no lee el inventario, sino que lo LLEVA: los
 * pares salen de una bodega nuestra, así que lo que aquí diga es lo que
 * TikTok le ofrece a un comprador. La pantalla está armada alrededor de esa
 * responsabilidad — arriba lo que TikTok todavía no sabe, y luego el porqué.
 */
export default async function TikTok({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const sp = await searchParams;

  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">Conecta Mercado Libre primero</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          TikTok Shop cuelga de la misma cuenta del ERP: el catálogo de SKUs con el que se
          amarran sus publicaciones sale de ahí.
        </p>
      </div>
    );
  }

  const p = await cargarPanelTikTok(supabase, cuenta.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Almacén TikTok Shop</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Envío propio. El saldo físico llega solo de la bodega TikTok de Industher; el ERP le
            resta lo pagado sin salir y le escribe a TikTok el disponible. Última sincronización:{" "}
            {cuando(p.ultimaSync)}.
          </p>
        </div>
        {p.conectado ? <AccionesTikTok porPublicar={p.totales.porPublicar} /> : null}
      </div>

      {sp.ok ? (
        <p className="rounded-lg px-3 py-2 text-sm" style={{ background: "var(--acento-suave)" }}>
          {sp.ok}
        </p>
      ) : null}
      {sp.error ? (
        <p
          className="rounded-lg px-3 py-2 text-sm"
          style={{ background: "color-mix(in oklab, var(--estado-critico) 12%, transparent)" }}
        >
          {sp.error}
        </p>
      ) : null}

      {!p.conectado ? (
        <section className="tarjeta p-5">
          <h2 className="text-sm font-semibold">TikTok Shop no está conectado</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
            El kardex ya funciona sin conexión: puedes capturar entradas y llevar el saldo. Lo que
            falta al conectar es lo importante — que el disponible se le escriba a TikTok solo, y
            que los envíos confirmados descuenten sin capturarlos.
          </p>
          <p className="mt-2 text-sm font-medium">
            La conexión se inicia SOLO desde este botón. Si autorizas desde el panel de
            TikTok (partner.tiktokshop.com), TikTok te regresa sin forma de amarrarlo a tu
            sesión y no queda conectado.
          </p>
          <a
            href="/api/tiktok/conectar"
            className="mt-3 inline-block rounded-lg px-3 py-1.5 text-sm font-medium text-white"
            style={{ background: "var(--acento)" }}
          >
            Conectar TikTok Shop
          </a>
        </section>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Ficha titulo="SKUs" valor={p.totales.skus} nota="con movimiento" />
        <Ficha titulo="En almacén" valor={n(p.totales.saldo)} nota="pares físicos" />
        <Ficha
          titulo="Apartado"
          valor={n(p.totales.apartado)}
          nota="pagado, sin salir"
          tono={p.totales.apartado ? "alerta" : "neutro"}
        />
        <Ficha titulo="Disponible" valor={n(p.totales.disponible)} nota="ofrecible a compradores" />
        <Ficha
          titulo="Por publicar"
          valor={p.totales.porPublicar}
          nota="TikTok no lo sabe aún"
          tono={p.totales.porPublicar ? "critico" : "bien"}
        />
      </div>

      {p.totales.enRojo ? (
        <section
          className="rounded-lg p-3 text-sm"
          style={{ background: "color-mix(in oklab, var(--estado-critico) 12%, transparent)" }}
        >
          {p.totales.enRojo} SKU con saldo negativo: se vendieron pares que nunca se capturaron
          como entrada. Captura la entrada que falta o haz un ajuste por conteo.
        </section>
      ) : null}

      <PendientesTikTok pendientes={p.pendientes} />

      <EntradasTikTok />

      <section className="tarjeta overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="text-sm font-semibold">Inventario por SKU</h2>
          <span className="text-xs" style={{ color: "var(--ink-2)" }}>
            Venta de los últimos {DIAS_VENTA} días
          </span>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                <th className="px-4 py-2 font-semibold">SKU</th>
                <th className="px-4 py-2 text-right font-semibold">En almacén</th>
                <th className="px-4 py-2 text-right font-semibold">Apartado</th>
                <th className="px-4 py-2 text-right font-semibold">Disponible</th>
                <th className="px-4 py-2 text-right font-semibold">En TikTok</th>
                <th className="px-4 py-2 text-right font-semibold">Venta {DIAS_VENTA}d</th>
                <th className="px-4 py-2 text-right font-semibold">Cobertura</th>
              </tr>
            </thead>
            <tbody>
              {p.renglones.map((r) => (
                <tr key={r.sku} className="hairline">
                  <td className="px-4 py-2">
                    <span className="font-medium">{r.sku}</span>
                    {r.titulo ? (
                      <span className="block text-xs" style={{ color: "var(--ink-2)" }}>
                        {r.titulo}
                      </span>
                    ) : null}
                    {!r.contado ? (
                      <span className="block text-xs" style={{ color: "var(--estado-alerta)" }}>
                        sin conteo inicial: a TikTok no se le escribe hasta capturar una entrada o
                        un ajuste
                      </span>
                    ) : !r.publicable ? (
                      <span className="block text-xs" style={{ color: "var(--estado-alerta)" }}>
                        sin publicación en TikTok
                      </span>
                    ) : null}
                  </td>
                  <td
                    className="num px-4 py-2 text-right"
                    style={{ color: r.enRojo ? "var(--estado-critico)" : undefined }}
                  >
                    {n(r.saldo)}
                  </td>
                  <td className="num px-4 py-2 text-right" style={{ color: "var(--ink-2)" }}>
                    {r.apartado ? n(r.apartado) : "—"}
                  </td>
                  <td className="num px-4 py-2 text-right font-semibold">{n(r.disponible)}</td>
                  <td
                    className="num px-4 py-2 text-right"
                    style={{ color: r.desfasado ? "var(--estado-critico)" : "var(--ink-2)" }}
                  >
                    {r.publicado == null ? "—" : n(r.publicado)}
                  </td>
                  <td className="num px-4 py-2 text-right" style={{ color: "var(--ink-2)" }}>
                    {r.ventas30 ? n(r.ventas30) : "—"}
                  </td>
                  <td className="num px-4 py-2 text-right" style={{ color: "var(--ink-2)" }}>
                    {r.diasCobertura == null ? "—" : `${Math.round(r.diasCobertura)} d`}
                  </td>
                </tr>
              ))}
              {!p.renglones.length ? (
                <tr>
                  <td className="px-4 py-6 text-center text-sm" colSpan={7} style={{ color: "var(--ink-2)" }}>
                    Todavía no hay nada en el almacén de TikTok. Captura la primera entrada arriba.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="tarjeta overflow-hidden">
        <h2 className="px-4 pt-4 text-sm font-semibold">Últimos movimientos</h2>
        <p className="px-4 text-xs" style={{ color: "var(--ink-2)" }}>
          Cada par que entró o salió, con su motivo. Es lo que deja auditar un saldo sin creerle a
          nadie.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                <th className="px-4 py-2 font-semibold">Cuándo</th>
                <th className="px-4 py-2 font-semibold">SKU</th>
                <th className="px-4 py-2 font-semibold">Movimiento</th>
                <th className="px-4 py-2 text-right font-semibold">Pares</th>
                <th className="px-4 py-2 font-semibold">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {p.movimientos.map((m) => (
                <tr key={m.id} className="hairline">
                  <td className="px-4 py-2" style={{ color: "var(--ink-2)" }}>{cuando(m.fecha)}</td>
                  <td className="px-4 py-2 font-medium">{m.sku}</td>
                  <td className="px-4 py-2">{NOMBRE_TIPO[m.tipo] ?? m.tipo}</td>
                  <td
                    className="num px-4 py-2 text-right"
                    style={{
                      color:
                        m.tipo === "salida" || m.tipo === "merma"
                          ? "var(--estado-critico)"
                          : m.tipo === "ajuste"
                            ? "var(--ink-1)"
                            : "var(--exito-texto)",
                    }}
                  >
                    {m.tipo === "ajuste" ? "=" : m.tipo === "salida" || m.tipo === "merma" ? "−" : "+"}
                    {n(m.cantidad)}
                  </td>
                  <td className="px-4 py-2" style={{ color: "var(--ink-2)" }}>
                    {m.motivo ?? "—"}
                    {m.referencia ? ` · pedido ${m.referencia}` : ""}
                  </td>
                </tr>
              ))}
              {!p.movimientos.length ? (
                <tr>
                  <td className="px-4 py-6 text-center text-sm" colSpan={5} style={{ color: "var(--ink-2)" }}>
                    Sin movimientos todavía.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
