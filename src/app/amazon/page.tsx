import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cuentaAmazon, estadoRecarga, normalizarDias } from "@/lib/servicios/amazon";
import { obtenerPlanFba } from "@/lib/servicios/plan-fba-cache";
import { CajasFba } from "@/components/cajas-fba";
import { EnviosFba } from "@/components/envios-fba";
import { EnviosViejosFba } from "@/components/envios-viejos-fba";
import { RecargaAmazon } from "@/components/recarga-amazon";
import { Ficha } from "@/components/tiles";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

/**
 * Envíos a FBA: existencias en Amazon y qué cajas completas mandar.
 * Las ventas de Amazon viven en su propio panel (/amazon/ventas).
 */
export default async function Amazon({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const sp = await searchParams;
  const dias = normalizarDias(sp.dias);

  const supabase = await clienteServidor();
  // La cuenta de Amazon y la de MELI no dependen una de la otra: en paralelo.
  const [cuenta, cuentaMeli] = await Promise.all([
    cuentaAmazon(supabase),
    cuentaActiva(supabase),
  ]);

  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Amazon no está conectado</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          No hay ninguna cuenta de Amazon asociada a este usuario. El conector
          vive en la carpeta <code>CODIGO</code> y se configura con{" "}
          <code>python3 scripts/configurar.py</code>.
        </p>
      </div>
    );
  }

  // El bloque pesado (agregaciones, catálogo de bodega y optimizador de
  // cajas) vive precalculado en `plan_fba_cache`, como el plan de Full: la
  // página lee un renglón y solo recalcula si algo lo invalidó. El avance de
  // la recarga histórica sí se lee fresco: es un indicador de progreso.
  const [calculado, recarga] = await Promise.all([
    obtenerPlanFba(supabase, cuenta.id, cuentaMeli?.id ?? null, dias),
    estadoRecarga(supabase, cuenta.id),
  ]);
  const { totales, enCamino, sugerencias, planFba, desglose, enviosFba } = calculado;

  const enTransito = enCamino
    ? [...(enCamino.porSku.values() as Iterable<number>)].reduce((a: number, b: number) => a + b, 0)
    : totales.enTransito;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">Envíos a FBA</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Existencias en FBA de {cuenta.nombre ?? "tu cuenta"} y qué cajas completas
          mandar. Las ventas de Amazon viven en su propio panel, en Ventas Amazon.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Ficha
          titulo="En FBA"
          valor={n(totales.disponible)}
          nota={
            enCamino
              ? `${n(enTransito)} en camino de verdad`
              : `${n(enTransito)} en tránsito`
          }
          tono="bien"
        />
        <Ficha
          titulo="Agotados"
          valor={n(totales.sinStock)}
          nota="Venden pero están en cero"
          tono={totales.sinStock > 0 ? "critico" : "neutro"}
        />
        <Ficha
          titulo="Con venta"
          valor={n(totales.conVenta)}
          nota={`De ${n(totales.skus)} SKUs`}
        />
        <Ficha
          titulo="Unidades vendidas"
          valor={n(totales.unidades)}
          nota={`Últimos ${dias} días (ritmo para la cobertura)`}
        />
      </div>

      <RecargaAmazon estado={recarga} />

      <EnviosViejosFba enCamino={enCamino} />

      <CajasFba plan={planFba} desglose={desglose} dias={dias} envios={enviosFba.envios} />

      <EnviosFba sugerencias={sugerencias} dias={dias} />
    </div>
  );
}
