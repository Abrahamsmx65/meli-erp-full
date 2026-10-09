import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { clienteAdmin } from "@/lib/supabase/server";
import { cuentaPorToken } from "@/lib/servicios/acceso-contenido";
import { obtenerContenidoAmazon } from "@/lib/servicios/contenido-amazon";
import { ContenidoAmazonPanel } from "@/components/contenido-amazon";
import { Ficha } from "@/components/tiles";
import { Aviso, Cifras, Encabezado, Pagina } from "@/components/ui/pagina";

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
    <Pagina>
      <Encabezado
        titulo="Contenido en Amazon"
        descripcion="Categorías en la store, imágenes y contenido A+. Lo que palomees aquí se guarda solo."
      />

      {faltaMigracion ? (
        <Aviso tono="alerta">
          Falta terminar de instalar esta sección: se ve la lista, pero todavía no se puede
          palomear nada.
        </Aviso>
      ) : null}

      {advertencias.length ? (
        <Aviso tono="alerta">
          <strong>Contenido parcial.</strong> {advertencias.join(" ")}
        </Aviso>
      ) : null}

      <Cifras columnas={5}>
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
      </Cifras>

      {anotacionesDisponibles ? <ContenidoAmazonPanel
        modelos={modelos}
        categorias={categorias}
        totales={totales}
        verEliminados={verEliminados}
        sinRefrescar={sinRefrescar}
        soloLectura={faltaMigracion || advertencias.length > 0}
        token={token}
      /> : null}
    </Pagina>
  );
}
