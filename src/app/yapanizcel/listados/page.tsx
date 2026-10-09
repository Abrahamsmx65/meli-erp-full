import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/yapanizcel/cuenta";
import { obtenerDisenosListados } from "@/lib/yapanizcel/listados";
import { ListadosYz } from "@/components/yapanizcel/listados";
import { Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function ListadosPagina() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta servicio="yapanizcel" titulo="Publicaciones de fundas" />;
  // Masticada en yz_cache («listados:disenos»); la refresca el cron de netos.
  const disenos = await obtenerDisenosListados(supabase, cuenta.id);

  return (
    <Pagina>
      <Encabezado
        ceja="Fundas"
        titulo="Publicaciones de fundas"
        descripcion="Las publicaciones de un diseño con sus variantes y atributos, leídas en vivo de Mercado Libre."
        ayuda={
          <p>
            Elige un diseño y se leen EN VIVO todas sus publicaciones de Mercado Libre con sus variantes y atributos.
            Cambia un valor en todas las publicaciones de un jalón (por ejemplo el color «Transparente» del 499, que se come
            el espacio del selector) o en una sola variante. Todo escribe directo en MELI.
          </p>
        }
        ayudaTitulo="¿Cómo funciona?"
      />
      <ListadosYz disenos={disenos} />
    </Pagina>
  );
}
