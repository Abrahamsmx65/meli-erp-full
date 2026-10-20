import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { vistaBodega } from "@/lib/servicios/bodega";
import { servirConCacheApp } from "@/lib/servicios/cache-app";
import {
  CLAVE_FUNDAS,
  EDAD_FUNDAS_MS,
  calcularExistenciasFundas,
  type ExistenciasFundas,
} from "@/lib/servicios/existencias-fundas";
import type { InversionEnBodega } from "@/lib/servicios/inventario";
import type { DB } from "@/lib/datos/repos";
import { cronometro } from "@/lib/servicios/cronometro";
import { Ficha } from "@/components/tiles";
import { TablaInventario } from "@/components/tabla-inventario";
import { FamiliasExistencias } from "@/components/familias-existencias";
import { armarFamiliasExistencias } from "@/lib/servicios/familias-existencias";
import {
  CLAVE_VENTAS_FAMILIAS,
  EDAD_VENTAS_FAMILIAS_MS,
  calcularVentasParaFamilias,
  type VentasParaFamilias,
} from "@/lib/servicios/ventas-familias";
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

const listaCorta = (xs: string[]) => (xs.length <= 8 ? xs.join(", ") : `${xs.slice(0, 8).join(", ")} y ${xs.length - 8} más`);
const veces = (inv: InversionEnBodega) =>
  inv.sinVentaMeli.veces != null ? `${inv.sinVentaMeli.veces.toFixed(2)} veces` : "";

/** Inversión, venta estimada y ganancia estimada de un bloque (calzado, fundas o todo). */
function FichasDinero({
  inversion,
  venta,
  costo,
  ganancia,
  notaInversion,
  notaVenta,
  notaGanancia,
}: {
  inversion: number;
  venta: number | null;
  costo: number;
  ganancia: number | null;
  notaInversion: string;
  notaVenta?: string;
  notaGanancia?: string;
}) {
  return (
    <Cifras columnas={3}>
      <Ficha titulo="Inversión" valor={inversion > 0 ? pesos(inversion) : "—"} nota={notaInversion} tono="bien" />
      <Ficha
        titulo="Venta estimada"
        valor={venta != null ? pesos(venta) : "—"}
        nota={notaVenta ?? (venta != null ? `Lo que depositaría MELI por lo que costó ${pesos(costo)}` : "Sin ventas de MELI para estimar")}
      />
      <Ficha
        titulo="Ganancia estimada"
        valor={ganancia != null ? pesos(ganancia) : "—"}
        nota={notaGanancia ?? (ganancia != null ? `Venta estimada − ${pesos(costo)} de costo` : "Sin ventas de MELI para estimar")}
        tono={ganancia == null || ganancia >= 0 ? "bien" : "critico"}
      />
    </Cifras>
  );
}

/** La tabla de inversión por categoría, la misma para calzado y fundas. */
function TablaInversion({ inversion, unidad, minimo }: { inversion: InversionEnBodega; unidad: string; minimo: number }) {
  const { ganancia, sinVentaMeli } = inversion;
  const porPromedio = sinVentaMeli.pares > 0 && sinVentaMeli.veces != null;
  const conTikTok = inversion.total.enTikTok > 0;
  return (
    <Seccion titulo="Inversión por categoría" sinRelleno>
      {inversion.categorias.length === 0 ? (
        <p className="texto-2 p-4 text-sm">
          Faltan costos.{" "}
          <Link href="/productos" className="enlace">
            Capturar costos en Catálogo y costos
          </Link>
        </p>
      ) : (
        <Tabla>
          <table className="datos">
            <thead>
              <tr>
                <th>Categoría</th>
                <th className="num">Modelos</th>
                <th className="num">{unidad[0].toUpperCase() + unidad.slice(1)}</th>
                <th className="num">Valor en bodega</th>
                <th className="num">Valor en barco</th>
                <th className="num">Valor en Full</th>
                <th className="num">Valor en FBA</th>
                {conTikTok ? <th className="num">Valor en TikTok</th> : null}
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
                  {conTikTok ? <td className="num cifra">{pesos(c.valor.enTikTok)}</td> : null}
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
                {conTikTok ? <td className="num cifra font-semibold">{pesos(inversion.total.enTikTok)}</td> : null}
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
          <strong>
            {n(sinVentaMeli.pares)} {unidad}
          </strong>{" "}
          de {sinVentaMeli.modelos.length} modelos vendieron menos de {minimo} {unidad} en MELI en 30 días (
          {listaCorta(sinVentaMeli.modelos)})
          {porPromedio
            ? `: su venta se estima con el promedio de los que sí venden (MELI deposita ${veces(inversion)} su costo): ${pesos(sinVentaMeli.costo)} de costo → ${pesos(sinVentaMeli.deposito)}.`
            : ": no hay modelos con venta para sacar un promedio, así que no entran en la ganancia."}
        </footer>
      ) : null}
      {inversion.sinCosto.pares > 0 || inversion.sinCategoria > 0 ? (
        <footer className="border-t p-3 text-xs hairline texto-tenue">
          {inversion.sinCosto.pares > 0 ? (
            <>
              <strong>
                {n(inversion.sinCosto.pares)} {unidad}
              </strong>{" "}
              de {inversion.sinCosto.modelos.length} modelos NO entran en estos totales porque no tienen costo capturado (
              {listaCorta(inversion.sinCosto.modelos)}).{" "}
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
  );
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

  const [vista, fundasLeidas, ventasLeidas] = await Promise.all([
    vistaBodega(supabase, cuenta.id, t),
    servirConCacheApp<ExistenciasFundas>(supabase as DB, cuenta.id, CLAVE_FUNDAS, EDAD_FUNDAS_MS, () =>
      calcularExistenciasFundas(supabase as DB),
    ).catch((err) => ({ error: (err as Error).message }) as const),
    // Lo vendido por SKU (30 días y toda la historia) para el total por
    // familia: masticado, el RPC histórico tarda ~1.5 s.
    servirConCacheApp<VentasParaFamilias>(supabase as DB, cuenta.id, CLAVE_VENTAS_FAMILIAS, EDAD_VENTAS_FAMILIAS_MS, () =>
      calcularVentasParaFamilias(supabase as DB, cuenta.id),
    ).catch((err) => ({ error: (err as Error).message }) as const),
  ]);
  t.fin();
  const ventasFamilias = "error" in ventasLeidas ? null : ventasLeidas.datos;
  const familias = armarFamiliasExistencias({
    skus: vista.skusExistencias,
    cajasPorModelo: vista.cajasPorModelo,
    ventas30: ventasFamilias?.d30 ?? [],
    ventasHist: ventasFamilias?.hist ?? [],
  });
  const { fichas, inversion } = vista;
  const { ganancia, sinVentaMeli } = inversion;
  const porPromedio = sinVentaMeli.pares > 0 && sinVentaMeli.veces != null;

  const fundas = "error" in fundasLeidas ? null : fundasLeidas.datos.hayCuenta ? fundasLeidas.datos : null;
  const errorFundas = "error" in fundasLeidas ? fundasLeidas.error : null;
  const fi = fundas?.inversion;

  // Todo junto: calzado + fundas. Cada uno ya trae su ganancia con su propio
  // depósito de MELI; aquí solo se suman.
  const junto = {
    inversion: inversion.total.total + (fi?.total.total ?? 0),
    venta: ganancia.deposito + (fi?.ganancia.deposito ?? 0),
    costo: ganancia.costo + (fi?.ganancia.costo ?? 0),
    ganancia: ganancia.ganancia + (fi?.ganancia.ganancia ?? 0),
    hayVenta: ganancia.pares + (fi?.ganancia.pares ?? 0) > 0,
  };

  return (
    <Pagina>
      <Encabezado
        ceja="Inventario"
        titulo="Existencias"
        descripcion="Calzado y fundas: bodega, lo que viene en barco y lo que ya está en Full, FBA y TikTok, con lo invertido y lo que dejaría venderlo."
        frescura={"error" in fundasLeidas ? undefined : fundasLeidas.generadoEn}
        refrescando={"error" in fundasLeidas ? undefined : fundasLeidas.refrescando}
        ayuda={
          <>
            <p>
              Lo de Mercado Libre vive en su propia sección. El Excel se baja desde la tabla por SKU, con los mismos filtros
              que estés viendo.
            </p>
            <p>
              La inversión es todo a costo de Catálogo y costos: bodega, lo que viene de China YA EN BARCO (en calzado, las
              cajas en contenedores sin recibir; en fundas, los pedidos marcados «en camino»; lo que sigue en la fábrica no
              se ha pagado y no cuenta ni en la inversión ni en la ganancia), Full (con lo que va en
              transferencia), FBA (disponible, reservado y lo ya enviado; un envío solo dado de alta no, porque sus cajas
              siguen en la bodega) y, en calzado, la bodega de TikTok (el saldo del kardex, sin los productos de David).
              La ganancia estimada es vender TODO eso a lo que Mercado Pago depositó por pieza de cada modelo o diseño en
              los últimos 30 días (en calzado, reventa incluida, el mismo número de Números) menos el costo; es antes de
              publicidad y gastos. Un modelo con menos de 10 piezas vendidas en MELI en 30 días se estima con el promedio
              de los que sí venden: su costo × (todo lo que deposita MELI ÷ el costo de esas piezas), y se dice cuáles son.
            </p>
            <p>
              Fundas: la bodega es el sheet de inventario ya amarrado a MELI (lo que no amarra no se costea), Full es la
              cuenta de fundas y FBA son las fundas de la cuenta de Amazon. Los envíos registrados a Full no se suman: el
              sheet los puede seguir trayendo.
            </p>
            <p>
              Por familia: un renglón por modelo con lo que hay de él en bodega, en barco, en la fábrica (fuera del total:
              no se ha pagado), en Full (con lo que va en transferencia), en FBA y en la bodega de TikTok, y lo que vendió
              en los últimos 30 días y desde que el ERP registra, por canal (MELI calzado, Amazon y TikTok; sin lo de
              David). «Alcanza» son los días que dura el total al ritmo de esos 30 días. Las cajas se cuentan una sola vez:
              una caja de corrida trae varias tallas, pero todas del mismo modelo. Abrir el renglón lo parte por color; un
              par cuyo SKU no dice el color cuenta en la familia pero no en ningún color.
            </p>
          </>
        }
      />

      <Seccion titulo="Todo junto · calzado + fundas" suelta>
        <FichasDinero
          inversion={junto.inversion}
          venta={junto.hayVenta ? junto.venta : null}
          costo={junto.costo}
          ganancia={junto.hayVenta ? junto.ganancia : null}
          notaInversion={`Calzado ${pesos(inversion.total.total)} + fundas ${fi ? pesos(fi.total.total) : "—"}, a costo`}
          notaGanancia={
            junto.hayVenta
              ? `Calzado ${pesos(ganancia.ganancia)} + fundas ${fi ? pesos(fi.ganancia.ganancia) : "—"}`
              : undefined
          }
        />
      </Seccion>

      {vista.avisos.map((a, i) => (
        <Aviso key={i} tono="alerta">
          {a}
        </Aviso>
      ))}

      <Seccion titulo="Calzado" suelta>
        <Cifras columnas={6}>
          <Ficha titulo="SKUs" valor={n(fichas.skus)} nota="Con producto en bodega o en camino" />
          <Ficha
            titulo="Pares en bodega"
            valor={n(fichas.paresEnBodega)}
            nota={`En ${n(fichas.cajas)} cajas cerradas en México`}
          />
          <Ficha
            titulo="En barco"
            valor={n(fichas.paresEnCamino)}
            nota={
              fichas.paresEnFabrica > 0
                ? `En contenedor sin llegar · ${n(fichas.paresEnFabrica)} pares más en la fábrica, no cuentan`
                : "En contenedor sin llegar"
            }
            tono={fichas.paresEnCamino > 0 ? "alerta" : "neutro"}
          />
          <Ficha titulo="En Full" valor={n(fichas.paresEnFull)} nota="Pares en Mercado Libre, con lo que va en transferencia" />
          <Ficha titulo="En FBA" valor={n(fichas.paresEnFba)} nota="Pares en Amazon, con lo ya enviado" />
          <Ficha titulo="En TikTok" valor={n(fichas.paresEnTikTok)} nota="Bodega de TikTok, sin lo de David" />
        </Cifras>

        <Cifras columnas={5}>
          <Ficha titulo="Valor en bodega" valor={fichas.valorEnBodega > 0 ? pesos(fichas.valorEnBodega) : "—"} nota="A costo" />
          <Ficha
            titulo="Valor en barco"
            valor={fichas.valorEnCamino > 0 ? pesos(fichas.valorEnCamino) : "—"}
            nota={
              fichas.paresSinCosto > 0
                ? `A costo · ${n(fichas.paresSinCosto)} pares sin costo capturado`
                : "Lo que ya va en barco, a costo"
            }
          />
          <Ficha titulo="Valor en Full" valor={fichas.valorEnFull > 0 ? pesos(fichas.valorEnFull) : "—"} nota="Mercado Libre, a costo" />
          <Ficha titulo="Valor en FBA" valor={fichas.valorEnFba > 0 ? pesos(fichas.valorEnFba) : "—"} nota="Amazon, a costo" />
          <Ficha titulo="Valor en TikTok" valor={fichas.valorEnTikTok > 0 ? pesos(fichas.valorEnTikTok) : "—"} nota="La bodega de TikTok, a costo" />
        </Cifras>

        <FichasDinero
          inversion={fichas.inversionTotal}
          venta={ganancia.pares > 0 ? ganancia.deposito : null}
          costo={ganancia.costo}
          ganancia={ganancia.pares > 0 ? ganancia.ganancia : null}
          notaInversion="Bodega + barco + Full + FBA + TikTok, a costo"
          notaVenta={
            ganancia.pares > 0
              ? `Lo que depositaría MELI por ${n(ganancia.pares)} pares que costaron ${pesos(ganancia.costo)}${
                  porPromedio ? ` · ${pesos(sinVentaMeli.deposito)} de eso por promedio` : ""
                }`
              : undefined
          }
          notaGanancia={
            ganancia.pares > 0
              ? `Venta estimada − ${pesos(ganancia.costo)} de costo${
                  porPromedio
                    ? ` · ${n(sinVentaMeli.pares)} pares sin venta en MELI con el promedio (MELI deposita ${veces(inversion)} su costo)`
                    : ""
                }`
              : undefined
          }
        />
      </Seccion>

      <Seccion titulo="Fundas" suelta>
        {errorFundas ? <Aviso tono="alerta">No se pudieron leer las fundas: {errorFundas}</Aviso> : null}
        {!errorFundas && !fundas ? <Aviso tono="info">No hay cuenta de fundas conectada.</Aviso> : null}
        {fundas && fi ? (
          <>
            {fundas.avisos.map((a, i) => (
              <Aviso key={i} tono="alerta">
                {a}
              </Aviso>
            ))}
            <Cifras columnas={4}>
              <Ficha
                titulo="Piezas en bodega"
                valor={n(fundas.piezas.enBodega)}
                nota={
                  fundas.sinAmarrar.unidades > 0
                    ? `Del sheet · ${n(fundas.sinAmarrar.unidades)} sin amarrar a MELI, fuera`
                    : "Del sheet de inventario"
                }
              />
              <Ficha
                titulo="En barco"
                valor={n(fundas.piezas.enCamino)}
                nota={
                  fundas.piezas.enFabrica > 0
                    ? `Pedidos marcados «en camino» · ${n(fundas.piezas.enFabrica)} piezas más en la fábrica, no cuentan`
                    : "Pedidos marcados «en camino»"
                }
                tono={fundas.piezas.enCamino > 0 ? "alerta" : "neutro"}
              />
              <Ficha titulo="En Full" valor={n(fundas.piezas.enFull)} nota="Cuenta de fundas, con lo que va en transferencia" />
              <Ficha titulo="En FBA" valor={n(fundas.piezas.enFba)} nota="Fundas en Amazon, con lo ya enviado" />
            </Cifras>
            <Cifras columnas={4}>
              <Ficha titulo="Valor en bodega" valor={fi.total.enBodega > 0 ? pesos(fi.total.enBodega) : "—"} nota="A costo" />
              <Ficha titulo="Valor en barco" valor={fi.total.enCamino > 0 ? pesos(fi.total.enCamino) : "—"} nota="A costo" />
              <Ficha titulo="Valor en Full" valor={fi.total.enFull > 0 ? pesos(fi.total.enFull) : "—"} nota="A costo" />
              <Ficha
                titulo="Valor en FBA"
                valor={fi.total.enFba > 0 ? pesos(fi.total.enFba) : "—"}
                nota={fi.sinCosto.pares > 0 ? `A costo · ${n(fi.sinCosto.pares)} piezas sin costo, fuera` : "A costo"}
              />
            </Cifras>
            <FichasDinero
              inversion={fi.total.total}
              venta={fi.ganancia.pares > 0 ? fi.ganancia.deposito : null}
              costo={fi.ganancia.costo}
              ganancia={fi.ganancia.pares > 0 ? fi.ganancia.ganancia : null}
              notaInversion="Bodega + barco + Full + FBA, a costo"
              notaGanancia={
                fi.ganancia.pares > 0
                  ? `Venta estimada − ${pesos(fi.ganancia.costo)} de costo${
                      fi.sinVentaMeli.pares > 0 && fi.sinVentaMeli.veces != null
                        ? ` · ${n(fi.sinVentaMeli.pares)} piezas sin venta en MELI con el promedio (${veces(fi)} su costo)`
                        : ""
                    }`
                  : undefined
              }
            />
          </>
        ) : null}
      </Seccion>

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
            cuenta: familias.filter((f) => f.total > 0).length,
            contenido: (
              <>
                {"error" in ventasLeidas ? (
                  <Aviso tono="alerta">No se pudieron leer las ventas por familia: {ventasLeidas.error}</Aviso>
                ) : null}
                <FamiliasExistencias
                  familias={familias}
                  desde30={ventasFamilias?.desde30 ?? ""}
                  hasta={ventasFamilias?.hasta ?? ""}
                  desdeCanal={ventasFamilias?.desdeCanal ?? { meli: null, amazon: null, tiktok: null }}
                />
              </>
            ),
          },
          {
            id: "inversion",
            titulo: "Inversión calzado",
            cuenta: inversion.categorias.length || null,
            contenido: <TablaInversion inversion={inversion} unidad="pares" minimo={10} />,
          },
          ...(fi
            ? [
                {
                  id: "inversion-fundas",
                  titulo: "Inversión fundas",
                  cuenta: fi.categorias.length || null,
                  contenido: <TablaInversion inversion={fi} unidad="piezas" minimo={10} />,
                },
              ]
            : []),
        ]}
      />
    </Pagina>
  );
}
