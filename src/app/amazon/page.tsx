import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import {
  cargarAmazon,
  cuentaAmazon,
  estadoRecarga,
  normalizarDias,
} from "@/lib/servicios/amazon";
import { mapaCorridas, sugerirEnvioFba } from "@/lib/servicios/fba";
import { planFbaConCajas } from "@/lib/servicios/fba-plan";
import { catalogoBodega } from "@/lib/servicios/inventario";
import { desglosarOpcionales } from "@/lib/reporte/opcionales";
import { normalizarParametros } from "@/lib/engine/params";
import { indexarCatalogo } from "@/lib/etiquetas/resolver";
import { CajasFba } from "@/components/cajas-fba";
import { EnviosFba } from "@/components/envios-fba";
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

  // Las corridas viven con la cuenta de MELI: son las mismas cajas físicas.
  const cuentaMeli = await cuentaActiva(supabase);
  const [{ renglones, totales }, recarga, corridasRaw, skusMeli, bodega, paramsBd] =
    await Promise.all([
      cargarAmazon(supabase, dias, ""),
      estadoRecarga(supabase, cuenta.id),
      cuentaMeli
        ? traerTodo<any>(supabase, "corridas", "modelo, color, tallas, total, pedido", (q) =>
            q.eq("account_id", cuentaMeli.id),
          )
        : Promise.resolve([]),
      // El catálogo de MELI amarra los SKUs de Amazon (escritos en otro
      // orden) a su modelo+color real: sin él, la corrida no se encuentra.
      cuentaMeli
        ? traerTodo<any>(supabase, "skus", "sku, modelo, color, talla", (q) =>
            q.eq("account_id", cuentaMeli.id),
          )
        : Promise.resolve([]),
      cuentaMeli ? catalogoBodega(supabase, cuentaMeli.id) : Promise.resolve(null),
      cuentaMeli
        ? supabase.from("parametros").select("datos").eq("account_id", cuentaMeli.id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const indiceMeli = indexarCatalogo(skusMeli);
  const sugerencias = sugerirEnvioFba(renglones, dias, mapaCorridas(corridasRaw), undefined, indiceMeli);

  // El plan de cajas REALES: mismo motor y mismos pesos que envíos a Full.
  const planFba = planFbaConCajas({
    renglones,
    dias,
    catalogo: bodega?.catalogo.cajas ?? [],
    indiceMeli,
    parametros: normalizarParametros((paramsBd?.data?.datos as Record<string, unknown>) ?? {}),
  });
  const desglose = desglosarOpcionales(
    planFba.cajas.map((c) => ({
      codigo: c.codigo,
      cantidad: c.cantidad,
      paresPorCaja: c.paresPorCaja,
      cantidadOpcional: c.cantidadOpcional,
      aporta: c.aporta.map((a) => ({ sku: a.sku, talla: a.talla, paresPorCaja: a.paresPorCaja })),
    })),
    planFba.lineas,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Envíos a FBA</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Existencias en FBA de {cuenta.nombre ?? "tu cuenta"} y qué cajas completas
          mandar. Las ventas de Amazon viven en su propio panel, en Ventas Amazon.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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

      <CajasFba plan={planFba} desglose={desglose} dias={dias} />

      <EnviosFba sugerencias={sugerencias} dias={dias} />
    </div>
  );
}
