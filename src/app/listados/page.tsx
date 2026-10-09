import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarAgrupadores } from "@/lib/servicios/listados";
import { Listados } from "@/components/listados";
import { Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

export default async function PaginaListados() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);

  if (!cuenta) return <SinCuenta titulo="Listados" />;

  const agrupadores = await cargarAgrupadores(supabase, cuenta.id);

  return (
    <Pagina>
      <Encabezado
        ceja="Mercado Libre"
        titulo="Listados"
        descripcion="Las publicaciones de un modelo con sus variantes, leídas en vivo, para unificar atributos."
        ayuda={
          <p>
            Busca un agrupador (el modelo: GT135, GT155…) y se leen EN VIVO todas sus publicaciones de MELI con sus
            variantes. Si un atributo trae valores distintos entre hermanas —el caso típico: el material, que parte el
            selector de la página del producto— aquí se ve dónde está la diferencia y se unifica con un clic.
          </p>
        }
      />

      <Listados agrupadores={agrupadores} />
    </Pagina>
  );
}
