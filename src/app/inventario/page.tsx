import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cargarInventario, familiasMexico } from "@/lib/servicios/inventario";
import { configPorProducto } from "@/lib/servicios/productos";
import { cronometro } from "@/lib/servicios/cronometro";
import { Ficha } from "@/components/tiles";
import { TablaInventario, type RenglonBodega } from "@/components/tabla-inventario";
import { TotalMexico } from "@/components/total-mexico";
import Link from "next/link";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

export default async function Inventario({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  // El buscador de la barra superior aterriza aquí con el texto ya puesto.
  const busquedaInicial = (await searchParams)?.q ?? "";
  const t = cronometro("/inventario");
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  t.marca("cuenta");

  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Conecta Mercado Libre</h1>
        <Link href="/ajustes" className="mt-3 inline-block underline" style={{ color: "var(--acento)" }}>
          Ir a Ajustes
        </Link>
      </div>
    );
  }

  // sinCrudos: la fila de inventario_cache guarda también los SKUs y las
  // corridas completos (los usa Planificación China); esta pantalla no, y
  // bajarlos era su costo dominante.
  const [inv, config] = await Promise.all([
    t.medir("inventario", cargarInventario(supabase, cuenta.id, { sinCrudos: true })),
    t.medir("config", configPorProducto(supabase, cuenta.id)),
  ]);
  t.fin();
  const tot = inv.totales;

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

  const familias = familiasMexico(inv.renglones, inv.cajasPorModelo);
  const skusBodega = inv.renglones.filter((r) => r.enBodega + r.enCamino > 0).length;
  const cajasBodega = inv.porAlmacen.reduce((a, x) => a + x.cajas, 0);

  // Al navegador va SOLO lo que la tabla pinta: 7 campos por renglón, no los
  // 13 de la vista completa (título, inventoryId y columnas de MELI eran
  // carga muerta aquí).
  const renglonesBodega: RenglonBodega[] = inv.renglones.map((r) => ({
    sku: r.sku,
    modelo: r.modelo,
    color: r.color,
    talla: r.talla,
    enBodega: r.enBodega,
    enCamino: r.enCamino,
    pedidos: r.pedidos,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="titulo-pagina">Bodega</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
          Lo que está en cajas cerradas en tu bodega y lo que viene en camino de China.
          Lo de Mercado Libre vive en su propia sección. El Excel se baja desde la
          tabla, con los mismos filtros que estés viendo.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Ficha titulo="SKUs" valor={n(skusBodega)} nota="Con producto en bodega o en camino" />
        <Ficha titulo="Cajas cerradas" valor={n(cajasBodega)} nota="En las bodegas de México" />
        <Ficha titulo="Pares en bodega" valor={n(tot.enBodega)} nota="Dentro de esas cajas" />
        <Ficha
          titulo="En camino de China"
          valor={n(tot.enCamino)}
          nota="Pedidos que ya salieron y no han llegado"
          tono={tot.enCamino > 0 ? "alerta" : "neutro"}
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

      {paresSinCosto > 0 || valorBodega === 0 ? (
        <p className="text-xs" style={{ color: "var(--ink-2)" }}>
          El valor a costo solo suma los modelos con costo capturado.{" "}
          <Link href="/productos" className="underline" style={{ color: "var(--acento)" }}>
            Capturar costos en Productos y costos
          </Link>
        </p>
      ) : null}

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
          {inv.porPedido.length > 60 ? (
            <footer className="border-t p-2.5 text-xs hairline" style={{ color: "var(--ink-muted)" }}>
              Los 60 pedidos con más pares, de {inv.porPedido.length}. Los demás salen
              buscando su número en la tabla de abajo.
            </footer>
          ) : null}
        </section>
      </div>

      <TotalMexico familias={familias} />

      {/* key: si llega otra búsqueda desde la barra superior, la tabla se
          rearma con ella (antes el buscador global no hacía nada estando aquí). */}
      <TablaInventario
        key={busquedaInicial || "raiz"}
        busquedaInicial={busquedaInicial}
        renglones={renglonesBodega}
        almacenes={inv.porAlmacen.map((a) => a.almacen)}
      />
    </div>
  );
}
