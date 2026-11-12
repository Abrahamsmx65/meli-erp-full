import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { clienteAdmin } from "@/lib/supabase/admin";
import { cuentaDePublicarPorToken } from "@/lib/servicios/acceso-publicar";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { listarPublicaciones, opcionesDeFicha, type CategoriaConModelos } from "@/lib/servicios/meli-publicar";
import { PublicarMeli } from "@/components/publicar-meli";
import { Aviso, Encabezado, Pagina } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

// Un link secreto que Google no tiene por qué guardar.
export const metadata: Metadata = {
  title: "Publicar productos",
  robots: { index: false, follow: false },
};

/**
 * «Publicar productos» para quien NO tiene cuenta en el ERP: se entra con
 * el link secreto y se ve solo esta pantalla, sin menú. La puerta es el
 * token (`acceso-publicar.ts`); uno que no existe contesta 404 seco.
 */
export default async function PublicarPublico({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const cuentaId = await cuentaDePublicarPorToken(token);
  if (!cuentaId) notFound();

  const admin = clienteAdmin();
  const cliente = await clienteDeCuenta(admin, cuentaId);
  let categorias: CategoriaConModelos[] = [];
  let error: string | null = null;
  try {
    if (!cliente) throw new Error("La cuenta no tiene tokens de MELI guardados.");
    categorias = await opcionesDeFicha(admin, cuentaId, cliente);
  } catch (err) {
    error = (err as Error).message;
  }
  const publicaciones = await listarPublicaciones(admin, cuentaId).catch(() => []);

  return (
    <Pagina>
      <Encabezado
        ceja="Mercado Libre"
        titulo="Publicar productos"
        descripcion="Un producto nuevo de calzado: una publicación por color y talla. Nacen pausadas."
      />
      {error ? <Aviso tono="critico">{error}</Aviso> : null}
      <PublicarMeli categorias={categorias} publicacionesIniciales={publicaciones} api={`/api/publicar-publico/${token}`} />
    </Pagina>
  );
}
