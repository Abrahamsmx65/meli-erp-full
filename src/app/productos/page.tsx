import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarProductos } from "@/lib/servicios/productos";
import { TablaProductos } from "@/components/tabla-productos";
import { SubirCostos } from "@/components/subir-costos";

export const dynamic = "force-dynamic";

export default async function Productos({
  searchParams,
}: {
  searchParams?: Promise<{ sinCosto?: string }>;
}) {
  // Las fundas sin costo se piden a propósito con ?sinCosto=1; por omisión no
  // viajan (son cientos y llenan la pantalla de renglones vacíos).
  const conFundasSinCosto = (await searchParams)?.sinCosto === "1";
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Conecta Mercado Libre</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          Los productos salen del catálogo de Mercado Libre; primero hay que conectarlo.
        </p>
      </div>
    );
  }

  const { productos, categorias, faltaMigracion, fundasSinCosto } = await cargarProductos(
    supabase,
    cuenta.id,
    { conFundasSinCosto },
  );
  const conCosto = productos.filter((p) => p.costoMxn != null).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">Productos y costos</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          La categoría (corcho, EVA, pantufla, fundas…) y el costo final por pieza en
          MXN, por modelo de calzado o diseño de funda — el mismo para todas las tallas,
          colores y modelos de celular. Es el ÚNICO lugar de costos: de aquí sacan la
          ganancia Ventas de MELI, Ventas de fundas, Amazon y los cortes.
        </p>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
          <strong className="cifra">{conCosto}</strong> de{" "}
          <span className="cifra">{productos.length}</span> productos con costo capturado.
          {fundasSinCosto > 0 ? (
            <>
              {" · "}
              <Link
                href={conFundasSinCosto ? "/productos" : "/productos?sinCosto=1"}
                className="underline"
                style={{ color: "var(--acento)" }}
              >
                {conFundasSinCosto
                  ? "Ocultar las fundas sin costo"
                  : `Ver ${fundasSinCosto} fundas sin costo`}
              </Link>
            </>
          ) : null}
        </p>
        {conFundasSinCosto ? (
          <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
            Se están mostrando también los {fundasSinCosto} diseños de funda sin costo
            capturado. En cuanto uno tenga costo, se queda a la vista solo.
          </p>
        ) : null}
      </div>

      {faltaMigracion ? (
        <p
          className="rounded-lg p-3 text-sm"
          style={{ background: "color-mix(in oklab, var(--estado-alerta) 12%, transparent)" }}
        >
          Falta aplicar la migración <strong>0011</strong> en Supabase (tabla{" "}
          <code>productos_config</code>). Hasta entonces, lo que captures aquí no se puede
          guardar.
        </p>
      ) : null}

      <SubirCostos />

      <TablaProductos productos={productos} categorias={categorias} />
    </div>
  );
}
