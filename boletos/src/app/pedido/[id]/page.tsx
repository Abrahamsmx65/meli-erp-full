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
  const { pedido, evento, boletos } = datos;

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
              <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--tinta-suave)" }}>
                Pedido
              </div>
              <h1 className="mono text-2xl font-bold">{pedido.referencia}</h1>
            </div>
            <Pastilla estado={pedido.estado} />
          </div>
          <dl className="mt-4 grid gap-1 text-sm" style={{ color: "var(--tinta-2)" }}>
            <div className="flex justify-between"><dt>Evento</dt><dd className="text-right font-semibold" style={{ color: "var(--tinta)" }}>{evento.nombre}</dd></div>
            <div className="flex justify-between"><dt>Fecha</dt><dd className="text-right">{fechaLarga(evento.fecha)}</dd></div>
            <div className="flex justify-between"><dt>A nombre de</dt><dd className="text-right">{pedido.nombre}</dd></div>
            <div className="flex justify-between"><dt>Boletos</dt><dd className="text-right">{pedido.cantidad}</dd></div>
            <div className="flex justify-between text-base"><dt>Total</dt><dd className="text-right font-extrabold" style={{ color: "var(--tinta)" }}>{pesos(pedido.total)}</dd></div>
          </dl>
        </section>

        {pedido.estado === "cancelado" && (
          <div className="aviso aviso-mal">Este pedido fue cancelado. Si crees que es un error, contacta al organizador.</div>
        )}

        {(pedido.estado === "pendiente" || pedido.estado === "por_confirmar") && (
          <>
            <section className="tarjeta p-6">
              <h2 className="text-lg font-bold">1. Transfiere {pesos(pedido.total)}</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--tinta-2)" }}>
                Pon esta referencia como <strong>concepto</strong> para que ubiquemos tu pago:
              </p>
              <div className="mono my-3 rounded-xl py-3 text-center text-3xl font-bold tracking-widest" style={{ background: "var(--plano)" }}>
                {pedido.referencia}
              </div>
              <pre className="whitespace-pre-wrap rounded-xl p-4 text-sm" style={{ background: "var(--fondo)", fontFamily: "inherit" }}>
                {evento.datos_transferencia || "El organizador aún no capturó los datos bancarios."}
              </pre>
            </section>

            <section className="tarjeta p-6">
              <h2 className="text-lg font-bold">2. Avísanos que ya pagaste</h2>
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
            <h2 className="text-lg font-bold">Tus boletos</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--tinta-2)" }}>
              También te los mandamos a {pedido.correo}. Cada QR entra una sola vez.
            </p>
            <ul className="mt-4 grid gap-2">
              {boletos.map((b) => (
                <li key={b.id} className="flex items-center justify-between rounded-xl border p-3" style={{ borderColor: "var(--borde)" }}>
                  <span className="mono">{formatearFolio(b.folio)}</span>
                  <Pastilla estado={b.estado} />
                  <Link className="boton boton-suave !py-2 !px-3 text-sm" href={`/boleto/${b.codigo}`}>
                    Ver QR
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
