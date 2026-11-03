import { clienteServidor } from "@/lib/supabase/server";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { obtenerContenidoAmazon } from "@/lib/servicios/contenido-amazon";
import { tokenDeCuenta } from "@/lib/servicios/acceso-contenido";
import { ContenidoAmazonPanel } from "@/components/contenido-amazon";
import { Ficha } from "@/components/tiles";
import { Aviso, Cifras, Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

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

  if (!cuenta) return <SinCuenta titulo="Contenido de marca" servicio="amazon" />;

  const [contenido, token] = await Promise.all([
    obtenerContenidoAmazon(supabase, cuenta.id, cuenta.pais ?? null, { verEliminados }),
    // El token vive en una tabla sin políticas (solo service_role); esta
    // página ya confirmó la sesión, así que puede enseñárselo al dueño.
    tokenDeCuenta(cuenta.id),
  ]);
  const {
    modelos,
    categorias,
    totales,
    faltaMigracion,
    sinRefrescar,
    advertencias,
    anotacionesDisponibles,
  } = contenido;

  return (
    <Pagina>
      <Encabezado
        ceja="Amazon"
        titulo="Contenido de marca"
        descripcion="Categorías en la store, imágenes y contenido A+ de cada producto publicado."
        ayuda={
          <p>
            Los productos que tenemos publicados en Amazon, del GT054 en adelante más MY2307 y
            G650: sus categorías en la store, sus imágenes y su contenido A+. Lo que se publique
            después entra solo, marcado como nuevo.
          </p>
        }
      />

      {faltaMigracion ? (
        <Aviso tono="alerta">
          Falta aplicar la migración 0032 en Supabase: la lista se ve, pero no se puede
          palomear nada todavía.
        </Aviso>
      ) : null}

      {advertencias.length ? (
        <Aviso tono="alerta">
          <strong>Contenido parcial.</strong> {advertencias.join(" ")} Vuelve a intentar antes
          de editar.
        </Aviso>
      ) : null}

      <Cifras columnas={5}>
        <Ficha titulo="Productos" valor={totales.modelos} />
        <Ficha
          titulo="Nuevos"
          valor={anotacionesDisponibles ? totales.nuevos : "—"}
          tono={totales.nuevos > 0 ? "alerta" : "neutro"}
          nota="sin anotar todavía"
        />
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
        linkPublico={token ? `/contenido/${token}` : null}
      /> : null}
    </Pagina>
  );
}
