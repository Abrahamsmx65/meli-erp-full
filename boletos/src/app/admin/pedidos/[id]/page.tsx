import Link from "next/link";
import { notFound } from "next/navigation";
import { Pastilla } from "@/components/pastilla";
import { formatearFolio } from "@/lib/codigos";
import { fechaCorta, fechaLarga, pesos } from "@/lib/formato";
import { obtenerPedido, urlComprobante } from "@/lib/pedidos";
import { AccionesPedido } from "./acciones-pedido";

export const dynamic = "force-dynamic";

export default async function DetallePedido({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const datos = await obtenerPedido(id);
  if (!datos) notFound();
  const { pedido, evento, boletos, renglones } = datos;
  const nombreTipo = new Map(renglones.map((r) => [r.tipo_id, r.tipo ?? "Entrada"]));
  const comprobante = await urlComprobante(pedido.comprobante_ruta);
  const base = (process.env.NEXT_PUBLIC_URL_BASE ?? "").replace(/\/+$/, "");

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="grid gap-4">
        <Link href="/admin" className="text-sm" style={{ color: "var(--tinta-suave)" }}>← Pedidos</Link>
        <section className="tarjeta p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="mono text-2xl font-bold">{pedido.referencia}</h1>
              <p className="text-sm" style={{ color: "var(--tinta-suave)" }}>Registrado {fechaCorta(pedido.creado_en)}</p>
            </div>
            <Pastilla estado={pedido.estado} />
          </div>
          <dl className="mt-5 grid gap-2 text-sm sm:grid-cols-2">
            <Dato t="Nombre" v={pedido.nombre} />
            <Dato t="Correo" v={pedido.correo} />
            <Dato t="Teléfono" v={pedido.telefono ?? "—"} />
            <Dato t="Evento" v={evento.nombre} />
            <Dato t="Fecha del evento" v={fechaLarga(evento.fecha)} />
            <Dato t="Boletos" v={renglones.map((r) => `${r.cantidad} ${r.tipo ?? "boleto"}`).join(" · ") || "Ninguno"} />
            {pedido.donativos > 0 && <Dato t={evento.donativo_nombre ?? "Donativo"} v={`${pedido.donativos} × ${pesos(evento.donativo_monto ?? 0)}`} />}
            <Dato t="Total" v={pesos(pedido.total)} />
            <Dato t="Avisó que pagó" v={fechaCorta(pedido.aviso_pago_en)} />
            <Dato t="Pago confirmado" v={pedido.pagado_en ? `${fechaCorta(pedido.pagado_en)} · ${pedido.confirmado_por ?? ""}` : "—"} />
            <Dato t="Correo con boletos" v={fechaCorta(pedido.correo_enviado_en)} />
          </dl>
          <p className="mt-4 text-xs" style={{ color: "var(--tinta-suave)" }}>
            Enlace del comprador: <a className="underline" href={`${base}/pedido/${pedido.id}`}>{base}/pedido/{pedido.id}</a>
          </p>
        </section>

        <section className="tarjeta p-6">
          <h2 className="font-bold">Comprobante</h2>
          {comprobante ? (
            <div className="mt-3">
              {pedido.comprobante_ruta?.endsWith(".pdf") ? (
                <a href={comprobante} target="_blank" rel="noreferrer" className="boton boton-suave">Abrir PDF</a>
              ) : (
                <a href={comprobante} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={comprobante} alt="Comprobante de transferencia" className="max-h-96 rounded-xl border" style={{ borderColor: "var(--borde)" }} />
                </a>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm" style={{ color: "var(--tinta-suave)" }}>El comprador no subió comprobante.</p>
          )}
        </section>

        {boletos.length > 0 && (
          <section className="tarjeta p-6">
            <h2 className="font-bold">Boletos emitidos</h2>
            <ul className="mt-3 grid gap-2">
              {boletos.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm" style={{ borderColor: "var(--borde)" }}>
                  <span className="mono font-semibold">{formatearFolio(b.folio)}</span>
                  <span className="font-semibold">{b.tipo_id ? nombreTipo.get(b.tipo_id) : "Entrada"}</span>
                  <span className="mono text-xs" style={{ color: "var(--tinta-suave)" }}>{b.codigo}</span>
                  <Pastilla estado={b.estado} />
                  {b.usado_en && <span className="text-xs" style={{ color: "var(--tinta-suave)" }}>entró {fechaCorta(b.usado_en)}</span>}
                  <a className="underline" href={`/boleto/${b.codigo}`} target="_blank" rel="noreferrer">Ver</a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <AccionesPedido pedidoId={pedido.id} estado={pedido.estado} notas={pedido.notas ?? ""} />
    </div>
  );
}

function Dato({ t, v }: { t: string; v: string }) {
  return (
    <div>
      <dt className="text-xs" style={{ color: "var(--tinta-suave)" }}>{t}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
