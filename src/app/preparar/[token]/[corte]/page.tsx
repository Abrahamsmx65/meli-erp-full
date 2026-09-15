import Link from "next/link";
import { cuentaPorTokenPreparar } from "@/lib/servicios/acceso-preparar";
import { cargarCorte, preparadosDelCorte } from "@/lib/servicios/tiktok-despacho";
import { numerosPreparados } from "@/lib/tiktok/despacho";
import { clienteAdmin } from "@/lib/supabase/server";
import { PrepararTikTok } from "@/components/preparar-tiktok";

export const dynamic = "force-dynamic";

/** La estación de preparar, sin sesión. La puerta es el token; lo demás es igual. */
export default async function EstacionPublica({ params }: { params: Promise<{ token: string; corte: string }> }) {
  const { token, corte } = await params;
  const cuenta = await cuentaPorTokenPreparar(token);
  const corteId = Number(corte);
  if (!cuenta || !Number.isFinite(corteId)) {
    return <div className="tarjeta mx-auto max-w-lg p-8 text-center">Este link ya no sirve.</div>;
  }

  const admin = clienteAdmin();
  const [datos, preparados] = await Promise.all([
    cargarCorte(admin, cuenta.id, corteId),
    preparadosDelCorte(admin, cuenta.id, corteId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pagina">Preparar pedidos · Corte #{datos.numero}</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Escanea la etiqueta, luego el producto (un escaneo por par).
          </p>
        </div>
        <Link href={`/preparar/${token}`} className="text-sm underline" style={{ color: "var(--ink-2)" }}>
          ← Otros cortes
        </Link>
      </div>
      <PrepararTikTok
        corteId={datos.id}
        numero={datos.numero}
        paquetes={datos.paquetes}
        preparadosIniciales={numerosPreparados(datos.paquetes, preparados)}
        urlGuardar={`/api/preparar-publico/${token}/cortes/${datos.id}/preparar`}
      />
    </div>
  );
}
