import Link from "next/link";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { catalogoParaConteo } from "@/lib/servicios/tiktok-conteo";
import { ConteoTikTok } from "@/components/conteo-tiktok";
import { Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/** Conteo cíclico del almacén de TikTok, con sesión. */
export default async function Conteo() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Conteo cíclico" />;

  // El FNSKU sale de las tablas de Amazon, que bajo RLS solo abre el dueño:
  // el rol de TikTok las leía vacías y contaba sin FNSKU. Se leen con el
  // cliente admin (solo lectura), como en `cargarCorte`.
  const productos = await catalogoParaConteo(supabase, cuenta.id, clienteAdmin());

  return (
    <Pagina>
      <Encabezado
        ceja="TikTok Shop"
        titulo="Conteo cíclico · Almacén TikTok"
        descripcion="Escanea el FNSKU de cada par; la diferencia entra al kardex como ajuste."
        acciones={
          <Link href="/tiktok" className="boton boton-fantasma">
            ← Almacén TikTok
          </Link>
        }
        ayuda={<p>Al guardar, la diferencia entra al kardex como ajuste y el disponible nuevo se publica a TikTok en el mismo clic.</p>}
        ayudaTitulo="¿Qué pasa al guardar?"
      />
      <ConteoTikTok productos={productos} urlGuardar="/api/tiktok/conteo" />
    </Pagina>
  );
}
