import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/yapanizcel/cuenta";
import { listarDisenos } from "@/lib/yapanizcel/listados";
import { ListadosYz } from "@/components/yapanizcel/listados";
import { Encabezado, SinCuenta } from "@/components/yapanizcel/comunes";

export const dynamic = "force-dynamic";

export default async function ListadosPagina() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta />;
  const disenos = await listarDisenos(supabase, cuenta.id);

  return (
    <div className="flex flex-col gap-6">
      <Encabezado
        titulo="Listados · YAPANIZCEL"
        texto="Elige un diseño y se leen EN VIVO todas sus publicaciones de Mercado Libre con sus variantes y atributos. Cambia un valor en todas las publicaciones de un jalón (por ejemplo el color «Transparente» del 499, que se come el espacio del selector) o en una sola variante. Todo escribe directo en MELI."
      />
      <ListadosYz disenos={disenos} />
    </div>
  );
}
