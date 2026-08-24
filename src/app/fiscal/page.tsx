import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { DatosFiscales } from "@/components/datos-fiscales";

export const dynamic = "force-dynamic";

export default async function Fiscal() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">Conecta Mercado Libre</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          Los datos fiscales viven en las publicaciones de Mercado Libre; primero hay que
          conectarlo.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Datos fiscales</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Solo los SKUs que <strong>no</strong> tienen la información fiscal cargada en MELI
          (clave SAT, IVA, IEPS y unidad), agrupados por modelo: se captura una vez y el ERP
          la manda a todos los colores y tallas del modelo en segundo plano. Sin esos datos,
          MELI no puede facturar en automático.
        </p>
      </div>

      <DatosFiscales />
    </div>
  );
}
