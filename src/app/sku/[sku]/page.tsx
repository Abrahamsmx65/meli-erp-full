import Link from "next/link";
import { notFound } from "next/navigation";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { historialDeSku } from "@/lib/servicios/historial";
import { GraficaHistorial } from "@/components/grafica-historial";
import { Estado } from "@/components/estado";
import { Ficha } from "@/components/tiles";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

export default async function DetalleSku({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku: skuCrudo } = await params;
  const sku = decodeURIComponent(skuCrudo);

  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) notFound();

  const h = await historialDeSku(supabase, cuenta.id, sku);
  if (!h) notFound();

  const { linea: l, cuentas: c, parametros: p, cobertura } = h;
  const objetivoPorHorizonte = Math.round(c.demandaDiaria * p.horizonteDias);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/envios" className="text-sm underline" style={{ color: "var(--acento)" }}>
          ← Volver a Envíos a Full
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="titulo-pagina">{h.sku}</h1>
          <Estado estado={l.estado} />
        </div>
        {h.titulo ? (
          <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
            {h.titulo}
          </p>
        ) : null}
      </div>

      {/* ---- Los cuatro números que importan ----------------------------- */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Ficha
          titulo="Días agotado"
          valor={c.diasSinStock}
          nota={`de ${c.diasCalendario} días analizados`}
          tono={c.diasSinStock > 7 ? "critico" : "neutro"}
        />
        <Ficha
          titulo="Venta perdida"
          valor={n(c.ventaPerdida)}
          nota="Pares que no se vendieron por falta de stock"
          tono={c.ventaPerdida > 0 ? "alerta" : "bien"}
        />
        <Ficha
          titulo="Venta real al día"
          valor={c.demandaDiaria.toFixed(1)}
          nota={c.factorCorreccion > 1.05 ? `${c.factorCorreccion}× la venta aparente` : "Sin corrección"}
        />
        <Ficha
          titulo="Hay que mandar"
          valor={n(l.sugerido)}
          nota={`Para llegar a ${p.horizonteDias} días de cobertura`}
          tono={l.sugerido > 0 ? "alerta" : "bien"}
        />
      </div>

      {/* ---- La gráfica -------------------------------------------------- */}
      <section className="tarjeta p-4">
        <h2 className="mb-1 font-semibold">Últimos {c.diasCalendario} días</h2>
        <p className="mb-3 text-sm" style={{ color: "var(--ink-2)" }}>
          Arriba, cuánto inventario había en Full cada día. Abajo, cuántos pares se
          vendieron. Las franjas rojas son los días en que no había nada que vender.
        </p>
        <GraficaHistorial dias={h.dias} nivelObjetivo={l.nivelObjetivo} />
      </section>

      {/* ---- De dónde sale cada día -------------------------------------- */}
      <section className="tarjeta p-4 text-sm">
        <h2 className="mb-2 font-semibold">De dónde salen estos números</h2>
        <p style={{ color: "var(--ink-2)" }}>
          Mercado Libre no guarda «cuánto stock había el 12 de junio». Lo que da es el{" "}
          <strong>registro de movimientos</strong>: cada entrada, venta, ajuste o
          devolución con su hora exacta y el nivel que quedó después. El nivel de
          cada día se reconstruye a partir de eso — el último movimiento del día es
          el cierre real.
        </p>
        <ul className="mt-3 flex flex-col gap-1" style={{ color: "var(--ink-2)" }}>
          <li>
            <strong className="cifra">{cobertura.diasConMovimiento}</strong> días
            reconstruidos con movimientos de Mercado Libre
          </li>
          <li>
            <strong className="cifra">{cobertura.diasConFoto}</strong> días medidos
            con la foto diaria que toma el sistema al sincronizar
          </li>
          {cobertura.diasDeducidos > 0 ? (
            <li style={{ color: "var(--estado-alerta)" }}>
              <strong className="cifra">{cobertura.diasDeducidos}</strong> días
              deducidos: no hubo ni movimiento ni foto, así que se arrastra el nivel
              del día anterior
            </li>
          ) : null}
        </ul>
        {!cobertura.hayMovimientos ? (
          <p className="mt-3" style={{ color: "var(--estado-alerta)" }}>
            Este SKU no tiene ningún movimiento en Full en el periodo. Su historial es
            una deducción a partir del patrón de ventas, no una medición: tómalo como
            orientación, no como dato duro.
          </p>
        ) : null}
      </section>

      {/* ---- La cuenta, paso a paso -------------------------------------- */}
      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="font-semibold">Cómo se llega a {n(l.sugerido)} pares</h2>
        </header>

        <div className="flex flex-col divide-y" style={{ borderColor: "var(--grid)" }}>
          <Paso
            num={1}
            titulo="Qué días tuvo stock de verdad"
            cuenta={`${c.diasConStock} de ${c.diasCalendario} días`}
          >
            Los días agotados no cuentan, y los días que abrieron con poco y se
            acabaron a media jornada cuentan solo la fracción que duraron. Aquí{" "}
            <strong>{c.diasSinStock} días</strong> no tuvieron nada que vender.
          </Paso>

          <Paso
            num={2}
            titulo="Venta real por día"
            cuenta={`${c.unidadesVendidas} ÷ ${c.diasConStock} = ${c.tasaCorregida}/día`}
          >
            Dividir entre los {c.diasCalendario} días de calendario daría{" "}
            <strong>{c.tasaCruda}/día</strong>, que es lo que aparenta. Pero se
            vendieron {c.unidadesVendidas} pares en solo {c.diasConStock} días
            vendibles, así que el ritmo real es{" "}
            <strong>{c.tasaCorregida}/día</strong>
            {c.factorCorreccion > 1.05 ? ` — ${c.factorCorreccion}× más` : ""}.
          </Paso>

          <Paso
            num={3}
            titulo="Ajuste por tendencia y recencia"
            cuenta={`${c.demandaDiaria}/día`}
          >
            Los últimos 30 días pesan la mitad; los 30 anteriores, 30%; los más
            viejos, 20%.
            {c.factorTendencia !== 1
              ? ` Además va ${c.factorTendencia > 1 ? "al alza" : "a la baja"}, factor ×${c.factorTendencia}.`
              : " Sin tendencia marcada."}{" "}
            Confianza del dato: <strong>{c.confianza}</strong>.
          </Paso>

          <Paso
            num={4}
            titulo="Colchón para la variabilidad"
            cuenta={`${n(l.stockSeguridad)} pares`}
          >
            No todos los días se vende igual: la desviación es {c.sigmaDiaria}{" "}
            pares/día. El colchón cubre {(p.nivelServicio * 100).toFixed(0)}% de los
            casos durante la ventana de riesgo de {c.ventanaRiesgo} días — los{" "}
            {p.leadTimeDias} que tarda en llegar el envío más los {c.periodoRevision}{" "}
            hasta el siguiente.
          </Paso>

          <Paso
            num={5}
            titulo="Cuánto debería haber en Full"
            cuenta={`${n(l.nivelObjetivo)} pares`}
          >
            {c.demandaDiaria} × {p.horizonteDias} días = {n(objetivoPorHorizonte)}{" "}
            pares, más {n(l.stockSeguridad)} de colchón.
          </Paso>

          <Paso
            num={6}
            titulo="Lo que ya está allá"
            cuenta={`${n(l.posicion)} pares`}
          >
            {n(l.disponible)} disponibles
            {l.enTransferencia > 0
              ? ` y ${n(l.enTransferencia)} en transferencia, que ya son tuyos y van en camino`
              : ""}
            . Alcanzan para{" "}
            <strong>
              {l.coberturaDias === Infinity ? "—" : `${l.coberturaDias.toFixed(0)} días`}
            </strong>
            {l.fechaQuiebre ? `, hasta el ${l.fechaQuiebre}` : ""}.
          </Paso>

          <Paso num={7} titulo="Lo que hay que mandar" cuenta={`${n(l.sugerido)} pares`}>
            {n(l.nivelObjetivo)} − {n(l.posicion)} = <strong>{n(l.sugerido)}</strong>.
            Eso es en pares; lo que de verdad viaja depende de cómo cuadren las cajas,
            porque no se abren.
          </Paso>
        </div>

        <footer className="border-t p-4 text-sm hairline" style={{ color: "var(--ink-2)" }}>
          {l.explicacion}
        </footer>
      </section>

      {/* ---- Tabla, para quien quiera el dato crudo ---------------------- */}
      <details className="tarjeta p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Ver el día a día en tabla
        </summary>
        <div className="mt-3 max-h-[24rem] overflow-auto">
          <table className="datos">
            <thead>
              <tr>
                <th>Fecha</th>
                <th className="num">Al abrir</th>
                <th className="num">Vendido</th>
                <th className="num">Al cerrar</th>
                <th className="num">Día vendible</th>
                <th>Origen</th>
              </tr>
            </thead>
            <tbody>
              {[...h.dias].reverse().map((d) => (
                <tr key={d.fecha}>
                  <td className="cifra">{d.fecha}</td>
                  <td className="num cifra">{n(d.inicio)}</td>
                  <td className="num cifra">{d.unidades || "—"}</td>
                  <td className="num cifra">{n(d.fin)}</td>
                  <td
                    className="num cifra"
                    style={{ color: d.fraccion < 0.5 ? "var(--estado-critico)" : "var(--ink-2)" }}
                  >
                    {d.fraccion === 1 ? "1.00" : d.fraccion.toFixed(2)}
                  </td>
                  <td className="text-xs" style={{ color: "var(--ink-muted)" }}>
                    {d.origen === "operaciones" ? "Movimiento MELI"
                      : d.origen === "snapshot" ? "Foto del día"
                      : d.origen === "inferido" ? "Inferido de ventas"
                      : "Arrastrado"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function Paso({
  num,
  titulo,
  cuenta,
  children,
}: {
  num: number;
  titulo: string;
  cuenta: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4 p-4">
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
        style={{ background: "var(--acento-suave)", color: "var(--acento)" }}
      >
        {num}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-medium">{titulo}</h3>
          <span className="cifra text-sm font-semibold">{cuenta}</span>
        </div>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
          {children}
        </p>
      </div>
    </div>
  );
}
