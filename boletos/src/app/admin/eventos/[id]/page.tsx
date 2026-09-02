import { notFound } from "next/navigation";
import { obtenerEvento } from "@/lib/eventos";
import { paraInputFecha } from "@/lib/formato";
import { FormularioEvento } from "./formulario";
import { TiposBoleto } from "./tipos";

export const dynamic = "force-dynamic";

export default async function EditarEvento({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ guardado?: string }>;
}) {
  const { id } = await params;
  const { guardado } = await searchParams;
  const nuevo = id === "nuevo";
  const evento = nuevo ? null : await obtenerEvento(id);
  if (!nuevo && !evento) notFound();
  const base = (process.env.NEXT_PUBLIC_URL_BASE ?? "").replace(/\/+$/, "");

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <h1 className="serif text-3xl font-bold">{nuevo ? "Nuevo evento" : evento!.nombre}</h1>
      {guardado && <div className="aviso aviso-bien">Evento guardado.</div>}
      {evento && (
        <p className="text-sm" style={{ color: "var(--tinta-suave)" }}>
          Página de venta para compartir: <a className="underline" href={`${base}/evento/${evento.id}`}>{base}/evento/{evento.id}</a>
          {" · "}Pedidos: {evento.ocupados} boletos apartados de {evento.capacidad} ({evento.pagados} pagados)
        </p>
      )}

      {evento && (
        <section className="tarjeta p-6">
          <h2 className="serif text-2xl font-semibold">Tipos de boleto</h2>
          <p className="mb-4 text-sm" style={{ color: "var(--tinta-suave)" }}>
            Cada tipo tiene su precio. El límite por tipo es opcional; el límite total lo pone la capacidad del evento.
          </p>
          <TiposBoleto eventoId={evento.id} tipos={evento.tipos} />
        </section>
      )}

      <section className="tarjeta p-6">
        <h2 className="serif mb-4 text-2xl font-semibold">Datos del evento</h2>
        <FormularioEvento
          id={evento?.id ?? null}
          valores={
            evento
              ? { ...evento, fecha: paraInputFecha(evento.fecha) }
              : {
                  nombre: "", descripcion: "", lugar: "", fecha: "", capacidad: 100, maximo_por_pedido: 10,
                  datos_transferencia: "", activo: true, imagen_url: "", informes: "",
                  donativo_nombre: "", donativo_monto: null, donativo_descripcion: "",
                }
          }
        />
        {nuevo && <p className="mt-3 text-sm" style={{ color: "var(--tinta-suave)" }}>Guarda el evento y después agrega sus tipos de boleto.</p>}
      </section>
    </div>
  );
}
