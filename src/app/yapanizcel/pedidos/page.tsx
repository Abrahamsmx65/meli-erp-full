import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/yapanizcel/cuenta";
import { DIAS_OBJETIVO_PEDIDO, detalleDiseno, resumenDisenos } from "@/lib/yapanizcel/compras";
import { listarPedidos } from "@/lib/yapanizcel/pedidos";
import { Ficha } from "@/components/tiles";
import { CargarPedido, ListaPedidos } from "@/components/yapanizcel/pedidos";
import { Encabezado, SinCuenta, dias, n, pesos } from "@/components/yapanizcel/comunes";

export const dynamic = "force-dynamic";

export default async function PedidosYz({ searchParams }: { searchParams: Promise<{ diseno?: string }> }) {
  const sp = await searchParams;
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta />;

  const [resumen, pedidos] = await Promise.all([resumenDisenos(supabase, cuenta.id), listarPedidos(supabase, cuenta.id)]);
  const detalle = sp.diseno ? await detalleDiseno(supabase, cuenta.id, sp.diseno) : null;

  return (
    <div className="flex flex-col gap-6">
      <Encabezado
        titulo="Pedidos a China · YAPANIZCEL"
        texto={`Elige un diseño para ver todas sus variantes con todo el inventario que existe (Full, en camino, bodega y pedidos sin recibir) contra su venta. El objetivo son ${DIAS_OBJETIVO_PEDIDO} días de cobertura total; lo que falta es lo sugerido.`}
      />

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Diseños</h2>
        <div className="flex flex-wrap gap-2">
          {resumen.disenos.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
              Sin catálogo todavía: sincroniza en Ajustes de fundas.
            </p>
          ) : null}
          {resumen.disenos.map((d) => {
            const activo = detalle?.diseno === d.diseno;
            return (
              <Link
                key={d.diseno}
                href={`/yapanizcel/pedidos?diseno=${encodeURIComponent(d.diseno)}`}
                className="rounded-lg border px-3 py-2 text-sm"
                style={activo ? { background: "var(--acento)", color: "#fff", borderColor: "var(--acento)" } : { borderColor: "var(--borde)", background: "var(--surface-1)" }}
                title={`${d.variantes} variantes · ${n(d.vendidas30)} vendidas · cobertura ${dias(d.cobertura)}`}
              >
                <span className="num font-semibold">{d.diseno}</span>
                <span className="ml-2 text-xs" style={{ color: activo ? "#fff" : "var(--ink-muted)" }}>
                  {d.sugerido > 0 ? `pedir ${n(d.sugerido)}` : dias(d.cobertura)}
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {sp.diseno && !detalle ? (
        <p className="text-sm" style={{ color: "var(--estado-serio)" }}>
          No hay publicaciones del diseño «{sp.diseno}».
        </p>
      ) : null}

      {detalle ? (
        <section className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Ficha titulo={`Diseño ${detalle.diseno}`} valor={`${detalle.variantes.length} variantes`} />
            <Ficha titulo="Vendidas 30 d" valor={n(detalle.vendidas30)} />
            <Ficha titulo="Existencia total" valor={n(detalle.posicionTotal)} nota="Full + camino + bodega + China" />
            <Ficha titulo="Sugerido pedir" valor={n(detalle.sugerido)} nota={detalle.costoEstimado ? `≈ ${pesos(detalle.costoEstimado)} a costo` : "sin costo cargado"} tono={detalle.sugerido ? "alerta" : "bien"} />
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
                    <td className="num px-3 py-1.5 text-right">{n(v.enTransferencia + v.enCaminoFull)}</td>
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
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">Cargar un pedido ya hecho o en camino</h2>
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
