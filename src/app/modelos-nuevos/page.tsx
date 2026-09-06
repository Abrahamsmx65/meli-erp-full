import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { cargarModelosNuevos } from "@/lib/servicios/modelos-nuevos";
import { ModelosNuevosPanel } from "@/components/modelos-nuevos";
import { Ficha } from "@/components/tiles";

export const dynamic = "force-dynamic";

/**
 * Modelos nuevos: qué le falta a cada listado nuevo (categoría, precio,
 * imágenes, clip y video, A+, llegada) y qué encontró la última revisión en
 * MELI y Amazon.
 */
export default async function ModelosNuevos() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Conecta Mercado Libre</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          Los modelos se cruzan con el catálogo de Mercado Libre; primero hay que conectarlo.
        </p>
        <Link href="/ajustes" className="mt-3 inline-block underline" style={{ color: "var(--acento)" }}>
          Ir a Ajustes
        </Link>
      </div>
    );
  }

  const amazon = await cuentaAmazon(supabase);
  const { modelos, sugerencias, categorias, hayAmazon, faltaMigracion } = await cargarModelosNuevos(
    supabase,
    cuenta.id,
    amazon?.id ?? null,
  );

  const pendientes = modelos.filter((m) => !m.listo);
  const sinImagenes = pendientes.filter((m) => !m.imagenesRecibidas).length;
  const sinRevisar = pendientes.filter((m) => (m.publicadoMeli || m.publicadoAmazon) && !m.revisadoEn).length;
  const sinPrecio = pendientes.filter((m) => !m.precioNormal && !m.precioRelampago).length;
  const enCamino = pendientes.filter((m) => m.llegadaAuto?.estado === "en_camino").length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">Modelos nuevos</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          El seguimiento de cada listado nuevo hasta que queda completo: categoría y precio
          (los mismos de{" "}
          <Link href="/costos" className="underline" style={{ color: "var(--acento)" }}>
            Costos
          </Link>
          ), cuándo llega (la ETA del contenedor que lo trae, o una fecha a mano), las imágenes
          de China, y lo que hay publicado en MELI y Amazon: fotos de portada y secundarias,
          video y A+. El clip de MELI y el video de Amazon no se ven por API: se palomean a mano.
        </p>
      </div>

      {faltaMigracion ? (
        <div
          className="tarjeta p-4 text-sm"
          style={{ background: "color-mix(in oklab, var(--estado-alerta) 12%, transparent)" }}
        >
          Falta aplicar la migración <strong>0053</strong> en Supabase (tabla{" "}
          <code>modelos_nuevos</code>). Hasta entonces no se puede agregar ni palomear nada.
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Ficha titulo="Pendientes" valor={pendientes.length} nota={`${modelos.length - pendientes.length} listos`} />
        <Ficha titulo="En camino" valor={enCamino} nota="con contenedor asignado" />
        <Ficha titulo="Sin precio" valor={sinPrecio} tono={sinPrecio > 0 ? "alerta" : "bien"} />
        <Ficha titulo="Sin imágenes de China" valor={sinImagenes} tono={sinImagenes > 0 ? "alerta" : "bien"} />
        <Ficha titulo="Sin revisar" valor={sinRevisar} nota="publicados sin revisión" tono={sinRevisar > 0 ? "alerta" : "neutro"} />
      </div>

      <ModelosNuevosPanel
        modelos={modelos}
        sugerencias={sugerencias}
        categorias={categorias}
        hayAmazon={hayAmazon}
        faltaMigracion={faltaMigracion}
      />
    </div>
  );
}
