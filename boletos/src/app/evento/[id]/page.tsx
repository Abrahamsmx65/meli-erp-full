import Image from "next/image";
import { notFound } from "next/navigation";
import { EncabezadoPublico } from "@/components/encabezado-publico";
import { obtenerEvento } from "@/lib/eventos";
import { pesos } from "@/lib/formato";
import { FormularioCompra } from "./formulario";

export const dynamic = "force-dynamic";

const ZONA = "America/Mexico_City";

export default async function PaginaEvento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const evento = await obtenerEvento(id);
  if (!evento || !evento.activo) notFound();

  const fecha = new Date(evento.fecha);
  const diaSemana = new Intl.DateTimeFormat("es-MX", { weekday: "long", timeZone: ZONA }).format(fecha);
  const dia = new Intl.DateTimeFormat("es-MX", { day: "numeric", timeZone: ZONA }).format(fecha);
  const mes = new Intl.DateTimeFormat("es-MX", { month: "long", timeZone: ZONA }).format(fecha);
  const anio = new Intl.DateTimeFormat("es-MX", { year: "numeric", timeZone: ZONA }).format(fecha);
  const hora = new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: ZONA }).format(fecha);
  const tiposActivos = evento.tipos.filter((t) => t.activo);
  const [lugarLinea1, ...lugarResto] = (evento.lugar ?? "").split(/,\s*|\n/);

  return (
    <>
      <EncabezadoPublico />
      <main className="mx-auto grid max-w-5xl gap-8 px-4 pb-16 lg:grid-cols-[1fr_440px]">
        <section className="grid content-start gap-6">
          <div className="text-center lg:text-left">
            <p className="serif text-2xl" style={{ color: "var(--tinta-2)" }}>Unamos nuestras</p>
            <p className="caligrafia -mt-2 text-7xl leading-none" style={{ color: "var(--vino)" }}>Tefilot</p>
            <p className="mt-1 text-sm font-bold uppercase tracking-[.25em]" style={{ color: "var(--tinta-2)" }}>para encontrar</p>
            <p className="caligrafia -mt-1 text-5xl leading-none" style={{ color: "var(--rosa)" }}>pareja</p>
          </div>

          <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
            <div className="tarjeta-vino marco-oro grid place-items-center px-6 py-8 text-center">
              <h1 className="serif text-4xl font-bold uppercase leading-tight tracking-wide">{evento.nombre.replace(/\s*\d{4}$/, "")}</h1>
              <div className="serif mt-1 text-2xl" style={{ color: "var(--oro)" }}>{anio}</div>
              <div className="mt-2 text-lg" style={{ color: "var(--rosa)" }}>♡</div>
            </div>
            {evento.imagen_url && (
              <div className="overflow-hidden rounded-2xl border shadow-sm" style={{ borderColor: "var(--borde)" }}>
                <Image src={evento.imagen_url} alt={`Invitación ${evento.nombre}`} width={1024} height={1536} className="h-auto w-full" priority />
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Dato icono="📅" titulo={diaSemana}>
              <span className="serif text-3xl font-bold" style={{ color: "var(--vino)" }}>{dia}</span>
              <span className="block text-xs font-bold uppercase tracking-wider">de {mes}</span>
              <span className="block text-xs" style={{ color: "var(--oro)" }}>{anio}</span>
            </Dato>
            <Dato icono="🕥" titulo="Recepción">
              <span className="serif text-3xl font-bold" style={{ color: "var(--vino)" }}>{hora.replace(/\s?(a\.\s?m\.|p\.\s?m\.)/i, "")}</span>
              <span className="block text-xs font-bold uppercase tracking-wider">{/p/i.test(hora) ? "PM" : "AM"}</span>
            </Dato>
            <Dato icono="📍" titulo={lugarLinea1 || "Lugar"}>
              {lugarResto.length > 0 && <span className="block text-sm font-bold uppercase tracking-[.2em]" style={{ color: "var(--vino)" }}>{lugarResto.join(", ")}</span>}
            </Dato>
          </div>

          {evento.descripcion && (
            <div className="tarjeta p-5 text-sm leading-relaxed" style={{ color: "var(--tinta-2)" }}>
              <p className="whitespace-pre-wrap">{evento.descripcion}</p>
            </div>
          )}

          {evento.donativo_monto && (
            <div className="rounded-2xl border p-5 text-center" style={{ borderColor: "var(--oro)", background: "var(--papel)" }}>
              <p className="text-xs font-bold uppercase tracking-[.2em]" style={{ color: "var(--tinta-2)" }}>Se hará un</p>
              <p className="serif text-2xl font-bold uppercase" style={{ color: "var(--vino)" }}>{evento.donativo_nombre}</p>
              {evento.donativo_descripcion && <p className="mt-1 text-sm" style={{ color: "var(--tinta-2)" }}>{evento.donativo_descripcion}</p>}
              <p className="mt-1 text-sm">El donativo será de <strong style={{ color: "var(--vino)" }}>{pesos(evento.donativo_monto)}</strong></p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {tiposActivos.map((t) => (
              <div key={t.id} className="tarjeta flex items-center justify-between p-4">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[.15em]" style={{ color: "var(--tinta-2)" }}>{t.nombre}</div>
                  {t.descripcion && <div className="text-xs" style={{ color: "var(--tinta-suave)" }}>{t.descripcion}</div>}
                </div>
                <div className="serif text-3xl font-bold" style={{ color: "var(--vino)" }}>{pesos(t.precio)}</div>
              </div>
            ))}
          </div>

          {evento.informes && (
            <div className="text-center">
              <p className="adorno text-xs font-bold uppercase tracking-[.25em]" style={{ color: "var(--tinta-2)" }}>Informes</p>
              <p className="mt-1 whitespace-pre-wrap text-sm" style={{ color: "var(--tinta-2)" }}>{evento.informes}</p>
            </div>
          )}

          <p className="serif text-center text-lg italic" style={{ color: "var(--tinta-2)" }}>
            Que nuestras Tefilot se unan y que podamos ver <strong style={{ color: "var(--vino)" }}>muchos</strong> Shidujim y hogares llenos de Berajá.
          </p>
        </section>

        <section className="tarjeta h-fit p-6 lg:sticky lg:top-4">
          {evento.disponibles > 0 || evento.donativo_monto ? (
            <FormularioCompra
              eventoId={evento.id}
              tipos={tiposActivos.map((t) => ({ id: t.id, nombre: t.nombre, descripcion: t.descripcion, precio: t.precio, disponibles: t.disponibles }))}
              maximoPorPedido={evento.maximo_por_pedido}
              disponiblesEvento={evento.disponibles}
              donativo={{ nombre: evento.donativo_nombre, monto: evento.donativo_monto, descripcion: evento.donativo_descripcion }}
            />
          ) : (
            <div className="aviso aviso-alerta">Ya no hay lugares disponibles para este evento.</div>
          )}
        </section>
      </main>
    </>
  );
}

function Dato({ icono, titulo, children }: { icono: string; titulo: string; children: React.ReactNode }) {
  return (
    <div className="tarjeta p-4 text-center">
      <div className="text-2xl">{icono}</div>
      <div className="mt-1 text-xs font-bold uppercase tracking-[.15em]" style={{ color: "var(--tinta-2)" }}>{titulo}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
