import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { obtenerPlan } from "@/lib/servicios/cache";
import { FormularioCorrida, FormularioMapeo } from "@/components/pendientes";

export const dynamic = "force-dynamic";

export default async function Pendientes() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);

  if (!cuenta) {
    return <p className="text-sm">Conecta tu cuenta de Mercado Libre en Ajustes.</p>;
  }

  const { plan } = await obtenerPlan(supabase, cuenta.id);
  const { pendientes } = plan;
  const { sinCorrida, sinAmarre } = pendientes;

  const paresBloqueados = sinCorrida.reduce(
    (a, s) => a + s.cajasDisponibles * s.paresPorCaja,
    0,
  );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">Pendientes por resolver</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
          Inventario que existe en bodega pero que el sistema todavía no puede planear.
          Nada de esto se descarta en silencio.
        </p>
      </div>

      {/* ---- Cajas sin corrida ------------------------------------------- */}
      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="font-semibold">Cajas de corrida sin receta</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            {sinCorrida.length === 0
              ? "Ninguna: todas las cajas de corrida tienen su desglose de tallas."
              : `${sinCorrida.length} combinaciones. Sin saber qué tallas trae la caja, no se puede decidir si conviene mandarla. Son ${paresBloqueados.toLocaleString("es-MX")} pares fuera del plan.`}
          </p>
        </header>

        {sinCorrida.length > 0 && (
          <div className="max-h-[30rem] overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>Caja</th>
                  <th>Almacén</th>
                  <th>Pedido</th>
                  <th className="num">Cajas</th>
                  <th className="num">Pares/caja</th>
                  <th>Capturar corrida</th>
                </tr>
              </thead>
              <tbody>
                {sinCorrida.map((s) => (
                  <tr key={`${s.almacen}-${s.skuCaja}`}>
                    <td>
                      <div className="font-medium">{s.skuCaja}</div>
                      <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                        {s.modelo} · {s.color}
                      </div>
                    </td>
                    <td className="text-sm">{s.almacen}</td>
                    <td className="text-sm">{s.pedido}</td>
                    <td className="num cifra">{s.cajasDisponibles}</td>
                    <td className="num cifra">{s.paresPorCaja}</td>
                    <td>
                      <FormularioCorrida
                        pedido={s.pedido}
                        modelo={s.modelo}
                        color={s.color}
                        paresPorCaja={s.paresPorCaja}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- SKUs sin amarre --------------------------------------------- */}
      <section className="tarjeta overflow-hidden">
        <header className="border-b p-4 hairline">
          <h2 className="font-semibold">SKUs de bodega sin publicación en MELI</h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            {sinAmarre.length === 0
              ? "Ninguno: todo lo que hay en bodega tiene su SKU en Mercado Libre."
              : `${sinAmarre.length} SKUs armados como MODELO-COLOR-TALLA que no existen tal cual en tu catálogo. Puede ser que estén escritos distinto en la publicación, o que ese producto no esté publicado.`}
          </p>
        </header>

        {sinAmarre.length > 0 && (
          <div className="max-h-[30rem] overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>SKU de bodega</th>
                  <th>Modelo</th>
                  <th>Color</th>
                  <th>Talla</th>
                  <th className="num">Pares</th>
                  <th>Amarrar a SKU de MELI</th>
                </tr>
              </thead>
              <tbody>
                {sinAmarre.slice(0, 400).map((s) => (
                  <tr key={s.skuConstruido}>
                    <td className="font-medium">{s.skuConstruido}</td>
                    <td className="text-sm">{s.modelo}</td>
                    <td className="text-sm">{s.color}</td>
                    <td className="text-sm">{s.talla}</td>
                    <td className="num cifra">{s.paresAfectados.toLocaleString("es-MX")}</td>
                    <td>
                      <FormularioMapeo skuConstruido={s.skuConstruido} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
