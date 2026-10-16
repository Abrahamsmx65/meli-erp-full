import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { vistaBodega } from "@/lib/servicios/bodega";
import { cronometro } from "@/lib/servicios/cronometro";
import { Ficha } from "@/components/tiles";
import { TablaInventario } from "@/components/tabla-inventario";
import { TotalMexico } from "@/components/total-mexico";
import { Aviso, Cifras, Encabezado, Pagina, Seccion, SinCuenta, Tabla } from "@/components/ui/pagina";
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

  if (!cuenta) return <SinCuenta titulo="Existencias en bodega" />;

  const vista = await vistaBodega(supabase, cuenta.id, t);
  t.fin();
  const { fichas, inversion } = vista;
  const { ganancia, sinVentaMeli } = inversion;
  const porPromedio = sinVentaMeli.pares > 0 && sinVentaMeli.veces != null;
  const veces = sinVentaMeli.veces != null ? `${sinVentaMeli.veces.toFixed(2)} veces` : "";
  const listaCorta = (xs: string[]) => (xs.length <= 8 ? xs.join(", ") : `${xs.slice(0, 8).join(", ")} y ${xs.length - 8} más`);

  return (
    <Pagina>
      <Encabezado
        ceja="Inventario"
        titulo="Existencias en bodega"
        descripcion="Cajas en bodega, lo que viene de China y lo que ya está en Full, FBA y TikTok, con lo invertido y lo que dejaría venderlo."
        ayuda={
          <>
            <p>
              Lo de Mercado Libre vive en su propia sección. El Excel se baja desde la tabla por SKU, con los mismos filtros
              que estés viendo.
            </p>
            <p>
              La inversión es todo a costo de Productos y costos: bodega, lo que viene de China, Full (con lo que va en
              transferencia) y FBA (disponible, reservado y lo ya enviado; un envío solo dado de alta no, porque sus cajas
              siguen en la bodega) y la bodega de TikTok (el saldo del kardex, sin los productos de David). La ganancia estimada es vender TODO eso a lo que Mercado Pago depositó por par de cada
              modelo en los últimos 30 días (reventa incluida, el mismo número de Números) menos el costo; es antes de
              publicidad y gastos. Un modelo con menos de 10 pares vendidos en MELI en 30 días se estima con el
              promedio de los que sí venden: su costo × (todo lo que deposita MELI ÷ el costo de esos pares), y se dice
              cuáles son.
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
        <Ficha
          titulo="Pares en bodega"
          valor={n(fichas.paresEnBodega)}
          nota={`En ${n(fichas.cajas)} cajas cerradas en México`}
        />
        <Ficha
          titulo="En camino de China"
          valor={n(fichas.paresEnCamino)}
          nota="Pedidos que ya salieron y no han llegado"
          tono={fichas.paresEnCamino > 0 ? "alerta" : "neutro"}
        />
        <Ficha
          titulo="En Full"
          valor={n(fichas.paresEnFull)}
          nota="Pares en Mercado Libre, con lo que va en transferencia"
        />
        <Ficha titulo="En FBA" valor={n(fichas.paresEnFba)} nota="Pares en Amazon, con lo ya enviado" />
        <Ficha titulo="En TikTok" valor={n(fichas.paresEnTikTok)} nota="Bodega de TikTok, sin lo de David" />
      </Cifras>

      {vista.avisos.map((a, i) => (
        <Aviso key={i} tono="alerta">
          {a}
        </Aviso>
      ))}

      <Cifras columnas={5}>
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
        <Ficha
          titulo="Valor en Full"
          valor={fichas.valorEnFull > 0 ? pesos(fichas.valorEnFull) : "—"}
          nota="Lo que está en Mercado Libre, a costo"
        />
        <Ficha
          titulo="Valor en FBA"
          valor={fichas.valorEnFba > 0 ? pesos(fichas.valorEnFba) : "—"}
          nota="Lo que está en Amazon, a costo"
        />
        <Ficha
          titulo="Valor en TikTok"
          valor={fichas.valorEnTikTok > 0 ? pesos(fichas.valorEnTikTok) : "—"}
          nota="La bodega de TikTok, a costo"
        />
      </Cifras>

      <Cifras columnas={3}>
        <Ficha
          titulo="Inversión total"
          valor={fichas.inversionTotal > 0 ? pesos(fichas.inversionTotal) : "—"}
          nota="Bodega + camino + Full + FBA + TikTok, a costo"
          tono="bien"
        />
        <Ficha
          titulo="Venta estimada"
          valor={ganancia.pares > 0 ? pesos(ganancia.deposito) : "—"}
          nota={
            ganancia.pares > 0
              ? `Lo que depositaría MELI por ${n(ganancia.pares)} pares que costaron ${pesos(ganancia.costo)}${
                  porPromedio ? ` · ${pesos(sinVentaMeli.deposito)} de eso por promedio` : ""
                }`
              : "Sin ventas de MELI para estimar"
          }
        />
        <Ficha
          titulo="Ganancia estimada"
          valor={ganancia.pares > 0 ? pesos(ganancia.ganancia) : "—"}
          nota={
            ganancia.pares > 0
              ? `Venta estimada − ${pesos(ganancia.costo)} de costo${
                  porPromedio
                    ? ` · ${n(sinVentaMeli.pares)} pares sin venta en MELI con el promedio (MELI deposita ${veces} su costo)`
                    : ""
                }`
              : "Sin ventas de MELI para estimar"
          }
          tono={ganancia.ganancia >= 0 ? "bien" : "critico"}
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
                  sinRelleno
                >
                  {inversion.categorias.length === 0 ? (
                    <p className="texto-2 p-4 text-sm">
                      Faltan costos.{" "}
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
                          <th className="num">Pares</th>
                          <th className="num">Valor en bodega</th>
                          <th className="num">Valor en camino</th>
                          <th className="num">Valor en Full</th>
                          <th className="num">Valor en FBA</th>
                          <th className="num">Valor en TikTok</th>
                          <th className="num">Inversión</th>
                          <th className="num">Del total</th>
                          <th className="num">Depósito MELI</th>
                          <th className="num">Ganancia estimada</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inversion.categorias.map((c) => (
                          <tr key={c.categoria}>
                            <td className="font-medium">{c.categoria}</td>
                            <td className="num cifra">{n(c.modelos)}</td>
                            <td className="num cifra">
                              {n(c.pares.enBodega + c.pares.enCamino + c.pares.enFull + c.pares.enFba + c.pares.enTikTok)}
                            </td>
                            <td className="num cifra">{pesos(c.valor.enBodega)}</td>
                            <td className="num cifra texto-2">{pesos(c.valor.enCamino)}</td>
                            <td className="num cifra">{pesos(c.valor.enFull)}</td>
                            <td className="num cifra">{pesos(c.valor.enFba)}</td>
                            <td className="num cifra">{pesos(c.valor.enTikTok)}</td>
                            <td className="num cifra font-semibold">{pesos(c.valor.total)}</td>
                            <td className="num cifra texto-2">{porcentaje(c.parte)}</td>
                            <td className="num cifra texto-2">{c.ganancia.pares ? pesos(c.ganancia.deposito) : "—"}</td>
                            <td className="num cifra font-semibold">{c.ganancia.pares ? pesos(c.ganancia.ganancia) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                      {/* El total va abajo, para poder compararlo con las fichas de arriba. */}
                      <tfoot>
                        <tr style={{ background: "var(--surface-2)" }}>
                          <td className="font-semibold">Total</td>
                          <td></td>
                          <td></td>
                          <td className="num cifra font-semibold">{pesos(inversion.total.enBodega)}</td>
                          <td className="num cifra font-semibold">{pesos(inversion.total.enCamino)}</td>
                          <td className="num cifra font-semibold">{pesos(inversion.total.enFull)}</td>
                          <td className="num cifra font-semibold">{pesos(inversion.total.enFba)}</td>
                          <td className="num cifra font-semibold">{pesos(inversion.total.enTikTok)}</td>
                          <td className="num cifra font-semibold">{pesos(inversion.total.total)}</td>
                          <td className="num cifra">100%</td>
                          <td className="num cifra font-semibold">{ganancia.pares ? pesos(ganancia.deposito) : "—"}</td>
                          <td className="num cifra font-semibold">{ganancia.pares ? pesos(ganancia.ganancia) : "—"}</td>
                        </tr>
                      </tfoot>
                    </table>
                    </Tabla>
                  )}

                  {sinVentaMeli.pares > 0 ? (
                    <footer className="border-t p-3 text-xs hairline texto-tenue">
                      <strong>{n(sinVentaMeli.pares)} pares</strong> de {sinVentaMeli.modelos.length} modelos vendieron
                      menos de 10 pares en MELI en 30 días ({listaCorta(sinVentaMeli.modelos)})
                      {porPromedio
                        ? `: su venta se estima con el promedio de los que sí venden (MELI deposita ${veces} su costo): ${pesos(sinVentaMeli.costo)} de costo → ${pesos(sinVentaMeli.deposito)}.`
                        : ": no hay modelos con venta para sacar un promedio, así que no entran en la ganancia."}
                    </footer>
                  ) : null}
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
