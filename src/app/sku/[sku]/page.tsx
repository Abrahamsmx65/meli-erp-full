import Link from "next/link";
import { notFound } from "next/navigation";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { historialDeSku } from "@/lib/servicios/historial";
import { GraficaHistorial } from "@/components/grafica-historial";
import { Estado } from "@/components/estado";
import { Ficha } from "@/components/tiles";
import { Cifras, Encabezado, Pagina, Seccion } from "@/components/ui/pagina";
import { Pestanas } from "@/components/ui/pestanas";

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
    <Pagina>
      <div className="flex flex-col gap-2">
        <Link href="/envios" className="enlace text-sm">
          ← Volver a Envíos a Full
        </Link>
        <Encabezado
          ceja="Inventario"
          titulo={
            <span className="flex flex-wrap items-center gap-3">
              {h.sku}
              <Estado estado={l.estado} />
            </span>
          }
          descripcion={h.titulo || undefined}
        />
      </div>

      {/* ---- Los cuatro números que importan ----------------------------- */}
      <Cifras columnas={4}>
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
      </Cifras>

      <Pestanas
        pestanas={[
          {
            id: "historial",
            titulo: "Historial",
            contenido: (
              <>
                {/* ---- La gráfica -------------------------------------------------- */}
                <Seccion
                  titulo={`Últimos ${c.diasCalendario} días`}
                >
                  <GraficaHistorial dias={h.dias} nivelObjetivo={l.nivelObjetivo} />
                </Seccion>

                {/* ---- De dónde sale cada día -------------------------------------- */}
                <Seccion
                  titulo="De dónde salen estos números"
                  ayuda={
                    <p>
                      Mercado Libre no guarda «cuánto stock había el 12 de junio». Lo que da es el{" "}
                      <strong>registro de movimientos</strong>: cada entrada, venta, ajuste o devolución con su hora exacta y el
                      nivel que quedó después. El nivel de cada día se reconstruye a partir de eso — el último movimiento del día es
                      el cierre real.
                    </p>
                  }
                >
                  <div className="text-sm">
                  <ul className="flex flex-col gap-1 texto-2">
                    <li>
                      <strong className="cifra">{cobertura.diasConMovimiento}</strong> días
                      con movimientos de Mercado Libre
                    </li>
                    <li>
                      <strong className="cifra">{cobertura.diasConFoto}</strong> días medidos
                      con la foto diaria
                    </li>
                    {cobertura.diasDeducidos > 0 ? (
                      <li style={{ color: "var(--alerta-texto)" }}>
                        <strong className="cifra">{cobertura.diasDeducidos}</strong> días
                        deducidos (sin movimiento ni foto)
                      </li>
                    ) : null}
                  </ul>
                  {!cobertura.hayMovimientos ? (
                    <p className="mt-3" style={{ color: "var(--alerta-texto)" }}>
                      Sin movimientos en Full en el periodo: historial deducido.
                    </p>
                  ) : null}
                  </div>
                </Seccion>
              </>
            ),
          },
          {
            id: "cuenta",
            titulo: "La cuenta",
            contenido: (
              <>
                {/* ---- La cuenta, paso a paso -------------------------------------- */}
                <Seccion titulo={`Cómo se llega a ${n(l.sugerido)} pares`} sinRelleno>

                  <div className="flex flex-col divide-y" style={{ borderColor: "var(--grid)" }}>
                    <Paso
                      num={1}
                      titulo="Qué días tuvo stock de verdad"
                      cuenta={`${c.diasConStock} de ${c.diasCalendario} días`}
                    >
                      <strong>{c.diasSinStock} días</strong> sin stock.
                    </Paso>

                    <Paso
                      num={2}
                      titulo="Venta real por día"
                      cuenta={`${c.unidadesVendidas} ÷ ${c.diasConStock} = ${c.tasaCorregida}/día`}
                    >
                      Sin corregir: <strong>{c.tasaCruda}/día</strong>
                      {c.factorCorreccion > 1.05 ? ` (×${c.factorCorreccion})` : ""}.
                    </Paso>

                    <Paso
                      num={3}
                      titulo="Ajuste por tendencia y recencia"
                      cuenta={`${c.demandaDiaria}/día`}
                    >
                      {c.factorTendencia !== 1
                        ? `${c.factorTendencia > 1 ? "Al alza" : "A la baja"}, factor ×${c.factorTendencia}.`
                        : "Sin tendencia marcada."}{" "}
                      Confianza del dato: <strong>{c.confianza}</strong>.
                    </Paso>

                    <Paso
                      num={4}
                      titulo="Colchón para la variabilidad"
                      cuenta={`${n(l.stockSeguridad)} pares`}
                    >
                      Desviación {c.sigmaDiaria} pares/día · servicio {(p.nivelServicio * 100).toFixed(0)}% ·
                      ventana de {c.ventanaRiesgo} días ({p.leadTimeDias} + {c.periodoRevision}).
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
                        ? ` y ${n(l.enTransferencia)} en transferencia`
                        : ""}
                      . Alcanzan para{" "}
                      <strong>
                        {l.coberturaDias === Infinity ? "—" : `${l.coberturaDias.toFixed(0)} días`}
                      </strong>
                      {l.fechaQuiebre ? `, hasta el ${l.fechaQuiebre}` : ""}.
                    </Paso>

                    <Paso num={7} titulo="Lo que hay que mandar" cuenta={`${n(l.sugerido)} pares`}>
                      {n(l.nivelObjetivo)} − {n(l.posicion)} = <strong>{n(l.sugerido)}</strong>.
                    </Paso>
                  </div>

                  <footer className="border-t p-4 text-sm hairline texto-2">
                    {l.explicacion}
                  </footer>
                </Seccion>
              </>
            ),
          },
          {
            id: "dias",
            titulo: "Día a día",
            cuenta: h.dias.length,
            contenido: (
              <>
                <Seccion
                  titulo="El día a día"
                  sinRelleno
                >
                  <div className="max-h-[32rem] overflow-auto">
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
                            <td className="text-xs texto-tenue">
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
                </Seccion>
              </>
            ),
          },
        ]}
      />
    </Pagina>
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
        <p className="mt-1 text-sm texto-2">
          {children}
        </p>
      </div>
    </div>
  );
}
