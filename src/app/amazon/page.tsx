import { Suspense } from "react";
import { clienteServidor } from "@/lib/supabase/server";
import {
  LIMITE_FILAS,
  cargarAmazon,
  cuentaAmazon,
  estadoRecarga,
  normalizarDias,
} from "@/lib/servicios/amazon";
import { RecargaAmazon } from "@/components/recarga-amazon";
import { TablaAmazon } from "@/components/tabla-amazon";
import { Ficha } from "@/components/tiles";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

export default async function Amazon({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const dias = normalizarDias(sp.dias);
  const busqueda = (sp.q ?? "").trim();

  const supabase = await clienteServidor();
  const cuenta = await cuentaAmazon(supabase);

  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">Amazon no está conectado</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>
          No hay ninguna cuenta de Amazon asociada a este usuario. El conector
          vive en la carpeta <code>CODIGO</code> y se configura con{" "}
          <code>python3 scripts/configurar.py</code>.
        </p>
      </div>
    );
  }

  const [{ renglones, totales }, recarga] = await Promise.all([
    cargarAmazon(supabase, dias, busqueda),
    estadoRecarga(supabase, cuenta.id),
  ]);
  const etiqueta = dias === 365 ? "último año" : `últimos ${dias} días`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Amazon</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Ventas y existencias de {cuenta.nombre ?? "tu cuenta"} en Amazon{" "}
          {cuenta.pais}. La cobertura dice cuántos días dura el stock de FBA al
          ritmo de venta del periodo: es el número que decide qué reponer.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Ficha
          titulo="Unidades"
          valor={n(totales.unidades)}
          nota={`Vendidas en los ${etiqueta}`}
        />
        <Ficha titulo="Importe" valor={pesos(totales.importe)} nota="Venta del periodo" />
        <Ficha
          titulo="Con venta"
          valor={n(totales.conVenta)}
          nota={`De ${n(totales.skus)} SKUs`}
        />
        <Ficha
          titulo="En FBA"
          valor={n(totales.disponible)}
          nota={`${n(totales.enTransito)} en tránsito`}
          tono="bien"
        />
        <Ficha
          titulo="Agotados"
          valor={n(totales.sinStock)}
          nota="Venden pero están en cero"
          tono={totales.sinStock > 0 ? "critico" : "neutro"}
        />
      </div>

      <RecargaAmazon estado={recarga} />

      {/* useSearchParams necesita un límite de Suspense para poder prerenderizar. */}
      <Suspense fallback={<div className="tarjeta p-8 text-center text-sm">Cargando…</div>}>
        <TablaAmazon
          renglones={renglones}
          dias={dias}
          busqueda={busqueda}
          limite={LIMITE_FILAS}
        />
      </Suspense>
    </div>
  );
}
