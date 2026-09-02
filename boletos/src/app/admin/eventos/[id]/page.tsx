import { notFound } from "next/navigation";
import { obtenerEvento } from "@/lib/eventos";
import { paraInputFecha } from "@/lib/formato";
import { FormularioEvento } from "./formulario";

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
    <div className="mx-auto grid max-w-2xl gap-5">
      <h1 className="text-2xl font-extrabold">{nuevo ? "Nuevo evento" : evento!.nombre}</h1>
      {guardado && <div className="aviso aviso-bien">Evento guardado.</div>}
      {evento && (
        <p className="text-sm" style={{ color: "var(--tinta-suave)" }}>
          Página de venta para compartir: <a className="underline" href={`${base}/evento/${evento.id}`}>{base}/evento/{evento.id}</a>
        </p>
      )}
      <div className="tarjeta p-6">
        <FormularioEvento
          id={evento?.id ?? null}
          valores={
            evento
              ? { ...evento, fecha: paraInputFecha(evento.fecha) }
              : { nombre: "", descripcion: "", lugar: "", fecha: "", precio: 0, capacidad: 100, maximo_por_pedido: 10, datos_transferencia: "", activo: true }
          }
        />
      </div>
    </div>
  );
}
