import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { calcularCosto, cargarCostos } from "@/lib/servicios/costos-producto";
import { TablaCostos } from "@/components/tabla-costos";
import { Ficha } from "@/components/tiles";

export const dynamic = "force-dynamic";

/**
 * Costos de producto: la hoja "Numeros" del dueño dentro del ERP. Por modelo
 * se captura el costo en USD, el tipo de cambio, el CBM por par y los envíos;
 * el sistema calcula la aduana, el costo aterrizado y la ganancia con cada
 * precio en MELI, Amazon y TikTok, y copia el costo a Productos.
 */
export default async function Costos() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Conecta Mercado Libre</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          Los modelos salen del catálogo de Mercado Libre; primero hay que conectarlo.
        </p>
        <Link href="/ajustes" className="mt-3 inline-block underline" style={{ color: "var(--acento)" }}>
          Ir a Ajustes
        </Link>
      </div>
    );
  }

  const { filas, parametros, categorias, faltaMigracion } = await cargarCostos(supabase, cuenta.id);
  const calculadas = filas.map((f) => ({ f, c: calcularCosto(f, parametros) }));
  const conCosto = calculadas.filter((x) => x.c.costoTotal != null).length;
  const conPrecio = filas.filter((f) => f.precioNormal || f.precioRelampago).length;
  const conPerdida = calculadas.filter(
    (x) => (x.c.relampago && x.c.relampago.ganancia < 0) || (x.c.normal && x.c.normal.ganancia < 0),
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">Costos de producto</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Por modelo: costo de fábrica en dólares, tipo de cambio, CBM por par y envíos. De ahí
          sale la aduana (pesos por m³ × CBM), el costo total aterrizado —que se copia solo a{" "}
          <Link href="/productos" className="underline" style={{ color: "var(--acento)" }}>
            Productos
          </Link>{" "}
          para la ganancia de Ventas— y cuánto se gana con cada precio en Mercado Libre, Amazon
          y TikTok. Las sugerencias de Amazon y TikTok buscan ganar lo mismo que el precio
          relámpago de MELI.
        </p>
      </div>

      {faltaMigracion ? (
        <div
          className="tarjeta p-4 text-sm"
          style={{ background: "color-mix(in oklab, var(--estado-alerta) 12%, transparent)" }}
        >
          Falta aplicar la migración <strong>0053</strong> en Supabase (tablas{" "}
          <code>costos_producto</code> y <code>costos_parametros</code>). Hasta entonces la
          lista se ve pero no se puede capturar nada.
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Ficha titulo="Modelos" valor={filas.length} />
        <Ficha
          titulo="Con costo"
          valor={conCosto}
          nota={`faltan ${filas.length - conCosto}`}
          tono={filas.length - conCosto > 0 ? "alerta" : "bien"}
        />
        <Ficha titulo="Con precio" valor={conPrecio} nota={`faltan ${filas.length - conPrecio}`} />
        <Ficha
          titulo="Con pérdida"
          valor={conPerdida}
          tono={conPerdida > 0 ? "critico" : "bien"}
          nota="ganancia negativa en MELI"
        />
      </div>

      <TablaCostos
        filas={filas}
        parametros={parametros}
        categorias={categorias}
        faltaMigracion={faltaMigracion}
      />
    </div>
  );
}
