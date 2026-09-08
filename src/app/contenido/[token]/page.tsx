import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { clienteAdmin } from "@/lib/supabase/server";
import { cuentaPorToken } from "@/lib/servicios/acceso-contenido";
import { obtenerContenidoAmazon } from "@/lib/servicios/contenido-amazon";
import { ContenidoAmazonPanel } from "@/components/contenido-amazon";
import { Ficha } from "@/components/tiles";

export const dynamic = "force-dynamic";

// Un link secreto que Google no tiene por qué guardar.
export const metadata: Metadata = {
  title: "Contenido en Amazon",
  robots: { index: false, follow: false },
};

/**
 * La sección de contenido para quien NO tiene cuenta en el ERP.
 *
 * Se entra con el link secreto y se ve exactamente esta pantalla: ni menú, ni
 * barra de estado, ni ninguna otra sección (`MenuLateral` y `EstadoConexion`
 * se esconden solos en esta ruta). El token es la única puerta —del otro lado
 * se lee con service_role, sin RLS—, así que un token que no existe contesta
 * 404 seco, sin pistas de qué falló.
 */
export default async function ContenidoPublico({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ eliminados?: string }>;
}) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const cuenta = await cuentaPorToken(token);
  if (!cuenta) notFound();

  const verEliminados = sp.eliminados === "1";
  const admin = clienteAdmin();
  const { modelos, categorias, totales, faltaMigracion, sinRefrescar, advertencias, anotacionesDisponibles } =
    await obtenerContenidoAmazon(admin, cuenta.id, cuenta.pais, { verEliminados });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">Contenido en Amazon</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Los productos que tenemos publicados: sus categorías en la store, sus imágenes y su
          contenido A+. Lo que palomees aquí se guarda solo.
        </p>
      </div>

      {faltaMigracion ? (
        <div
          className="tarjeta p-4 text-sm"
          style={{ background: "color-mix(in oklab, var(--estado-alerta) 12%, transparent)" }}
        >
          Falta terminar de instalar esta sección: se ve la lista, pero todavía no se puede
          palomear nada.
        </div>
      ) : null}

      {advertencias.length ? (
        <div className="tarjeta p-4 text-sm">
          <strong>Contenido parcial.</strong> {advertencias.join(" ")}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Ficha titulo="Productos" valor={totales.modelos} />
        <Ficha titulo="Nuevos" valor={anotacionesDisponibles ? totales.nuevos : "—"} tono={totales.nuevos > 0 ? "alerta" : "neutro"} />
        <Ficha titulo="Activos" valor={totales.activos} tono="bien" />
        <Ficha
          titulo="Con imágenes"
          valor={anotacionesDisponibles ? totales.conImagenes : "—"}
          nota={anotacionesDisponibles ? `faltan ${totales.modelos - totales.conImagenes}` : "No disponible"}
        />
        <Ficha
          titulo="Con A+"
          valor={anotacionesDisponibles ? totales.conAplus : "—"}
          nota={anotacionesDisponibles ? `faltan ${totales.modelos - totales.conAplus}` : "No disponible"}
        />
      </div>

      {anotacionesDisponibles ? <ContenidoAmazonPanel
        modelos={modelos}
        categorias={categorias}
        totales={totales}
        verEliminados={verEliminados}
        sinRefrescar={sinRefrescar}
        soloLectura={faltaMigracion || advertencias.length > 0}
        token={token}
      /> : null}
    </div>
  );
}
