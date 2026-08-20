import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarInventario } from "@/lib/servicios/inventario";
import { configPorProducto } from "@/lib/servicios/productos";
import { Ficha } from "@/components/tiles";
import { TablaInventario } from "@/components/tabla-inventario";
import Link from "next/link";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

export default async function Inventario() {
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

  const [inv, config] = await Promise.all([
    cargarInventario(supabase, cuenta.id),
    configPorProducto(supabase, cuenta.id),
  ]);
  const t = inv.totales;

  // El dinero parado en la bodega, a costo: pares × costo del modelo. Solo
  // suma lo que tiene costo capturado en Productos y costos.
  let valorBodega = 0;
  let valorEnCamino = 0;
  let paresSinCosto = 0;
  for (const r of inv.renglones) {
    const costo = config.get(r.modelo)?.costo;
    if (costo == null) {
      paresSinCosto += r.enBodega + r.enCamino;
      continue;
    }
    valorBodega += r.enBodega * costo;
    valorEnCamino += r.enCamino * costo;
  }

  const skusBodega = inv.renglones.filter((r) => r.enBodega + r.enCamino > 0).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Bodega</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Lo que está en cajas cerradas en tu bodega y lo que viene de China. Lo de
          Mercado Libre vive en su propia sección.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Ficha titulo="SKUs" valor={n(skusBodega)} nota="Con producto en bodega o en camino" />
        <Ficha titulo="En bodega" valor={n(t.enBodega)} nota="Pares en cajas cerradas" />
        <Ficha
          titulo="Desde China"
          valor={n(t.enCamino)}
          nota="En camino a bodega"
          tono={t.enCamino > 0 ? "alerta" : "neutro"}
        />
        <Ficha
          titulo="Valor en bodega"
          valor={valorBodega > 0 ? pesos(valorBodega) : "—"}
          nota={
            valorBodega > 0
              ? paresSinCosto > 0
                ? `A costo · ${n(paresSinCosto)} pares sin costo capturado`
                : "A costo, con todos los costos capturados"
              : "Captura costos en Productos y costos"
          }
        />
        <Ficha
          titulo="Valor en camino"
          valor={valorEnCamino > 0 ? pesos(valorEnCamino) : "—"}
          nota="Lo que viene de China, a costo"
        />
      </div>

      {/* ---- Por almacén y por pedido ------------------------------------ */}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="tarjeta overflow-hidden">
          <header className="border-b p-3 hairline">
            <h2 className="text-sm font-semibold">Por almacén</h2>
          </header>
          <table className="datos">
            <thead>
              <tr>
                <th>Almacén</th>
                <th className="num">Cajas</th>
                <th className="num">Pares</th>
              </tr>
            </thead>
            <tbody>
              {inv.porAlmacen.map((a) => (
                <tr key={a.almacen}>
                  <td className="font-medium">{a.almacen}</td>
                  <td className="num cifra">{n(a.cajas)}</td>
                  <td className="num cifra">{n(a.pares)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="tarjeta overflow-hidden">
          <header className="border-b p-3 hairline">
            <h2 className="text-sm font-semibold">Por pedido</h2>
          </header>
          <div className="max-h-72 overflow-auto">
            <table className="datos">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Almacenes</th>
                  <th className="num">Cajas</th>
                  <th className="num">Pares</th>
                </tr>
              </thead>
              <tbody>
                {inv.porPedido.slice(0, 60).map((p) => (
                  <tr key={p.pedido}>
                    <td className="font-medium">{p.pedido}</td>
                    <td className="text-xs" style={{ color: "var(--ink-2)" }}>
                      {p.almacenes.join(", ")}
                    </td>
                    <td className="num cifra">{n(p.cajas)}</td>
                    <td className="num cifra">{n(p.pares)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <TablaInventario renglones={inv.renglones} soloBodega />
    </div>
  );
}
