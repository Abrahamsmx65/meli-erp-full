import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { leerRevision } from "@/lib/servicios/costos-envio";
import { CostosEnvio } from "@/components/costos-envio";

export const dynamic = "force-dynamic";

export default async function PaginaCostosEnvio() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);

  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">Conecta Mercado Libre</h1>
        <Link href="/ajustes" className="mt-3 inline-block underline" style={{ color: "var(--acento)" }}>
          Ir a Ajustes
        </Link>
      </div>
    );
  }

  const modelos = await leerRevision(supabase, cuenta.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Costos de envío</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          En Full, MELI mide la caja al recibirla y con esa medida cobra el envío de cada
          venta. Cuando mide mal, esa talla cobra de más para siempre: en el GT229 quince
          tallas pagan $88.50 y dos pagan $139.50 y $190 por la misma pantufla. Aquí se
          compara cada publicación contra sus hermanas del mismo modelo —que son la misma
          caja— y sale la lista de las que están mal, con las dos medidas juntas para
          abrir el caso.
        </p>
      </div>

      <CostosEnvio modelos={modelos} />
    </div>
  );
}
