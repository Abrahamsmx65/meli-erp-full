import { clienteServidor } from "@/lib/supabase/server";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { cargarContenidoAmazon } from "@/lib/servicios/contenido-amazon";
import { ContenidoAmazonPanel } from "@/components/contenido-amazon";
import { Ficha } from "@/components/tiles";

export const dynamic = "force-dynamic";

/**
 * Contenido en Amazon: qué falta por trabajarle a cada modelo.
 *
 * La lista es el recorte que el negocio trabaja hoy (GT054 a GT300, más
 * MY2307 y G650). Cada renglón trae su link a Amazon y la descarga de sus
 * imágenes; los palomeos y la prioridad los lleva quien arma el contenido.
 */
export default async function Contenido({
  searchParams,
}: {
  searchParams: Promise<{ eliminados?: string }>;
}) {
  const sp = await searchParams;
  const verEliminados = sp.eliminados === "1";

  const supabase = await clienteServidor();
  const cuenta = await cuentaAmazon(supabase);

  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">Amazon no está conectado</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          No hay ninguna cuenta de Amazon asociada a este usuario.
        </p>
      </div>
    );
  }

  const { modelos, categorias, totales, faltaMigracion, sinRefrescar } =
    await cargarContenidoAmazon(supabase, cuenta.id, cuenta.pais ?? null, { verEliminados });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Contenido en Amazon</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Los modelos que tenemos publicados, del GT054 al GT300 más MY2307 y G650: sus
          categorías en la store, sus imágenes y su contenido A+.
        </p>
      </div>

      {faltaMigracion ? (
        <div
          className="tarjeta p-4 text-sm"
          style={{ background: "color-mix(in oklab, var(--estado-alerta) 12%, transparent)" }}
        >
          Falta aplicar la migración 0032 en Supabase: la lista se ve, pero no se puede
          palomear nada todavía.
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Ficha titulo="Modelos" valor={totales.modelos} />
        <Ficha titulo="Activos" valor={totales.activos} tono="bien" />
        <Ficha titulo="Inactivos" valor={totales.inactivos} tono="alerta" />
        <Ficha
          titulo="Con imágenes"
          valor={totales.conImagenes}
          nota={`faltan ${totales.modelos - totales.conImagenes}`}
        />
        <Ficha
          titulo="Con A+"
          valor={totales.conAplus}
          nota={`faltan ${totales.modelos - totales.conAplus}`}
        />
      </div>

      <ContenidoAmazonPanel
        modelos={modelos}
        categorias={categorias}
        totales={totales}
        verEliminados={verEliminados}
        sinRefrescar={sinRefrescar}
        soloLectura={faltaMigracion}
      />
    </div>
  );
}
