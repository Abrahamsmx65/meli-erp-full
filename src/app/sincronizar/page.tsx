import { BotonesPlan } from "@/components/acciones";

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
    <div className="mx-auto flex max-w-2xl flex-col gap-5 py-6">
      <div>
        <h1 className="text-xl font-semibold">Sincronizar con Mercado Libre</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
          Trae tu catálogo completo, el stock disponible y en transferencia en
          Full, las ventas de los últimos 90 días y el historial de movimientos
          de inventario.
        </p>
      </div>

      <div className="tarjeta p-4">
        <BotonesPlan />
      </div>

      <div className="text-sm" style={{ color: "var(--ink-2)" }}>
        <p className="font-medium" style={{ color: "var(--ink-1)" }}>
          La primera vez tarda varios minutos.
        </p>
        <p className="mt-1">
          Son cientos de llamadas a la API de Mercado Libre, con pausas a
          propósito para que no te limiten por exceso de peticiones. Mientras
          corre, el botón se pone gris y dice «Sincronizando…». No cierres la
          pestaña. Al terminar aparece un resumen en verde con lo que se bajó.
        </p>
        <p className="mt-3">
          Si truena a la mitad, vuelve a darle: retoma sin duplicar nada.
        </p>
      </div>
    </div>
  );
}
