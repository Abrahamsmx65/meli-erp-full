import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { obtenerPlan } from "@/lib/servicios/cache";
import { Etiquetas } from "@/components/etiquetas";

export const dynamic = "force-dynamic";

export default async function PaginaEtiquetas() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);

  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Conecta Mercado Libre</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          El código Full de cada producto sale del catálogo de Mercado Libre, así que
          primero hay que conectarlo.
        </p>
        <Link
          href="/ajustes"
          className="mt-3 inline-block underline"
          style={{ color: "var(--acento)" }}
        >
          Ir a Ajustes
        </Link>
      </div>
    );
  }

  // Lo que va en el envío planeado, para poder sacar sus etiquetas de un clic.
  const { plan } = await obtenerPlan(supabase, cuenta.id);

  const porSku = new Map<string, number>();
  for (const c of plan.cajas) {
    for (const a of c.aporta) {
      porSku.set(a.sku, (porSku.get(a.sku) ?? 0) + a.paresTotales);
    }
  }

  const sugeridas = [...porSku.entries()]
    .map(([sku, cantidad]) => ({ sku, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad);

  return (
    <div className="flex flex-col gap-6">
      <div className="no-imprimir">
        <h1 className="titulo-pagina">Etiquetas</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          La etiqueta que pide Mercado Envíos Full, la de Amazon (FNSKU) o las dos
          por par, generadas desde aquí en PDF o TXT para la térmica. Solo hace
          falta el SKU y cuántas quieres: el código Full, el FNSKU, el título y la
          variante ya están en el sistema.
        </p>
      </div>

      <details className="tarjeta p-4 no-imprimir">
        <summary className="cursor-pointer text-sm font-semibold">
          Cómo imprimirlas bien
        </summary>
        <div className="mt-3 flex flex-col gap-2 text-sm" style={{ color: "var(--ink-2)" }}>
          <p>
            Al darle a <strong>Imprimir</strong> se abre el diálogo del navegador. Ahí hay
            que dejar la escala en <strong>100%</strong> y quitar los encabezados y pies de
            página. Si el navegador escala la hoja, las barras se angostan y el escáner del
            almacén deja de leerlas.
          </p>
          <p>
            Para el rollo de la bodega (2 × 1 pulgadas), elige ese tamaño de papel en el
            diálogo de la impresora térmica: cada etiqueta sale en su propia página, sin
            márgenes. Para hoja carta con etiquetas adheribles, usa la opción de 24 por
            hoja y verifica con una hoja de prueba antes de gastar el paquete.
          </p>
          <p>
            El código de barras lleva el <strong>código Full</strong> (el que empieza con
            cuatro letras, como QPLW61342), que es lo que el almacén escanea. Debajo va
            escrito por si hay que capturarlo a mano.
          </p>
        </div>
      </details>

      <Etiquetas sugeridas={sugeridas} />
    </div>
  );
}
