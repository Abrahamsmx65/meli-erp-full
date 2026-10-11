import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { listarNumeros } from "@/lib/servicios/numeros";
import { TablaNumeros } from "@/components/numeros";
import { Aviso, Encabezado, Pagina, Seccion, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/**
 * Números (dueño, 11-oct-2026): precio de cada modelo en MELI, Amazon y
 * TikTok con el costo del ÚLTIMO contenedor costeado (tipo de cambio real
 * de sus pagos, flete y aduana por CBM, sin comisiones). Reemplaza el sheet
 * «Números»; las fórmulas viven en `finanzas/numeros.ts`.
 */
export default async function Numeros() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Números" />;
  const { renglones, costeoEn } = await listarNumeros(supabase as DB, cuenta.id);
  const conCatalogo = renglones.filter((r) => r.fuenteCosto === "catalogo").length;

  return (
    <Pagina>
      <Encabezado ceja="Negocio" titulo="Números" frescura={costeoEn} />
      {conCatalogo ? (
        <Aviso tono="info">
          {conCatalogo} modelos no tienen contenedor costeado y usan el costo de Catálogo y costos.
        </Aviso>
      ) : null}
      <Seccion sinRelleno>
        <div className="p-3">
          <TablaNumeros renglones={renglones} />
        </div>
      </Seccion>
    </Pagina>
  );
}
