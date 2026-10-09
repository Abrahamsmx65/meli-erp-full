import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { DatosFiscales } from "@/components/datos-fiscales";
import { Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

export default async function Fiscal() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Datos fiscales" />;

  return (
    <Pagina>
      <Encabezado
        ceja="Mercado Libre"
        titulo="Datos fiscales"
        descripcion="Los modelos sin información fiscal en MELI: se captura una vez y se manda a todas sus variantes."
        ayuda={
          <p>
            Solo los SKUs que <strong>no</strong> tienen la información fiscal cargada en MELI (clave SAT, IVA, IEPS y
            unidad), agrupados por modelo: se captura una vez y el ERP la manda a todos los colores y tallas del modelo en
            segundo plano. Sin esos datos, MELI no puede facturar en automático.
          </p>
        }
      />

      <DatosFiscales />
    </Pagina>
  );
}
