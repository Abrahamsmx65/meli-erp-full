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
import { Aviso, Cifras, Encabezado, Pagina, Seccion, SinCuenta } from "@/components/ui/pagina";
import { CategoriasExistencias, DondeEsta } from "@/components/inversion-existencias";
import { Pestanas } from "@/components/ui/pestanas";

export const dynamic = "force-dynamic";

function n(x: number): string {
  return Math.round(x).toLocaleString("es-MX");
}

function pesos(x: number): string {
  return "$" + Math.round(x).toLocaleString("es-MX");
}

const listaCorta = (xs: string[]) => (xs.length <= 8 ? xs.join(", ") : `${xs.slice(0, 8).join(", ")} y ${xs.length - 8} más`);
const veces = (inv: InversionEnBodega) =>
  inv.sinVentaMeli.veces != null ? `${inv.sinVentaMeli.veces.toFixed(2)} veces` : "";

/** Lo que no entra en los totales (sin costo, sin venta en MELI), en letra chica. */
function NotasInversion({ inversion, unidad, minimo }: { inversion: InversionEnBodega; unidad: string; minimo: number }) {
  const { sinVentaMeli, sinCosto, sinCategoria } = inversion;
  const porPromedio = sinVentaMeli.pares > 0 && sinVentaMeli.veces != null;
  if (!sinVentaMeli.pares && !sinCosto.pares && !sinCategoria) return null;
  return (
    <div className="space-y-1 border-t p-3 text-xs hairline texto-tenue">
      {sinCosto.pares > 0 ? (
        <p>
          <strong>
            {n(sinCosto.pares)} {unidad}
          </strong>{" "}
          de {sinCosto.modelos.length} modelos no entran porque no tienen costo ({listaCorta(sinCosto.modelos)}).{" "}
          <Link href="/productos" className="enlace">
            Capturar costos
          </Link>
        </p>
      ) : null}
      {sinVentaMeli.pares > 0 ? (
        <p>
          <strong>
            {n(sinVentaMeli.pares)} {unidad}
          </strong>{" "}
          de {sinVentaMeli.modelos.length} modelos vendieron menos de {minimo} en MELI en 30 días
          {porPromedio
            ? `: su venta se estima con el promedio (MELI deposita ${veces(inversion)} su costo). Van marcados «promedio».`
            : ": sin modelos con venta para sacar un promedio, no entran en la ganancia."}
        </p>
      ) : null}
      {sinCategoria > 0 ? <p>{sinCategoria} modelos con costo pero sin categoría van en «Sin categoría».</p> : null}
    </div>
  );
}

/** Lo de un negocio (calzado o fundas): dónde está el dinero y las categorías que se abren por modelo. */
function Negocio({
  inversion,
  unidad,
  notaBarco,
}: {
  inversion: InversionEnBodega;
  unidad: string;
  notaBarco?: string | null;
}) {
  return (
    <div className="space-y-4">
      <Seccion titulo="¿Dónde está el dinero?">
        <DondeEsta inversion={inversion} unidad={unidad} notaBarco={notaBarco} />
      </Seccion>
      <Seccion titulo="Por categoría" descripcion="Toca una categoría para ver sus modelos." sinRelleno>
        {inversion.categorias.length === 0 ? (
          <p className="texto-2 p-4 text-sm">
            Faltan costos.{" "}
            <Link href="/productos" className="enlace">
              Capturar costos en Catálogo y costos
            </Link>
          </p>
        ) : (
          <CategoriasExistencias inversion={inversion} unidad={unidad} />
        )}
        <NotasInversion inversion={inversion} unidad={unidad} minimo={10} />
      </Seccion>
    </div>
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
  const { ganancia } = inversion;

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
        descripcion="Cuánto dinero hay en mercancía, dónde está y qué dejaría venderla."
        frescura={"error" in fundasLeidas ? undefined : fundasLeidas.generadoEn}
        refrescando={"error" in fundasLeidas ? undefined : fundasLeidas.refrescando}
        ayuda={AYUDA}
      />

      <Cifras columnas={3}>
        <Ficha
          titulo="Inversión"
          valor={junto.inversion > 0 ? pesos(junto.inversion) : "—"}
          nota={`Calzado ${pesos(inversion.total.total)} · fundas ${fi ? pesos(fi.total.total) : "—"} · a costo`}
        />
        <Ficha
          titulo="Venta estimada"
          valor={junto.hayVenta ? pesos(junto.venta) : "—"}
          nota="Lo que depositaría MELI por todo"
        />
        <Ficha
          titulo="Ganancia estimada"
          valor={junto.hayVenta ? pesos(junto.ganancia) : "—"}
          nota={
            junto.hayVenta
              ? `Calzado ${pesos(ganancia.ganancia)} · fundas ${fi ? pesos(fi.ganancia.ganancia) : "—"}`
              : "Sin ventas de MELI para estimar"
          }
          tono={!junto.hayVenta || junto.ganancia >= 0 ? "bien" : "critico"}
        />
      </Cifras>

      {vista.avisos.map((a, i) => (
        <Aviso key={i} tono="alerta">
          {a}
        </Aviso>
      ))}
      {errorFundas ? <Aviso tono="alerta">No se pudieron leer las fundas: {errorFundas}</Aviso> : null}
      {fundas?.avisos.map((a, i) => (
        <Aviso key={`f${i}`} tono="alerta">
          {a}
        </Aviso>
      ))}

      {/* Calzado y fundas por categoría primero; la familia con ventas y la
           búsqueda por SKU quedan atrás (el buscador de la barra superior
           aterriza en «Buscar SKU»). */}
      <Pestanas
        key={busquedaInicial || "raiz"}
        inicial={busquedaInicial ? "sku" : undefined}
        pestanas={[
          {
            id: "calzado",
            titulo: "Calzado",
            cuenta: pesos(inversion.total.total),
            contenido: (
              <Negocio
                inversion={inversion}
                unidad="pares"
                notaBarco={
                  fichas.paresEnFabrica > 0 ? `${n(fichas.paresEnFabrica)} pares más en la fábrica, no cuentan` : null
                }
              />
            ),
          },
          fi && fi.total.total > 0
            ? {
                id: "fundas",
                titulo: "Fundas",
                cuenta: pesos(fi.total.total),
                contenido: (
                  <Negocio
                    inversion={fi}
                    unidad="piezas"
                    notaBarco={
                      fundas && fundas.piezas.enFabrica > 0
                        ? `${n(fundas.piezas.enFabrica)} piezas más en la fábrica, no cuentan`
                        : null
                    }
                  />
                ),
              }
            : null,
          {
            id: "familia",
            titulo: "Calzado con ventas",
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
            id: "sku",
            titulo: "Buscar SKU",
            contenido: (
              <TablaInventario
                key={busquedaInicial || "raiz"}
                busquedaInicial={busquedaInicial}
                renglones={vista.renglones}
                almacenes={vista.almacenes}
              />
            ),
          },
        ]}
      />
    </Pagina>
  );
}

const AYUDA = (
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
);
