import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/yapanizcel/cuenta";
import { DIAS_OBJETIVO_PEDIDO, obtenerDetalleCompras, obtenerResumenCompras } from "@/lib/yapanizcel/compras";
import { listarPedidos } from "@/lib/yapanizcel/pedidos";
import { Ficha } from "@/components/tiles";
import { CargarPedido, ListaPedidos } from "@/components/yapanizcel/pedidos";
import { Encabezado, Frescura, SinCuenta, dias, n, pesos } from "@/components/yapanizcel/comunes";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const btn = "rounded-lg border px-3 py-1.5 text-sm font-semibold";

export default async function PedidosYz({ searchParams }: { searchParams: Promise<{ diseno?: string }> }) {
  const sp = await searchParams;
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta />;

  // El cálculo completo vive masticado en yz_cache y sus vistas derivadas
  // también: la pantalla lee SOLO el resumen por diseño y, si se abrió uno,
  // el renglón de ese diseño (nunca las 14 mil variantes).
  const [resumen, detalle, pedidos] = await Promise.all([
    obtenerResumenCompras(supabase, cuenta.id),
    sp.diseno ? obtenerDetalleCompras(supabase, cuenta.id, sp.diseno) : Promise.resolve(null),
    listarPedidos(supabase, cuenta.id),
  ]);
  const totalPedir = resumen.disenos.reduce((a, d) => a + d.sugerido, 0);

  return (
    <div className="flex flex-col gap-6">
      <Encabezado
        titulo="Pedidos a China · YAPANIZCEL"
        texto={`Un renglón por diseño. Al abrirlo salen todas sus variantes con todo el inventario que existe (Full, en camino, bodega y pedidos sin recibir) contra su venta de 30 días, y cuánto pedir para ${DIAS_OBJETIVO_PEDIDO} días.`}
      >
        <a href="/api/yapanizcel/pedidos/excel" className={btn} style={{ borderColor: "var(--borde)" }}>
          Excel de todos los diseños
        </a>
      </Encabezado>

      {detalle ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">
              Diseño {detalle.diseno} ·{" "}
              <Link href="/yapanizcel/pedidos" className="text-sm font-normal underline" style={{ color: "var(--ink-muted)" }}>
                volver a la lista
              </Link>
            </h2>
            <a href={`/api/yapanizcel/pedidos/excel?diseno=${encodeURIComponent(detalle.diseno)}`} className={btn} style={{ background: "var(--acento)", color: "#fff", borderColor: "var(--acento)" }}>
              Excel del diseño {detalle.diseno}
            </a>
          </div>
          <Frescura generadoEn={detalle.generadoEn} />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Ficha titulo="Variantes" valor={detalle.variantes.length} />
            <Ficha titulo="Vendidas 30 d" valor={n(detalle.vendidas30)} />
            <Ficha titulo="Existencia total" valor={n(detalle.posicionTotal)} nota="Full + camino + bodega + China" />
            <Ficha titulo={`Pedir (${DIAS_OBJETIVO_PEDIDO} días)`} valor={n(detalle.sugerido)} nota={detalle.costoEstimado ? `≈ ${pesos(detalle.costoEstimado)} a costo` : "sin costo cargado"} tono={detalle.sugerido ? "alerta" : "bien"} />
          </div>
          <div className="tarjeta overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Modelo</th>
                  <th className="px-3 py-2">Color</th>
                  <th className="px-3 py-2 text-right">Vend. 30 d</th>
                  <th className="px-3 py-2 text-right">En Full</th>
                  <th className="px-3 py-2 text-right">Transf.</th>
                  <th className="px-3 py-2 text-right">Camino a Full</th>
                  <th className="px-3 py-2 text-right">Bodega</th>
                  <th className="px-3 py-2 text-right">Desde China</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Cobertura</th>
                  <th className="px-3 py-2 text-right">Pedir</th>
                </tr>
              </thead>
              <tbody>
                {detalle.variantes.map((v) => (
                  <tr key={v.skuMeli} className="border-t" style={{ borderColor: "var(--grid)" }}>
                    <td className="num px-3 py-1.5 font-medium" title={v.titulo ?? ""}>
                      {v.skuMeli}
                    </td>
                    <td className="px-3 py-1.5">{v.modelo}</td>
                    <td className="px-3 py-1.5">{v.color}</td>
                    <td className="num px-3 py-1.5 text-right">{n(v.vendidas30)}</td>
                    <td className="num px-3 py-1.5 text-right">{n(v.enFull)}</td>
                    <td className="num px-3 py-1.5 text-right">{n(v.enTransferencia)}</td>
                    <td className="num px-3 py-1.5 text-right">{n(v.enCaminoFull)}</td>
                    <td className="num px-3 py-1.5 text-right">{n(v.enBodega)}</td>
                    <td className="num px-3 py-1.5 text-right">{n(v.enCaminoChina)}</td>
                    <td className="num px-3 py-1.5 text-right">{n(v.posicionTotal)}</td>
                    <td className="num px-3 py-1.5 text-right" style={{ color: Number.isFinite(v.cobertura) && v.cobertura < 45 ? "var(--estado-critico)" : undefined }}>
                      {dias(v.cobertura)}
                    </td>
                    <td className="num px-3 py-1.5 text-right font-semibold">{v.sugerido ? n(v.sugerido) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {detalle.descontinuadas.length ? (
            <details className="text-sm" style={{ color: "var(--ink-2)" }}>
              <summary>{detalle.descontinuadas.length} SKUs descontinuados (sin venta en 180 días), fuera del pedido</summary>
              <p className="num mt-1 text-xs">{detalle.descontinuadas.join(", ")}</p>
            </details>
          ) : null}
          <h3 className="mt-2 font-semibold">Cargar pedido del diseño {detalle.diseno}</h3>
          <CargarPedido
            key={detalle.diseno}
            sugerencia={{
              diseno: detalle.diseno,
              lineas: detalle.variantes
                .filter((v) => v.sugerido > 0)
                .map((v) => ({ skuBodega: v.skuMeli, diseno: detalle.diseno, modelo: v.modelo, color: v.color, cantidad: v.sugerido, costoUnitario: v.costoUnitario })),
            }}
          />
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <Frescura generadoEn={resumen.generadoEn} />
          {!resumen.descontinuados.activo ? (
            <p className="text-sm" style={{ color: "var(--ink-2)" }}>
              La regla de descontinuados (sin venta en 180 días) se activa cuando el historial de ventas cubra medio año; hoy llega
              {resumen.descontinuados.historialDesde ? ` hasta el ${resumen.descontinuados.historialDesde}` : " a nada"}. Sincroniza para completarlo.
            </p>
          ) : (
            <p className="text-sm" style={{ color: "var(--ink-2)" }}>
              {resumen.descontinuados.skus} SKUs descontinuados (sin una venta en 180 días) no se muestran ni se piden.
              {resumen.descontinuados.disenos
                ? ` ${resumen.descontinuados.disenos} diseños retirados completos (ninguna variante vendió en 180 días); los demás siguen con sus variantes vivas.`
                : " Un diseño que sigue vendiendo con otras variantes sí sale."}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Ficha titulo="Diseños" valor={resumen.disenos.length} />
            <Ficha titulo="Con algo que pedir" valor={resumen.disenos.filter((d) => d.sugerido > 0).length} tono="alerta" />
            <Ficha titulo={`Unidades a pedir (${DIAS_OBJETIVO_PEDIDO} d)`} valor={n(totalPedir)} />
          </div>
          {sp.diseno ? (
            <p className="text-sm" style={{ color: "var(--estado-serio)" }}>
              No hay publicaciones del diseño «{sp.diseno}».
            </p>
          ) : null}
          <div className="tarjeta overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
                  <th className="px-3 py-2">Diseño</th>
                  <th className="px-3 py-2 text-right">Variantes</th>
                  <th className="px-3 py-2 text-right">Descont.</th>
                  <th className="px-3 py-2 text-right">Vend. 30 d</th>
                  <th className="px-3 py-2 text-right">Existencia total</th>
                  <th className="px-3 py-2 text-right">Cobertura</th>
                  <th className="px-3 py-2 text-right">Pedir ({DIAS_OBJETIVO_PEDIDO} d)</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {resumen.disenos.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center" style={{ color: "var(--ink-muted)" }}>
                      Sin catálogo todavía: sincroniza en Ajustes de fundas.
                    </td>
                  </tr>
                ) : null}
                {resumen.disenos.map((d) => (
                  <tr key={d.diseno} className="border-t" style={{ borderColor: "var(--grid)" }}>
                    <td className="num px-3 py-1.5 font-semibold">
                      <Link href={`/yapanizcel/pedidos?diseno=${encodeURIComponent(d.diseno)}`} className="underline" style={{ color: "var(--acento)" }}>
                        {d.diseno}
                      </Link>
                    </td>
                    <td className="num px-3 py-1.5 text-right">{d.variantes}</td>
                    <td className="num px-3 py-1.5 text-right" style={{ color: "var(--ink-muted)" }}>{d.descontinuadas || ""}</td>
                    <td className="num px-3 py-1.5 text-right">{n(d.vendidas30)}</td>
                    <td className="num px-3 py-1.5 text-right">{n(d.posicionTotal)}</td>
                    <td className="num px-3 py-1.5 text-right" style={{ color: Number.isFinite(d.cobertura) && d.cobertura < 45 ? "var(--estado-critico)" : undefined }}>
                      {dias(d.cobertura)}
                    </td>
                    <td className="num px-3 py-1.5 text-right font-semibold">{d.sugerido ? n(d.sugerido) : "—"}</td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap text-xs">
                      <Link href={`/yapanizcel/pedidos?diseno=${encodeURIComponent(d.diseno)}`} className="underline" style={{ color: "var(--acento)" }}>
                        Abrir
                      </Link>
                      <a href={`/api/yapanizcel/pedidos/excel?diseno=${encodeURIComponent(d.diseno)}`} className="ml-3 underline">
                        Excel
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mt-2 font-semibold">Cargar un pedido ya hecho o en camino</h2>
          <CargarPedido />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Pedidos cargados</h2>
        <ListaPedidos pedidos={pedidos} />
      </section>
    </div>
  );
}
