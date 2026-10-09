import Link from "next/link";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/yapanizcel/cuenta";
import { normalizarRango, obtenerMonitorYz, type Totales } from "@/lib/yapanizcel/ventas";
import { hoyMx } from "@/lib/yapanizcel/db";
import { Ficha } from "@/components/tiles";
import { FiltroFechas } from "@/components/filtro-fechas";
import { n, pesos } from "@/components/yapanizcel/comunes";
import { Aviso, Cifras, Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";
import { TablaVentasYz } from "@/components/yapanizcel/tabla-ventas";
import { Pestanas } from "@/components/ui/pestanas";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function pct(x: number | null): string {
  return x == null ? "—" : `${(x * 100).toFixed(1)}%`;
}

function notaGanancia(t: Totales): string {
  // La ganancia SOLO cubre la venta con costo cargado; lo demás se declara
  // (antes el neto sin costo entraba como ganancia pura y la inflaba).
  const partes = [`neto con costo ${pesos(t.netoConCosto)}`, `costo ${pesos(t.costo)}`];
  if (t.unidadesSinCosto) partes.push(`${n(t.unidadesSinCosto)} u. (${pesos(t.netoSinCosto)}) sin costo, fuera de la cuenta`);
  return partes.join(" · ");
}

export default async function VentasYz({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const sp = await searchParams;
  const rango = normalizarRango(sp.desde, sp.hasta);
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta servicio="yapanizcel" titulo="Ventas fundas" />;

  // Masticado por rango en yz_cache: se sirve lo guardado y, si ya tiene
  // más de 10 min, se refresca por atrás con el cliente admin.
  const { monitor: m, generadoEn } = await obtenerMonitorYz(supabase, cuenta.id, rango, { dbFondo: clienteAdmin() });
  const variacion = m.anterior.unidades > 0 ? (m.periodo.unidades - m.anterior.unidades) / m.anterior.unidades : null;

  return (
    <Pagina>
      <Encabezado
        ceja="Fundas"
        titulo="Ventas fundas"
        descripcion="Unidades, venta, neto depositado y ganancia de YAPANIZCEL por diseño y por SKU."
        frescura={generadoEn}
        ayuda={
          <>
            <p>
              Unidades, ventas, comisión de Mercado Libre, neto real depositado (ya sin comisión, envío de Full ni
              retenciones) y ganancia contra el costo cargado.
            </p>
            <p>
              Nada se estima: la venta cuyo depósito aún no se lee queda fuera del neto y de la ganancia, y se declara
              aparte. El cron de netos lee los depósitos solo cada 10 minutos.
            </p>
            <p>
              La ganancia solo cubre la venta con costo cargado: un SKU sin costo queda fuera de la cuenta (contarlo como
              si costara $0 la inflaba). Los costos se capturan en Productos y costos (Bodega), donde viven los de calzado y
              fundas.
            </p>
          </>
        }
      />
      <FiltroFechas base="/yapanizcel/ventas" desde={rango.desde} hasta={rango.hasta} hoy={hoyMx()} />

      <Cifras columnas={5}>
        <Ficha titulo="Hoy" valor={n(m.hoy.unidades)} nota={`${pesos(m.hoy.importe)} · ${n(m.hoy.ordenes)} órdenes`} tono="bien" />
        <Ficha titulo="Ayer" valor={n(m.ayer.unidades)} nota={pesos(m.ayer.importe)} />
        <Ficha
          titulo="Periodo"
          valor={n(m.periodo.unidades)}
          nota={`${pesos(m.periodo.importe)}${variacion != null ? ` · ${variacion >= 0 ? "+" : ""}${Math.round(variacion * 100)}% vs anterior` : ""}`}
        />
        <Ficha
          titulo="Neto depositado"
          valor={pesos(m.periodo.neto)}
          nota={`${pct(m.periodo.importe - m.periodo.ventaSinNeto > 0 ? m.periodo.neto / (m.periodo.importe - m.periodo.ventaSinNeto) : null)} de la venta con depósito leído${m.periodo.ventaSinNeto > 0 ? ` · ${pesos(m.periodo.ventaSinNeto)} de venta aún sin leer (fuera)` : " · todo real"}`}
          tono={m.periodo.ventaSinNeto > m.periodo.importe * 0.2 ? "alerta" : "neutro"}
        />
        <Ficha titulo="Ganancia" valor={pesos(m.periodo.ganancia)} nota={notaGanancia(m.periodo)} tono={m.periodo.unidadesSinCosto ? "alerta" : m.periodo.ganancia >= 0 ? "bien" : "critico"} />
      </Cifras>

      {m.skusSinCosto ? (
        <Aviso tono="alerta">
          {m.skusSinCosto} SKUs vendieron sin costo cargado: su neto ({pesos(m.periodo.netoSinCosto)}) queda fuera de la ganancia.
          Captura el costo en <Link href="/productos" className="enlace">Productos y costos</Link>.
        </Aviso>
      ) : null}

      <Pestanas
        pestanas={[
          {
            id: "diseno",
            titulo: "Por diseño",
            cuenta: m.porDiseno.length,
            contenido: (
              <>
                <TablaVentasYz titulo="Por diseño" filas={m.porDiseno} />
              </>
            ),
          },
          {
            id: "sku",
            titulo: "Por SKU",
            cuenta: m.porSku.length,
            contenido: (
              <>
                <TablaVentasYz titulo="Por SKU" filas={m.porSku} conTitulo />
              </>
            ),
          },
        ]}
      />
    </Pagina>
  );
}
