import Link from "next/link";
import { redirect } from "next/navigation";
import { EncabezadoPublico } from "@/components/encabezado-publico";
import { listarEventos } from "@/lib/eventos";
import { fechaLarga } from "@/lib/formato";
import { supabaseConfigurado } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/** Con un solo evento abierto, la portada ES el evento. */
export default async function Inicio() {
  if (!supabaseConfigurado()) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <div className="aviso aviso-alerta">
          Falta configurar el servidor: hace falta <code>SUPABASE_SERVICE_ROLE_KEY</code> en las variables de
          entorno (ver <code>.env.example</code>).
        </div>
      </main>
    );
  }
  const eventos = await listarEventos(true);
  if (eventos.length === 1) redirect(`/evento/${eventos[0].id}`);

  return (
    <>
      <EncabezadoPublico />
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <h1 className="serif mb-6 text-4xl font-semibold" style={{ color: "var(--vino)" }}>Próximos eventos</h1>
        {eventos.length === 0 && (
          <div className="tarjeta p-8 text-center" style={{ color: "var(--tinta-suave)" }}>
            Por ahora no hay eventos con venta abierta.
          </div>
        )}
        <div className="grid gap-4">
          {eventos.map((e) => (
            <Link key={e.id} href={`/evento/${e.id}`} className="tarjeta block p-6 transition hover:shadow-md">
              <h2 className="serif text-2xl font-semibold">{e.nombre}</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--tinta-2)" }}>
                {fechaLarga(e.fecha)}{e.lugar && <> · {e.lugar}</>}
              </p>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
