import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarProductos } from "@/lib/servicios/productos";
import { TablaProductos } from "@/components/tabla-productos";
import { SubirCostos } from "@/components/subir-costos";

export const dynamic = "force-dynamic";

export default async function Productos() {
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

  const { productos, categorias, faltaMigracion } = await cargarProductos(supabase, cuenta.id);
  const conCosto = productos.filter((p) => p.costoMxn != null).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">Productos</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          La categoría (corcho, EVA, pantufla…) y el costo final por par en MXN, por
          modelo — el costo es el mismo para todos los colores y tallas. Con esto la
          sección de Ventas calcula la ganancia contra lo que MELI de verdad deposita.
          El costo se calcula en{" "}
          <Link href="/costos" className="underline" style={{ color: "var(--acento)" }}>
            Costos de producto
          </Link>{" "}
          (USD × tipo de cambio + aduana por CBM) y se copia aquí solo; capturarlo a mano
          también vale.
        </p>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
          <strong className="cifra">{conCosto}</strong> de{" "}
          <span className="cifra">{productos.length}</span> productos con costo capturado.
        </p>
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
