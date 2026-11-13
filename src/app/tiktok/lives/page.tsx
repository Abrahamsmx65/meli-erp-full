import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { fechaMx, normalizarRango } from "@/lib/servicios/ventas-monitor";
import { cargarMisLives } from "@/lib/servicios/tiktok-lives";
import { FiltroFechas } from "@/components/filtro-fechas";
import { Ficha } from "@/components/tiles";
import { Aviso, Cifras, Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";
import { LivesTikTok } from "@/components/lives-tiktok";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

function horas(min: number): string {
  if (min < 60) return `${min} min`;
  return `${Math.round((min / 60) * 10) / 10} h`;
}

/**
 * Mis LIVE: los LIVE propios de la tienda (cuenta oficial y de marketing; los
 * de creadores no), con lo que TikTok dice de cada uno y los pedidos de la
 * tienda que entraron mientras duró. Todo sale de `tiktok_lives`, que llena
 * el cron de pagos cada hora (`servicios/tiktok-lives.ts`); la pantalla solo
 * lee. Pedido del dueño (13-nov-2026).
 */
export default async function MisLivesPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const sp = await searchParams;
  const rango = normalizarRango(sp.desde ?? fechaMx(29), sp.hasta);

  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Mis LIVE" />;

  const admin = clienteAdmin();
  const datos = await cargarMisLives(admin, cuenta.id, rango);
  const r = datos.resumen;
  const conGanancia = r.pedidosTienda - r.pedidosSinDato - r.pedidosSinCosto;

  return (
    <Pagina vivo={300_000}>
      <Encabezado
        ceja="TikTok Shop"
        titulo="Mis LIVE"
        descripcion="Cada LIVE propio: qué se vendió, cuántos lo vieron, los pedidos que entraron y cuánto dejaron."
        frescura={datos.leidoEn ?? undefined}
        ayuda={
          <>
            <p>
              «Venta TikTok», pedidos, piezas, espectadores y pico son la analítica de TikTok de cada sesión de LIVE de
              nuestras cuentas (oficial y de marketing); los LIVE de creadores no están aquí, van en Ventas → Creadores.
              TikTok entrega la sesión en dólares aunque se le pida en pesos, así que la venta en pesos es la suma de lo
              vendido producto por producto en ese live (venta directa; la indirecta, lo comprado después de ver el live,
              se enseña en dólares al abrir el renglón). Nunca se convierte con un tipo de cambio.
            </p>
            <p>
              TikTok no dice qué pedido salió de qué live, así que «Pedidos tienda», «Me paga TikTok» y «Ganancia» son los
              pedidos de la TIENDA (sin creador) que entraron entre el inicio del live y 30 minutos después de su fin: lo
              que TikTok paga por cada uno según sus transacciones (nunca una estimación) menos el costo de Productos y
              costos. Un pedido del que TikTok aún no publica transacciones va «sin dato» y no entra a la ganancia.
            </p>
            <p>Se lee cada hora junto con los pagos; los productos y los pedidos de un live recién terminado se completan en la siguiente hora.</p>
          </>
        }
      />
      <FiltroFechas base="/tiktok/lives" desde={rango.desde} hasta={rango.hasta} hoy={fechaMx()} precargar />

      {datos.sinLectura ? (
        <Aviso tono="info">TikTok todavía no entrega la analítica de los LIVE: la primera lectura corre en la siguiente hora.</Aviso>
      ) : null}
      {datos.error ? (
        <Aviso tono="alerta" titulo="La última lectura de los LIVE falló">
          TikTok contestó: {datos.error}. Si dice que falta permiso, hay que autorizar «Analytics» a la app en el Partner Center y volver a conectar la tienda.
        </Aviso>
      ) : null}

      <Cifras columnas={6}>
        <Ficha titulo="LIVE" valor={n(r.lives)} nota={r.lives ? `${horas(r.minutos)} al aire en total` : "en estas fechas"} />
        <Ficha
          titulo="Venta TikTok"
          valor={pesos(r.gmv)}
          nota={r.livesSinVentaEnPesos ? `${r.livesSinVentaEnPesos} LIVE sin venta en pesos todavía (TikTok la dio en dólares y faltan sus productos)` : "según TikTok, en pesos; con la sesión en dólares, la suma de sus productos"}
          tono={r.livesSinVentaEnPesos ? "alerta" : "neutro"}
        />
        <Ficha titulo="Pedidos TikTok" valor={n(r.pedidosTikTok)} nota={`${n(r.piezas)} piezas · según TikTok`} />
        <Ficha titulo="Espectadores" valor={n(r.espectadores)} nota={r.picoMaximo ? `pico máximo: ${n(r.picoMaximo)} al mismo tiempo` : "sumados"} />
        <Ficha
          titulo="Me paga TikTok"
          valor={r.pagaTikTok ? pesos(r.pagaTikTok) : "—"}
          nota={`${n(r.pedidosTienda)} pedidos de la tienda en la ventana de los LIVE${r.pedidosSinDato ? ` · ${r.pedidosSinDato} sin dato` : ""}`}
          tono={r.pedidosSinDato ? "alerta" : "neutro"}
        />
        <Ficha
          titulo="Ganancia"
          valor={conGanancia > 0 ? pesos(r.ganancia) : "—"}
          nota={conGanancia > 0 ? `sobre ${n(conGanancia)} pedidos con dato y costo${r.pedidosSinCosto ? ` · ${r.pedidosSinCosto} sin costo` : ""}` : "se calcula con el pago de TikTok y el costo capturado"}
          tono={conGanancia > 0 && r.ganancia < 0 ? "critico" : "neutro"}
        />
      </Cifras>

      <LivesTikTok lives={datos.lives} />
    </Pagina>
  );
}
