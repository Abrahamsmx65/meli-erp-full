import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/yapanizcel/cuenta";
import { obtenerInventarioPantalla } from "@/lib/yapanizcel/inventario-pantalla";
import { Ficha } from "@/components/tiles";
import { BotonSheets } from "@/components/yapanizcel/acciones";
import { TablaInventarioYz, type RenglonInv } from "@/components/yapanizcel/tabla-inventario";
import { n } from "@/components/yapanizcel/comunes";
import { Aviso, Cifras, Encabezado, Pagina, Seccion, SinCuenta } from "@/components/ui/pagina";
import { configuracionSheets } from "@/lib/yapanizcel/sheets";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function InventarioYz() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta servicio="yapanizcel" titulo="Bodega fundas" />;

  // La pantalla vive masticada en yz_cache; solo la ficha del sheet se lee
  // fresca (es un renglón y cambia con cada lectura del sheet).
  const [pantalla, sync] = await Promise.all([
    obtenerInventarioPantalla(supabase, cuenta.id),
    supabase.from("yz_inventario_sync").select("corrido_en, hojas, renglones, unidades, avisos").eq("account_id", cuenta.id).maybeSingle(),
  ]);
  const inv = { porSkuMeli: { size: pantalla.skusMeliConBodega }, sinAmarrar: pantalla.sinAmarrar, sugeridos: pantalla.sugeridos };
  const renglones: RenglonInv[] = pantalla.renglones;
  const totalBodega = pantalla.totalBodega;
  const ultima = sync.data;

  return (
    <Pagina>
      <Encabezado
        ceja="Fundas"
        titulo="Bodega fundas"
        descripcion="El sheet de inventario amarrado a cada SKU de Mercado Libre, con lo que hay en Full y en camino."
        frescura={pantalla.generadoEn}
        ayuda={
          <p>
            Una pestaña por diseño. Se lee a diario en el cron y cuando lo pides aquí; cada lectura reemplaza la bodega
            completa. Solo cuentan las pestañas cuyo nombre empieza con número (el diseño).
          </p>
        }
      />

      <Seccion
        titulo="Sheet de inventario"
        descripcion={ultima ? `Leído ${new Date(ultima.corrido_en).toLocaleString("es-MX")} · ${ultima.hojas} pestañas · ${n(ultima.renglones)} SKUs` : "El sheet todavía no se ha leído."}
      >
        <BotonSheets configurado={Boolean(configuracionSheets())} />
      </Seccion>

      <Cifras columnas={4}>
        <Ficha titulo="Unidades en bodega (amarradas)" valor={n(totalBodega)} nota={`${inv.porSkuMeli.size} SKUs de MELI`} />
        <Ficha titulo="Sin amarrar" valor={n(inv.sinAmarrar.unidades)} nota={`${inv.sinAmarrar.renglones} SKUs de bodega`} tono={inv.sinAmarrar.renglones ? "alerta" : "bien"} />
        <Ficha titulo="Con sugerencia" valor={inv.sugeridos} nota="Confirmar en SKUs" tono={inv.sugeridos ? "alerta" : "neutro"} />
        <Ficha titulo="En Full" valor={n(renglones.reduce((a, r) => a + r.enFull, 0))} nota={`${n(renglones.reduce((a, r) => a + r.enTransferencia, 0))} en transferencia`} />
      </Cifras>

      {inv.sinAmarrar.renglones ? (
        <Aviso tono="alerta">
          Hay {inv.sinAmarrar.renglones} SKUs de bodega ({n(inv.sinAmarrar.unidades)} unidades) que el sistema no supo a qué publicación corresponden.{" "}
          <Link href="/yapanizcel/skus" className="enlace">
            Resolverlos en SKUs
          </Link>
          .
        </Aviso>
      ) : null}

      <TablaInventarioYz renglones={renglones} />
    </Pagina>
  );
}
