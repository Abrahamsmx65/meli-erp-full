import Link from "next/link";
import { EncabezadoPublico } from "@/components/encabezado-publico";
import { listarEventos } from "@/lib/eventos";
import { fechaLarga, pesos } from "@/lib/formato";
import { supabaseConfigurado } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

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

  return (
    <>
      <EncabezadoPublico />
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <h1 className="mb-1 text-3xl font-extrabold tracking-tight">Próximos eventos</h1>
        <p className="mb-8" style={{ color: "var(--tinta-suave)" }}>
          Elige tu evento, aparta tus boletos y paga por transferencia. Tus boletos con QR llegan a tu correo.
        </p>

        {eventos.length === 0 && (
          <div className="tarjeta p-8 text-center" style={{ color: "var(--tinta-suave)" }}>
            Por ahora no hay eventos con venta abierta.
          </div>
        )}

        <div className="grid gap-4">
          {eventos.map((e) => (
            <Link key={e.id} href={`/evento/${e.id}`} className="tarjeta block p-6 transition hover:shadow-md">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">{e.nombre}</h2>
                  <p className="mt-1 text-sm" style={{ color: "var(--tinta-2)" }}>
                    {fechaLarga(e.fecha)}
                    {e.lugar && <> · {e.lugar}</>}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-extrabold">{pesos(e.precio)}</div>
                  <div className="text-xs" style={{ color: "var(--tinta-suave)" }}>
                    {e.disponibles > 0 ? `${e.disponibles} lugares` : "Agotado"}
                  </div>
                </div>
              </div>
              {e.descripcion && (
                <p className="mt-3 line-clamp-2 text-sm" style={{ color: "var(--tinta-2)" }}>
                  {e.descripcion}
                </p>
              )}
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
