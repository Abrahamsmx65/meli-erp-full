import { notFound } from "next/navigation";
import { EncabezadoPublico } from "@/components/encabezado-publico";
import { Pastilla } from "@/components/pastilla";
import { obtenerBoleto } from "@/lib/boletos";
import { formatearFolio } from "@/lib/codigos";
import { fechaCorta, fechaLarga } from "@/lib/formato";
import { qrSvg } from "@/lib/qr";

export const dynamic = "force-dynamic";

export default async function PaginaBoleto({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const datos = await obtenerBoleto(codigo);
  if (!datos) notFound();
  const { boleto, pedido, evento, tipo } = datos;
  const svg = await qrSvg(boleto.codigo);
  const activo = boleto.estado === "valido" && pedido.estado === "pagado";

  return (
    <>
      <EncabezadoPublico />
      <main className="mx-auto max-w-md px-4 pb-16">
        <article className="tarjeta marco-oro overflow-hidden" style={{ background: "#fff" }}>
          <div className="p-6 text-center" style={{ background: "var(--vino)", color: "#fff" }}>
            <div className="text-xs uppercase tracking-[.25em] opacity-80">Boleto {formatearFolio(boleto.folio)}</div>
            <h1 className="caligrafia mt-1 text-5xl leading-none">{evento.nombre.replace(/\s*\d{4}$/, "")}</h1>
            <div className="serif text-xl" style={{ color: "var(--oro)" }}>{new Date(evento.fecha).getFullYear()}</div>
            <div className="mx-auto mt-3 inline-block rounded-full px-4 py-1 text-sm font-bold uppercase tracking-widest" style={{ background: "rgba(255,255,255,.14)" }}>
              {tipo ?? "Entrada"}
            </div>
            <p className="mt-3 text-sm opacity-90">{fechaLarga(evento.fecha)}</p>
            {evento.lugar && <p className="text-sm opacity-90">{evento.lugar}</p>}
          </div>

          <div className="grid place-items-center p-6">
            {activo ? (
              <div className="w-full max-w-[280px]" dangerouslySetInnerHTML={{ __html: svg }} />
            ) : (
              <div className="grid w-full max-w-[280px] place-items-center rounded-xl p-8 text-center" style={{ background: "var(--plano)" }}>
                <Pastilla estado={pedido.estado === "pagado" ? boleto.estado : pedido.estado} />
                <p className="mt-3 text-sm" style={{ color: "var(--tinta-2)" }}>
                  {boleto.estado === "usado"
                    ? `Este boleto ya se usó el ${fechaCorta(boleto.usado_en)}.`
                    : pedido.estado !== "pagado"
                      ? "Este boleto no está activo porque el pago no está confirmado."
                      : "Este boleto fue cancelado."}
                </p>
              </div>
            )}
            <div className="mono mt-3 text-xs tracking-wider" style={{ color: "var(--tinta-suave)" }}>{boleto.codigo}</div>
          </div>

          <div className="border-t p-5 text-sm" style={{ borderColor: "var(--borde)" }}>
            <div className="flex justify-between"><span style={{ color: "var(--tinta-suave)" }}>A nombre de</span><strong>{pedido.nombre}</strong></div>
            <div className="mt-1 flex justify-between"><span style={{ color: "var(--tinta-suave)" }}>Pedido</span><span className="mono">{pedido.referencia}</span></div>
            <div className="mt-1 flex justify-between"><span style={{ color: "var(--tinta-suave)" }}>Estado</span><Pastilla estado={boleto.estado} /></div>
          </div>
        </article>

        <p className="no-imprimir mt-4 text-center text-xs" style={{ color: "var(--tinta-suave)" }}>
          Muestra este QR en la entrada, desde el celular o impreso. Entra una sola vez.
        </p>
      </main>
    </>
  );
}
