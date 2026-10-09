import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { vistaBodega } from "@/lib/servicios/bodega";
import { cronometro } from "@/lib/servicios/cronometro";
import { Ficha } from "@/components/tiles";
import { TablaInventario } from "@/components/tabla-inventario";
import { TotalMexico } from "@/components/total-mexico";
import { Cifras, Encabezado, Pagina, Seccion, SinCuenta, Tabla } from "@/components/ui/pagina";
import { Pestanas } from "@/components/ui/pestanas";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

function porcentaje(x: number): string {
  return `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
}

/**
 * Bodega. La página NO calcula: `vistaBodega` entrega las cifras ya
 * masticadas y aquí solo se acomodan.
 */
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

  if (!cuenta) return <SinCuenta titulo="Bodega" />;

  const vista = await vistaBodega(supabase, cuenta.id, t);
  t.fin();
  const { fichas, inversion } = vista;

  return (
    <Pagina>
      <Encabezado
        ceja="Inventario"
        titulo="Bodega"
        descripcion="Lo que está en cajas cerradas en tus bodegas y lo que viene en camino de China."
        ayuda={
          <>
            <p>
              Lo de Mercado Libre vive en su propia sección. El Excel se baja desde la tabla por SKU, con los mismos filtros
              que estés viendo.
            </p>
            <p>
              En el total por familia las cajas se cuentan una sola vez: una caja de corrida trae varias tallas, pero todas
              del mismo modelo, así que por familia el número es exacto. Por eso el desglose de adentro solo muestra pares.
            </p>
          </>
        }
      />

      <Cifras columnas={6}>
        <Ficha titulo="SKUs" valor={n(fichas.skus)} nota="Con producto en bodega o en camino" />
        <Ficha titulo="Cajas cerradas" valor={n(fichas.cajas)} nota="En las bodegas de México" />
        <Ficha titulo="Pares en bodega" valor={n(fichas.paresEnBodega)} nota="Dentro de esas cajas" />
        <Ficha
          titulo="En camino de China"
          valor={n(fichas.paresEnCamino)}
          nota="Pedidos que ya salieron y no han llegado"
          tono={fichas.paresEnCamino > 0 ? "alerta" : "neutro"}
        />
        <Ficha
          titulo="Valor en bodega"
          valor={fichas.valorEnBodega > 0 ? pesos(fichas.valorEnBodega) : "—"}
          nota={
            fichas.valorEnBodega > 0
              ? fichas.paresSinCosto > 0
                ? `A costo · ${n(fichas.paresSinCosto)} pares sin costo capturado`
                : "A costo, con todos los costos capturados"
              : "Captura costos en Productos y costos"
          }
        />
        <Ficha
          titulo="Valor en camino"
          valor={fichas.valorEnCamino > 0 ? pesos(fichas.valorEnCamino) : "—"}
          nota="Lo que viene de China, a costo"
        />
      </Cifras>

      {/* Pestañas: la tabla por SKU primero (ahí aterriza el buscador de la
           barra superior; la llave la rearma con cada búsqueda y vuelve a la
           primera pestaña), luego el total por familia y la inversión. */}
      <Pestanas
        key={busquedaInicial || "raiz"}
        pestanas={[
          {
            id: "sku",
            titulo: "Por SKU",
            cuenta: vista.renglones.length,
            contenido: (
              <TablaInventario
                key={busquedaInicial || "raiz"}
                busquedaInicial={busquedaInicial}
                renglones={vista.renglones}
                almacenes={vista.almacenes}
              />
            ),
          },
          {
            id: "familia",
            titulo: "Por familia",
            contenido: <TotalMexico renglones={vista.renglones} cajasPorModelo={vista.cajasPorModelo} />,
          },
          {
            id: "inversion",
            titulo: "Inversión",
            cuenta: inversion.categorias.length || null,
            contenido: (
              <>
                {/* ---- Dónde está parado el dinero -------------------------------- */}
                <Seccion
                  titulo="Inversión por categoría"
                  descripcion="Dinero parado en cada tipo de producto, a costo: cajas cerradas más lo que viene en el barco."
                  sinRelleno
                >
                  {inversion.categorias.length === 0 ? (
                    <p className="texto-2 p-4 text-sm">
                      Todavía no se puede calcular: ningún modelo con existencia tiene costo
                      capturado.{" "}
                      <Link href="/productos" className="enlace">
                        Capturar costos en Productos y costos
                      </Link>
                    </p>
                  ) : (
                    <Tabla>
                    <table className="datos">
                      <thead>
                        <tr>
                          <th>Categoría</th>
                          <th className="num">Modelos</th>
                          <th className="num">Pares en bodega</th>
                          <th className="num">Pares en camino</th>
                          <th className="num">Valor en bodega</th>
                          <th className="num">Valor en camino</th>
                          <th className="num">Inversión</th>
                          <th className="num">Del total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inversion.categorias.map((c) => (
                          <tr key={c.categoria}>
                            <td className="font-medium">{c.categoria}</td>
                            <td className="num cifra">{n(c.modelos)}</td>
                            <td className="num cifra">{c.pares.enBodega ? n(c.pares.enBodega) : "—"}</td>
                            <td className="num cifra texto-2">
                              {c.pares.enCamino ? n(c.pares.enCamino) : "—"}
                            </td>
                            <td className="num cifra">{pesos(c.valor.enBodega)}</td>
                            <td className="num cifra texto-2">
                              {pesos(c.valor.enCamino)}
                            </td>
                            <td className="num cifra font-semibold">{pesos(c.valor.total)}</td>
                            <td className="num cifra texto-2">
                              {porcentaje(c.parte)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {/* El total va abajo, para poder compararlo con las fichas de arriba. */}
                      <tfoot>
                        <tr style={{ background: "var(--surface-2)" }}>
                          <td className="font-semibold">Total</td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td className="num cifra font-semibold">{pesos(inversion.total.enBodega)}</td>
                          <td className="num cifra font-semibold">{pesos(inversion.total.enCamino)}</td>
                          <td className="num cifra font-semibold">{pesos(inversion.total.total)}</td>
                          <td className="num cifra">100%</td>
                        </tr>
                      </tfoot>
                    </table>
                    </Tabla>
                  )}

                  {inversion.sinCosto.pares > 0 || inversion.sinCategoria > 0 ? (
                    <footer className="border-t p-3 text-xs hairline texto-tenue">
                      {inversion.sinCosto.pares > 0 ? (
                        <>
                          <strong>{n(inversion.sinCosto.pares)} pares</strong> de{" "}
                          {inversion.sinCosto.modelos.length} modelos NO entran en estos totales
                          porque no tienen costo capturado
                          {inversion.sinCosto.modelos.length <= 8
                            ? ` (${inversion.sinCosto.modelos.join(", ")})`
                            : ` (${inversion.sinCosto.modelos.slice(0, 8).join(", ")} y ${inversion.sinCosto.modelos.length - 8} más)`}
                          .{" "}
                          <Link href="/productos" className="enlace">
                            Capturarlos
                          </Link>
                          {inversion.sinCategoria > 0 ? " · " : ""}
                        </>
                      ) : null}
                      {inversion.sinCategoria > 0
                        ? `${inversion.sinCategoria} modelos tienen costo pero no categoría: van juntos en «Sin categoría».`
                        : null}
                    </footer>
                  ) : null}
                </Seccion>
              </>
            ),
          },
        ]}
      />
    </Pagina>
  );
}
