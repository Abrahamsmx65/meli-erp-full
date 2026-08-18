import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarInventario } from "@/lib/servicios/inventario";
import { Ficha } from "@/components/tiles";
import { TablaInventario } from "@/components/tabla-inventario";
import Link from "next/link";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
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

  const inv = await cargarInventario(supabase, cuenta.id);
  const t = inv.totales;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Inventario</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Todo tu producto en un solo lugar: lo que está en Full, lo que viaja hacia
          allá, lo que está en cajas cerradas en bodega y lo que viene de China.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Ficha titulo="SKUs" valor={n(t.skus)} nota="Con inventario o publicación" />
        <Ficha titulo="En Full" valor={n(t.enFull)} nota="Listos para vender" tono="bien" />
        <Ficha
          titulo="Hacia Full"
          valor={n(t.enTransferencia)}
          nota="En transferencia"
        />
        <Ficha titulo="En bodega" valor={n(t.enBodega)} nota="En cajas cerradas" />
        <Ficha
          titulo="Desde China"
          valor={n(t.enCamino)}
          nota="En camino a bodega"
          tono={t.enCamino > 0 ? "alerta" : "neutro"}
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

      <TablaInventario renglones={inv.renglones} />
    </div>
  );
}
