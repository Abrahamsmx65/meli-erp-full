import Link from "next/link";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarCorte, preparadosDelCorte } from "@/lib/servicios/tiktok-despacho";
import { numerosPreparados } from "@/lib/tiktok/despacho";
import { PrepararTikTok } from "@/components/preparar-tiktok";

export const dynamic = "force-dynamic";

/** La estación de preparar pedidos de un corte: hoja, etiqueta, producto. */
export default async function Preparar({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const corteId = Number(id);

  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta || !Number.isFinite(corteId)) {
    return <div className="tarjeta mx-auto max-w-lg p-8 text-center">Corte inválido.</div>;
  }

  // Los paquetes se leen con service_role porque, si a un pedido le faltan
  // sus paquetes, hay que preguntárselos a TikTok con los tokens de la tienda.
  const [corte, preparados] = await Promise.all([
    cargarCorte(clienteAdmin(), cuenta.id, corteId),
    preparadosDelCorte(supabase, cuenta.id, corteId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pagina">Preparar pedidos · Corte #{corte.numero}</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Escanea la etiqueta, luego el producto (un escaneo por par). Nada se da por
            preparado si no cuadra todo; lo que no tiene FNSKU se cierra a mano y queda registrado.
          </p>
        </div>
        <Link href="/tiktok/despacho" className="text-sm underline" style={{ color: "var(--ink-2)" }}>
          ← Volver al despacho
        </Link>
      </div>
      <PrepararTikTok corteId={corte.id} numero={corte.numero} paquetes={corte.paquetes} preparadosIniciales={numerosPreparados(corte.paquetes, preparados)} />
    </div>
  );
}
