import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { leerPlanParcial, obtenerPlan, type PlanGuardado } from "@/lib/servicios/cache";
import { Etiquetas } from "@/components/etiquetas";
import { Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

export default async function PaginaEtiquetas() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);

  if (!cuenta) return <SinCuenta titulo="Etiquetas" />;

  // Lo que va en el envío planeado, para poder sacar sus etiquetas de un
  // clic. Solo hacen falta las cajas: se leen del caché sin bajar el JSON
  // completo del plan; sin plan guardado, se cae a obtenerPlan como siempre.
  const parcial = await leerPlanParcial(supabase, cuenta.id, ["cajas"]);
  const cajas = (parcial?.cajas ??
    (await obtenerPlan(supabase, cuenta.id)).plan.cajas) as PlanGuardado["cajas"];

  const porSku = new Map<string, number>();
  for (const c of cajas) {
    for (const a of c.aporta) {
      porSku.set(a.sku, (porSku.get(a.sku) ?? 0) + a.paresTotales);
    }
  }

  const sugeridas = [...porSku.entries()]
    .map(([sku, cantidad]) => ({ sku, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad);

  return (
    <Pagina>
      <div className="no-imprimir">
        <Encabezado
          ceja="Mercado Libre"
          titulo="Etiquetas"
          descripcion="Etiquetas de Full, de Amazon (FNSKU) o las dos por par, en PDF o ZPL para la térmica."
          ayudaTitulo="Cómo imprimirlas bien"
          ayuda={
            <>
              <p>
                Solo hace falta el SKU y cuántas quieres: el código Full, el FNSKU, el título y la variante ya están en el
                sistema.
              </p>
              <p>
                Al darle a <strong>Imprimir</strong> se abre el diálogo del navegador. Ahí hay que dejar la escala en{" "}
                <strong>100%</strong> y quitar los encabezados y pies de página. Si el navegador escala la hoja, las barras
                se angostan y el escáner del almacén deja de leerlas.
              </p>
              <p>
                Para el rollo de la bodega (2 × 1 pulgadas), elige ese tamaño de papel en el diálogo de la impresora
                térmica: cada etiqueta sale en su propia página, sin márgenes. Para hoja carta con etiquetas adheribles,
                usa la opción de 24 por hoja y verifica con una hoja de prueba antes de gastar el paquete.
              </p>
              <p>
                El código de barras lleva el <strong>código Full</strong> (el que empieza con cuatro letras, como
                QPLW61342), que es lo que el almacén escanea. Debajo va escrito por si hay que capturarlo a mano.
              </p>
            </>
          }
        />
      </div>

      <Etiquetas sugeridas={sugeridas} />
    </Pagina>
  );
}
