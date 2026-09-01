import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, leerParametros } from "@/lib/yapanizcel/cuenta";
import { cargarInventarioAmarrado } from "@/lib/yapanizcel/inventario";
import { cargarEnvios } from "@/lib/yapanizcel/envios";
import { cargarPedidosEnCamino } from "@/lib/yapanizcel/compras";
import { hoyMx, restarDias, todo } from "@/lib/yapanizcel/db";
import { construirIndice, desglosar } from "@/lib/yapanizcel/sku";
import { Ficha } from "@/components/tiles";
import { BotonSheets } from "@/components/yapanizcel/acciones";
import { TablaInventarioYz, type RenglonInv } from "@/components/yapanizcel/tabla-inventario";
import { Encabezado, SinCuenta, n } from "@/components/yapanizcel/comunes";
import { configuracionSheets } from "@/lib/yapanizcel/sheets";

export const dynamic = "force-dynamic";

export default async function InventarioYz() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta />;

  const p = await leerParametros(supabase, cuenta.id);
  const hasta = hoyMx();
  const desde = restarDias(hasta, p.diasVenta - 1);

  const [inv, skus, stock, ventas, { enCamino }, mapeos, sync] = await Promise.all([
    cargarInventarioAmarrado(supabase, cuenta.id),
    todo<{ sku: string; titulo: string | null; diseno: string | null }>(supabase, "yz_skus", "sku, titulo, diseno", (q) => q.eq("account_id", cuenta.id)),
    todo<{ sku: string; disponible: number; en_transferencia: number }>(supabase, "yz_stock_full", "sku, disponible, en_transferencia", (q) => q.eq("account_id", cuenta.id)),
    todo<{ sku: string; unidades: number }>(supabase, "yz_ventas_diarias", "sku, unidades", (q) => q.eq("account_id", cuenta.id).gte("fecha", desde).lte("fecha", hasta)),
    cargarEnvios(supabase, cuenta.id, p.diasCaducidadEnvio),
    todo<{ sku_bodega: string; sku_meli: string }>(supabase, "yz_mapeo_skus", "sku_bodega, sku_meli", (q) => q.eq("account_id", cuenta.id)),
    supabase.from("yz_inventario_sync").select("corrido_en, hojas, renglones, unidades, avisos").eq("account_id", cuenta.id).maybeSingle(),
  ]);

  const china = await cargarPedidosEnCamino(supabase, cuenta.id, {
    indice: construirIndice(skus.map((s) => s.sku)),
    manual: new Map(mapeos.map((m) => [m.sku_bodega, m.sku_meli])),
    porBodega: new Map(inv.renglones.map((r) => [r.skuBodega, r.skuMeli])),
  });

  const stockPor = new Map(stock.map((s) => [s.sku, s]));
  const vend = new Map<string, number>();
  for (const v of ventas) vend.set(v.sku, (vend.get(v.sku) ?? 0) + v.unidades);
  const camino = new Map<string, number>();
  for (const c of enCamino) camino.set(c.skuMeli, (camino.get(c.skuMeli) ?? 0) + c.unidades);
  const bodegaSkus = new Map<string, string[]>();
  for (const r of inv.renglones) if (r.skuMeli) bodegaSkus.set(r.skuMeli, [...(bodegaSkus.get(r.skuMeli) ?? []), r.skuBodega]);

  const renglones: RenglonInv[] = skus
    .map((s) => ({
      skuMeli: s.sku,
      titulo: s.titulo,
      diseno: s.diseno || desglosar(s.sku).diseno,
      enFull: stockPor.get(s.sku)?.disponible ?? 0,
      enTransferencia: stockPor.get(s.sku)?.en_transferencia ?? 0,
      enCamino: camino.get(s.sku) ?? 0,
      enBodega: inv.porSkuMeli.get(s.sku) ?? 0,
      enCaminoChina: china.get(s.sku) ?? 0,
      vendidas30: vend.get(s.sku) ?? 0,
      skusBodega: bodegaSkus.get(s.sku) ?? [],
    }))
    .sort((a, b) => b.vendidas30 - a.vendidas30 || a.skuMeli.localeCompare(b.skuMeli));

  const totalBodega = [...inv.porSkuMeli.values()].reduce((a, b) => a + b, 0);
  const ultima = sync.data;

  return (
    <div className="flex flex-col gap-6">
      <Encabezado titulo="Bodega · YAPANIZCEL" texto="Lo que dice el sheet de inventario, amarrado a cada SKU de Mercado Libre, junto con lo que hay en Full y lo que viene en camino.">
        <div className="text-right text-xs" style={{ color: "var(--ink-muted)" }}>
          {ultima ? `Sheet leído ${new Date(ultima.corrido_en).toLocaleString("es-MX")} · ${ultima.hojas} pestañas · ${n(ultima.renglones)} SKUs` : "El sheet todavía no se ha leído."}
        </div>
      </Encabezado>

      <div className="tarjeta p-4">
        <BotonSheets configurado={Boolean(configuracionSheets())} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Ficha titulo="Unidades en bodega (amarradas)" valor={n(totalBodega)} nota={`${inv.porSkuMeli.size} SKUs de MELI`} />
        <Ficha titulo="Sin amarrar" valor={n(inv.sinAmarrar.unidades)} nota={`${inv.sinAmarrar.renglones} SKUs de bodega`} tono={inv.sinAmarrar.renglones ? "alerta" : "bien"} />
        <Ficha titulo="Con sugerencia" valor={inv.sugeridos} nota="Confirmar en SKUs" tono={inv.sugeridos ? "alerta" : "neutro"} />
        <Ficha titulo="En Full" valor={n(renglones.reduce((a, r) => a + r.enFull, 0))} nota={`${n(renglones.reduce((a, r) => a + r.enTransferencia, 0))} en transferencia`} />
      </div>

      {inv.sinAmarrar.renglones ? (
        <p className="text-sm">
          Hay {inv.sinAmarrar.renglones} SKUs de bodega ({n(inv.sinAmarrar.unidades)} unidades) que el sistema no supo a qué publicación corresponden.{" "}
          <Link href="/yapanizcel/skus" className="underline" style={{ color: "var(--acento)" }}>
            Resolverlos en SKUs
          </Link>
          .
        </p>
      ) : null}

      <TablaInventarioYz renglones={renglones} />
    </div>
  );
}
