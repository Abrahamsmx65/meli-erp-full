import { BotonesPlan } from "@/components/acciones";
import { Encabezado, Pagina, Seccion } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/**
 * Pantalla de sincronización.
 *
 * Existe porque el botón de la pantalla principal solo aparece cuando YA hay
 * datos, y eso deja atrapado a quien apenas está arrancando: no puede bajar
 * datos porque no tiene datos. Desde aquí siempre se puede disparar, tenga o
 * no tenga catálogo cargado.
 */
export default function Sincronizar() {
  return (
    <Pagina className="max-w-2xl">
      <Encabezado
        ceja="Sistema"
        titulo="Sincronizar con Mercado Libre"
        descripcion="Trae el catálogo, el stock en Full, las ventas de 90 días y el historial de movimientos."
        ayudaTitulo="¿Cuánto tarda?"
        ayuda={
          <>
            <p>
              La primera vez tarda varios minutos: son cientos de llamadas a la API de Mercado Libre, con pausas a propósito
              para que no te limiten por exceso de peticiones. Mientras corre, el botón se pone gris y dice «Sincronizando…».
              No cierres la pestaña. Al terminar aparece un resumen en verde con lo que se bajó.
            </p>
            <p>Si truena a la mitad, vuelve a darle: retoma sin duplicar nada.</p>
          </>
        }
      />

      <Seccion>
        <BotonesPlan />
      </Seccion>
    </Pagina>
  );
}
