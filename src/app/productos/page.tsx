import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarProductos } from "@/lib/servicios/productos";
import { leerFotosProducto } from "@/lib/servicios/fotos-producto";
import { fotoDeProducto } from "@/lib/fotos/producto";
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
  if (!cuenta) return <SinCuenta titulo="Catálogo y costos" />;

  const [{ productos: base, categorias, faltaMigracion, fundasSinCosto }, fotos] = await Promise.all([
    cargarProductos(supabase, cuenta.id, { conFundasSinCosto }),
    leerFotosProducto(supabase, cuenta.id),
  ]);
  // La foto del modelo junto a su renglón (dueño, 11-oct-2026). Las fundas no tienen fuente de fotos aquí.
  const productos = base.map((p) => ({ ...p, foto: p.negocio === "calzado" ? fotoDeProducto(fotos, p.modelo) : null }));
  const conCosto = productos.filter((p) => p.costoMxn != null).length;

  return (
    <Pagina>
      <Encabezado
        ceja="Inventario"
        titulo="Catálogo y costos"
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
        acciones={
          <span className="text-sm texto-2">
            <strong className="cifra">{conCosto}</strong> de <span className="cifra">{productos.length}</span> con costo
            {fundasSinCosto > 0 ? (
              <>
                {" · "}
                <Link href={conFundasSinCosto ? "/productos" : "/productos?sinCosto=1"} className="enlace">
                  {conFundasSinCosto ? "Ocultar las fundas sin costo" : `Ver ${fundasSinCosto} fundas sin costo`}
                </Link>
              </>
            ) : null}
          </span>
        }
      />

      {faltaMigracion ? (
        <Aviso tono="alerta">
          Falta aplicar la migración <strong>0011</strong> en Supabase (tabla <code>productos_config</code>): no se puede
          guardar.
        </Aviso>
      ) : null}

      <SubirCostos />

      <TablaProductos productos={productos} categorias={categorias} />
    </Pagina>
  );
}
