import { notFound } from "next/navigation";
import { EncabezadoPublico } from "@/components/encabezado-publico";
import { obtenerEvento } from "@/lib/eventos";
import { fechaLarga, pesos } from "@/lib/formato";
import { FormularioCompra } from "./formulario";

export const dynamic = "force-dynamic";

export default async function PaginaEvento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const evento = await obtenerEvento(id);
  if (!evento || !evento.activo) notFound();

  const maximo = Math.min(evento.maximo_por_pedido, evento.disponibles);

  return (
    <>
      <EncabezadoPublico />
      <main className="mx-auto grid max-w-3xl gap-6 px-4 pb-16 md:grid-cols-[1.1fr_1fr]">
        <section>
          <h1 className="text-3xl font-extrabold tracking-tight">{evento.nombre}</h1>
          <p className="mt-2" style={{ color: "var(--tinta-2)" }}>
            {fechaLarga(evento.fecha)}
          </p>
          {evento.lugar && <p style={{ color: "var(--tinta-2)" }}>{evento.lugar}</p>}
          <p className="mt-4 text-3xl font-extrabold">
            {pesos(evento.precio)} <span className="text-sm font-medium" style={{ color: "var(--tinta-suave)" }}>por boleto</span>
          </p>
          {evento.descripcion && (
            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed" style={{ color: "var(--tinta-2)" }}>
              {evento.descripcion}
            </p>
          )}
          <p className="mt-4 text-sm" style={{ color: "var(--tinta-suave)" }}>
            {evento.disponibles > 0 ? `Quedan ${evento.disponibles} lugares.` : "Agotado."}
          </p>
        </section>

        <section className="tarjeta p-6">
          {maximo > 0 ? (
            <FormularioCompra eventoId={evento.id} precio={evento.precio} maximo={maximo} />
          ) : (
            <div className="aviso aviso-alerta">Ya no hay lugares disponibles para este evento.</div>
          )}
        </section>
      </main>
    </>
  );
}
