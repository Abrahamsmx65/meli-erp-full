import Link from "next/link";
import { notFound } from "next/navigation";
import { EncabezadoPublico } from "@/components/encabezado-publico";
import { Pastilla } from "@/components/pastilla";
import { formatearFolio } from "@/lib/codigos";
import { fechaLarga, pesos } from "@/lib/formato";
import { obtenerPedido } from "@/lib/pedidos";
import { FormularioAviso } from "./formulario-aviso";

export const dynamic = "force-dynamic";

export default async function PaginaPedido({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ nuevo?: string }>;
}) {
  const { id } = await params;
  const { nuevo } = await searchParams;
  const datos = await obtenerPedido(id);
  if (!datos) notFound();
  const { pedido, evento, boletos, renglones } = datos;
  const nombreTipo = new Map(renglones.map((r) => [r.tipo_id, r.tipo ?? "Entrada"]));

  return (
    <>
      <EncabezadoPublico />
      <main className="mx-auto grid max-w-2xl gap-5 px-4 pb-16">
        {nuevo && pedido.estado === "pendiente" && (
          <div className="aviso aviso-bien">
            Tu pedido quedó registrado. Te mandamos estas mismas instrucciones a <strong>{pedido.correo}</strong>.
          </div>
        )}

        <section className="tarjeta p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-xs font-bold uppercase tracking-[.2em]" style={{ color: "var(--tinta-suave)" }}>Pedido</div>
              <h1 className="mono text-2xl font-bold" style={{ color: "var(--vino)" }}>{pedido.referencia}</h1>
            </div>
            <Pastilla estado={pedido.estado} />
          </div>
          <dl className="mt-4 grid gap-1 text-sm" style={{ color: "var(--tinta-2)" }}>
            <div className="flex justify-between gap-4"><dt>Evento</dt><dd className="serif text-right text-lg font-semibold" style={{ color: "var(--tinta)" }}>{evento.nombre}</dd></div>
            <div className="flex justify-between gap-4"><dt>Fecha</dt><dd className="text-right">{fechaLarga(evento.fecha)}</dd></div>
            {evento.lugar && <div className="flex justify-between gap-4"><dt>Lugar</dt><dd className="text-right">{evento.lugar}</dd></div>}
            <div className="flex justify-between gap-4"><dt>A nombre de</dt><dd className="text-right">{pedido.nombre}</dd></div>
          </dl>
          <div className="separador-oro my-3" />
          <dl className="grid gap-1 text-sm">
            {renglones.map((r) => (
              <div key={r.id} className="flex justify-between"><dt>{r.cantidad} × {r.tipo ?? "Boleto"}</dt><dd>{pesos(r.cantidad * r.precio_unitario)}</dd></div>
            ))}
            {pedido.donativos > 0 && evento.donativo_monto && (
              <div className="flex justify-between"><dt>{pedido.donativos} × {evento.donativo_nombre ?? "Donativo"}</dt><dd>{pesos(pedido.donativos * evento.donativo_monto)}</dd></div>
            )}
            <div className="mt-1 flex justify-between border-t pt-2 text-base" style={{ borderColor: "var(--borde)" }}>
              <dt className="font-semibold">Total</dt>
              <dd className="serif text-2xl font-bold" style={{ color: "var(--vino)" }}>{pesos(pedido.total)}</dd>
            </div>
          </dl>
        </section>

        {pedido.estado === "cancelado" && (
          <div className="aviso aviso-mal">Este pedido fue cancelado. Si crees que es un error, contacta a las organizadoras.</div>
        )}

        {(pedido.estado === "pendiente" || pedido.estado === "por_confirmar") && (
          <>
            <section className="tarjeta p-6">
              <h2 className="serif text-2xl font-semibold" style={{ color: "var(--vino)" }}>1. Transfiere {pesos(pedido.total)}</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--tinta-2)" }}>
                Pon esta referencia como <strong>concepto</strong> para que ubiquemos tu pago:
              </p>
              <div className="mono my-3 rounded-xl py-3 text-center text-3xl font-bold tracking-widest" style={{ background: "var(--vino-suave)", color: "var(--vino)" }}>
                {pedido.referencia}
              </div>
              <pre className="whitespace-pre-wrap rounded-xl p-4 text-sm" style={{ background: "var(--plano)", fontFamily: "inherit" }}>
                {evento.datos_transferencia || "Las organizadoras te compartirán los datos bancarios."}
              </pre>
            </section>

            <section className="tarjeta p-6">
              <h2 className="serif text-2xl font-semibold" style={{ color: "var(--vino)" }}>2. Avísanos que ya pagaste</h2>
              {pedido.estado === "por_confirmar" && (
                <div className="aviso aviso-alerta my-3">
                  Ya recibimos tu aviso. Estamos revisando la transferencia; en cuanto la confirmemos te llegan tus boletos.
                </div>
              )}
              <div className="mt-3">
                <FormularioAviso pedidoId={pedido.id} yaAviso={pedido.estado === "por_confirmar"} />
              </div>
            </section>
          </>
        )}

        {pedido.estado === "pagado" && (
          <section className="tarjeta p-6">
            <h2 className="serif text-2xl font-semibold" style={{ color: "var(--vino)" }}>{boletos.length > 0 ? "Tus boletos" : "¡Gracias!"}</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--tinta-2)" }}>
              {boletos.length > 0 ? <>También te los mandamos a {pedido.correo}. Cada QR entra una sola vez.</> : <>Tu pago quedó confirmado.</>}
            </p>
            <ul className="mt-4 grid gap-2">
              {boletos.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 rounded-xl border p-3" style={{ borderColor: "var(--borde)" }}>
                  <div>
                    <div className="font-bold">{b.tipo_id ? nombreTipo.get(b.tipo_id) : "Entrada"}</div>
                    <div className="mono text-xs" style={{ color: "var(--tinta-suave)" }}>{formatearFolio(b.folio)}</div>
                  </div>
                  <Pastilla estado={b.estado} />
                  <Link className="boton boton-suave !px-3 !py-2 text-sm" href={`/boleto/${b.codigo}`}>Ver QR</Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
