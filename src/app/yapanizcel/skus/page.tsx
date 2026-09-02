import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/yapanizcel/cuenta";
import { cargarInventarioAmarrado } from "@/lib/yapanizcel/inventario";
import { todo } from "@/lib/yapanizcel/db";
import { Ficha } from "@/components/tiles";
import { TablaSkus } from "@/components/yapanizcel/tabla-skus";
import { Encabezado, SinCuenta, n } from "@/components/yapanizcel/comunes";

export const dynamic = "force-dynamic";

export default async function SkusYz() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta />;

  const [inv, skus] = await Promise.all([
    cargarInventarioAmarrado(supabase, cuenta.id),
    todo<{ sku: string }>(supabase, "yz_skus", "sku", (q) => q.eq("account_id", cuenta.id).order("sku")),
  ]);

  const automaticos = inv.niveles.exacto + inv.niveles.canonico + inv.niveles.aplastado + inv.niveles.prefijo_nc + inv.niveles.color;

  return (
    <div className="flex flex-col gap-6">
      <Encabezado
        titulo="SKUs · amarre bodega ↔ Mercado Libre"
        texto="El sheet se llena a mano: sobra una N o una C antes del diseño, se cuela un guion, cambian las mayúsculas, el color va como black o blk, navy o blue. Todo eso se amarra solo. Otros prefijos (CH, R, S), una letra suelta en otro lugar o las piezas en otro orden se PROPONEN y se confirman con un clic: el sistema no adivina."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Ficha titulo="Amarrados solos" valor={automaticos} nota={`exacto, mayúsculas, guiones, N o C (${inv.niveles.prefijo_nc}), color (${inv.niveles.color})`} tono="bien" />
        <Ficha titulo="Confirmados a mano" valor={inv.niveles.manual} />
        <Ficha titulo="Con sugerencia" valor={inv.sugeridos} nota="una letra de más u otro orden" tono={inv.sugeridos ? "alerta" : "neutro"} />
        <Ficha titulo="Sin amarrar" valor={inv.sinAmarrar.renglones} nota={`${n(inv.sinAmarrar.unidades)} unidades bloqueadas`} tono={inv.sinAmarrar.renglones ? "critico" : "bien"} />
      </div>

      {inv.renglones.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--ink-2)" }}>
          Todavía no hay inventario de bodega. Léelo desde el sheet en Bodega fundas.
        </p>
      ) : null}
      {skus.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--estado-serio)" }}>
          Todavía no hay catálogo de Mercado Libre: sincroniza primero en Ajustes de fundas.
        </p>
      ) : null}

      <TablaSkus renglones={inv.renglones} skusMeli={skus.map((s) => s.sku)} />
    </div>
  );
}
