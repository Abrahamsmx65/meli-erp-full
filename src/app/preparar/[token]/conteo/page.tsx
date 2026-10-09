import Link from "next/link";
import { cuentaPorTokenPreparar } from "@/lib/servicios/acceso-preparar";
import { catalogoParaConteo } from "@/lib/servicios/tiktok-conteo";
import { clienteAdmin } from "@/lib/supabase/server";
import { ConteoTikTok } from "@/components/conteo-tiktok";
import { Aviso, Encabezado, Pagina } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/** El conteo cíclico desde la estación sin sesión: la puerta es el token. */
export default async function ConteoPublico({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const cuenta = await cuentaPorTokenPreparar(token);
  if (!cuenta) {
    return (
      <Pagina>
        <Aviso tono="critico" titulo="Este link ya no sirve">Pide el link nuevo a quien administra el despacho.</Aviso>
      </Pagina>
    );
  }

  const productos = await catalogoParaConteo(clienteAdmin(), cuenta.id);

  return (
    <Pagina>
      <Encabezado
        ceja="TikTok Shop"
        titulo="Conteo cíclico · TikTok"
        descripcion="Escanea el FNSKU de cada par. Si cuentas un modelo completo, elígelo arriba."
        acciones={
          <Link href={`/preparar/${token}`} className="boton boton-fantasma">
            ← Cortes
          </Link>
        }
      />
      <ConteoTikTok productos={productos} urlGuardar={`/api/preparar-publico/${token}/conteo`} />
    </Pagina>
  );
}
