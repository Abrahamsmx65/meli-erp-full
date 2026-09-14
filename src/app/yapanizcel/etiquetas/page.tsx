import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/yapanizcel/cuenta";
import { obtenerPlanYz } from "@/lib/yapanizcel/envios";
import { Etiquetas } from "@/components/etiquetas";
import { Encabezado, SinCuenta } from "@/components/yapanizcel/comunes";

export const dynamic = "force-dynamic";

/**
 * Etiquetas de Mercado Envíos Full para las fundas: la misma etiqueta y la
 * misma pantalla que la del calzado, pero contra el catálogo de la cuenta
 * de YAPANIZCEL y SOLO el lado de Mercado Libre (sin FNSKU de Amazon).
 */
export default async function EtiquetasYz() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta />;

  // Lo que el plan de envíos a Full dice que hay que mandar, para sacar
  // sus etiquetas de un clic: una por unidad, ya en decenas cerradas. El
  // plan vive masticado en yz_cache: aquí solo se lee.
  let sugeridas: { sku: string; cantidad: number }[] = [];
  try {
    const plan = await obtenerPlanYz(supabase, cuenta.id);
    sugeridas = plan.lineas
      .filter((l) => l.mandar > 0)
      .map((l) => ({ sku: l.sku, cantidad: l.mandar }))
      .sort((a, b) => b.cantidad - a.cantidad);
  } catch {
    sugeridas = [];
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="no-imprimir">
        <Encabezado
          titulo="Etiquetas · YAPANIZCEL"
          texto="La etiqueta que pide Mercado Envíos Full para cada funda, generada desde aquí en PDF o TXT para la térmica, igual que en la cuenta de calzado. Solo hace falta el SKU y cuántas: el código Full, el título y la variante ya están en el catálogo de fundas."
        />
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
            El código de barras lleva el <strong>código Full</strong> de la publicación de
            fundas (el que empieza con cuatro letras), que es lo que el almacén escanea.
            Debajo va escrito por si hay que capturarlo a mano.
          </p>
        </div>
      </details>

      <Etiquetas
        sugeridas={sugeridas}
        api="/api/yapanizcel/etiquetas"
        soloMeli
        archivo="etiquetas-fundas"
        placeholderBusqueda="499-IP15PM-BLK o «iPhone 15»"
        placeholderPegado={"499-IP15PM-BLK\t50\n501-A54\t20"}
        sugeridasTexto={{
          boton: `Traer los ${sugeridas.length} SKUs del envío a Full planeado`,
          ayuda:
            "Toma el plan de Envíos a Full de fundas y pide una etiqueta por unidad de cada SKU que hay que mandar.",
        }}
      />
    </div>
  );
}
