import Link from "next/link";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/yapanizcel/cuenta";
import { obtenerInventarioAmarrado } from "@/lib/yapanizcel/inventario-pantalla";
import { Ficha } from "@/components/tiles";
import { TablaSkus } from "@/components/yapanizcel/tabla-skus";
import { n } from "@/components/yapanizcel/comunes";
import { Aviso, Cifras, Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function SkusYz() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta servicio="yapanizcel" titulo="SKUs de fundas" />;

  // El amarre vive masticado en yz_cache ("amarre"): lo invalidan el sheet,
  // la sincronización del catálogo y cada amarre confirmado a mano.
  // Del catálogo solo hace falta saber si existe: el SKU de MELI del amarre
  // manual se busca mientras se escribe (/api/yapanizcel/skus/buscar), ya
  // no viajan los ~15 mil SKUs en la página.
  const [inv, { data: unSku }] = await Promise.all([
    obtenerInventarioAmarrado(supabase, cuenta.id),
    supabase.from("yz_skus").select("sku").eq("account_id", cuenta.id).limit(1),
  ]);
  const hayCatalogo = (unSku ?? []).length > 0;

  const automaticos = inv.niveles.exacto + inv.niveles.canonico + inv.niveles.aplastado + inv.niveles.prefijo_nc + inv.niveles.color;

  return (
    <Pagina>
      <Encabezado
        ceja="Fundas"
        titulo="SKUs de fundas"
        descripcion="Amarre de los SKUs del sheet de bodega con las publicaciones de Mercado Libre."
        ayuda={
          <p>
            El sheet se llena a mano: sobra una N o una C antes del diseño, se cuela un guion, cambian las mayúsculas, el
            color va como black o blk, navy o blue. Todo eso se amarra solo. Otros prefijos (CH, R, S), una letra suelta en
            otro lugar o las piezas en otro orden se PROPONEN y se confirman con un clic: el sistema no adivina.
          </p>
        }
      />

      <Cifras columnas={4}>
        <Ficha titulo="Amarrados solos" valor={automaticos} nota={`exacto, mayúsculas, guiones, N o C (${inv.niveles.prefijo_nc}), color (${inv.niveles.color})`} tono="bien" />
        <Ficha titulo="Confirmados a mano" valor={inv.niveles.manual} />
        <Ficha titulo="Con sugerencia" valor={inv.sugeridos} nota="una letra de más u otro orden" tono={inv.sugeridos ? "alerta" : "neutro"} />
        <Ficha titulo="Sin amarrar" valor={inv.sinAmarrar.renglones} nota={`${n(inv.sinAmarrar.unidades)} unidades bloqueadas`} tono={inv.sinAmarrar.renglones ? "critico" : "bien"} />
      </Cifras>

      {inv.renglones.length === 0 ? (
        <Aviso tono="info">
          Todavía no hay inventario de bodega. Léelo desde el sheet en{" "}
          <Link href="/yapanizcel/inventario" className="enlace">
            Bodega fundas
          </Link>
          .
        </Aviso>
      ) : null}
      {!hayCatalogo ? (
        <Aviso tono="alerta">
          Todavía no hay catálogo de Mercado Libre: sincroniza primero en{" "}
          <Link href="/yapanizcel/ajustes" className="enlace">
            Ajustes fundas
          </Link>
          .
        </Aviso>
      ) : null}

      <TablaSkus renglones={inv.renglones} />
    </Pagina>
  );
}
