import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarProductos } from "@/lib/servicios/productos";
import { TablaProductos } from "@/components/tabla-productos";
import { SubirCostos } from "@/components/subir-costos";
import { Aviso, Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

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
  if (!cuenta) return <SinCuenta titulo="Productos y costos" />;

  const { productos, categorias, faltaMigracion, fundasSinCosto } = await cargarProductos(
    supabase,
    cuenta.id,
    { conFundasSinCosto },
  );
  const conCosto = productos.filter((p) => p.costoMxn != null).length;

  return (
    <Pagina>
      <Encabezado
        ceja="Inventario"
        titulo="Productos y costos"
        descripcion={
          <>
            Categoría y costo final por pieza de cada modelo de calzado y diseño de funda ·{" "}
            <strong className="cifra">{conCosto}</strong> de <span className="cifra">{productos.length}</span> con costo
            capturado
            {fundasSinCosto > 0 ? (
              <>
                {" · "}
                <Link href={conFundasSinCosto ? "/productos" : "/productos?sinCosto=1"} className="enlace">
                  {conFundasSinCosto ? "Ocultar las fundas sin costo" : `Ver ${fundasSinCosto} fundas sin costo`}
                </Link>
              </>
            ) : null}
          </>
        }
        ayuda={
          <>
            <p>
              La categoría (corcho, EVA, pantufla, fundas…) y el costo final por pieza en MXN, por modelo de calzado o diseño
              de funda — el mismo para todas las tallas, colores y modelos de celular.
            </p>
            <p>
              Es el ÚNICO lugar de costos: de aquí sacan la ganancia Ventas de MELI, Ventas de fundas, Amazon y los cortes.
            </p>
          </>
        }
        ayudaTitulo="¿De dónde se usa?"
      />

      {faltaMigracion ? (
        <Aviso tono="alerta">
          Falta aplicar la migración <strong>0011</strong> en Supabase (tabla <code>productos_config</code>). Hasta entonces,
          lo que captures aquí no se puede guardar.
        </Aviso>
      ) : null}

      <SubirCostos />

      <TablaProductos productos={productos} categorias={categorias} />
    </Pagina>
  );
}
