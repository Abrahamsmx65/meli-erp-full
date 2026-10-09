import Link from "next/link";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarCorte, preparadosDelCorte } from "@/lib/servicios/tiktok-despacho";
import { numerosPreparados } from "@/lib/tiktok/despacho";
import { PrepararTikTok } from "@/components/preparar-tiktok";
import { Aviso, Encabezado, Pagina } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/** La estación de preparar pedidos de un corte: hoja, etiqueta, producto. */
export default async function Preparar({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const corteId = Number(id);

  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta || !Number.isFinite(corteId)) {
    return (
      <Pagina>
        <Encabezado ceja="TikTok Shop" titulo="Preparar pedidos" />
        <Aviso tono="critico">Corte inválido.</Aviso>
      </Pagina>
    );
  }

  // Los paquetes se leen con service_role porque, si a un pedido le faltan
  // sus paquetes, hay que preguntárselos a TikTok con los tokens de la tienda.
  const [corte, preparados] = await Promise.all([
    cargarCorte(clienteAdmin(), cuenta.id, corteId),
    preparadosDelCorte(supabase, cuenta.id, corteId),
  ]);

  return (
    <Pagina>
      <Encabezado
        ceja="TikTok Shop"
        titulo={`Preparar pedidos · Corte #${corte.numero}`}
        descripcion="Escanea la etiqueta, luego el producto (un escaneo por par)."
        acciones={
          <Link href="/tiktok/despacho" className="boton boton-fantasma">
            ← Volver al despacho
          </Link>
        }
        ayuda={
          <p>
            Nada se da por preparado si no cuadra todo; lo que no tiene FNSKU se cierra a mano y queda registrado.
          </p>
        }
        ayudaTitulo="¿Cuándo queda preparado?"
      />
      <PrepararTikTok corteId={corte.id} numero={corte.numero} paquetes={corte.paquetes} preparadosIniciales={numerosPreparados(corte.paquetes, preparados)} />
    </Pagina>
  );
}
