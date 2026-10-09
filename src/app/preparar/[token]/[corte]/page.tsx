import Link from "next/link";
import { cuentaPorTokenPreparar } from "@/lib/servicios/acceso-preparar";
import { cargarCorte, preparadosDelCorte } from "@/lib/servicios/tiktok-despacho";
import { numerosPreparados } from "@/lib/tiktok/despacho";
import { clienteAdmin } from "@/lib/supabase/server";
import { PrepararTikTok } from "@/components/preparar-tiktok";
import { Aviso, Encabezado, Pagina } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/** La estación de preparar, sin sesión. La puerta es el token; lo demás es igual. */
export default async function EstacionPublica({ params }: { params: Promise<{ token: string; corte: string }> }) {
  const { token, corte } = await params;
  const cuenta = await cuentaPorTokenPreparar(token);
  const corteId = Number(corte);
  if (!cuenta || !Number.isFinite(corteId)) {
    return (
      <Pagina>
        <Aviso tono="critico" titulo="Este link ya no sirve">Pide el link nuevo a quien administra el despacho.</Aviso>
      </Pagina>
    );
  }

  const admin = clienteAdmin();
  const [datos, preparados] = await Promise.all([
    cargarCorte(admin, cuenta.id, corteId),
    preparadosDelCorte(admin, cuenta.id, corteId),
  ]);

  return (
    <Pagina>
      <Encabezado
        ceja="TikTok Shop"
        titulo={`Preparar pedidos · Corte #${datos.numero}`}
        descripcion="Escanea la etiqueta, luego el producto (un escaneo por par)."
        acciones={
          <Link href={`/preparar/${token}`} className="boton boton-fantasma">
            ← Otros cortes
          </Link>
        }
      />
      <PrepararTikTok
        corteId={datos.id}
        numero={datos.numero}
        paquetes={datos.paquetes}
        preparadosIniciales={numerosPreparados(datos.paquetes, preparados)}
        urlGuardar={`/api/preparar-publico/${token}/cortes/${datos.id}/preparar`}
      />
    </Pagina>
  );
}
