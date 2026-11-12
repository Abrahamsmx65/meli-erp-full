import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { listarPublicaciones, opcionesDeFicha, type CategoriaConModelos } from "@/lib/servicios/meli-publicar";
import { PublicarMeli } from "@/components/publicar-meli";
import { Aviso, Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/**
 * Publicar productos nuevos de calzado en Mercado Libre: título, modelo,
 * colores, tallas, categoría y precio; lo demás se copia de una publicación
 * reciente de la misma categoría. Pedido del dueño, 12-nov-2026.
 */
export default async function PaginaPublicarMeli() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Publicar productos" />;

  const admin = clienteAdmin();
  const cliente = await clienteDeCuenta(admin, cuenta.id);
  let categorias: CategoriaConModelos[] = [];
  let error: string | null = null;
  try {
    if (!cliente) throw new Error("La cuenta no tiene tokens de MELI guardados.");
    categorias = await opcionesDeFicha(admin, cuenta.id, cliente);
  } catch (err) {
    error = (err as Error).message;
  }
  const publicaciones = await listarPublicaciones(supabase, cuenta.id).catch(() => []);

  return (
    <Pagina>
      <Encabezado
        ceja="Mercado Libre"
        titulo="Publicar productos"
        descripcion="Un producto nuevo de calzado: una publicación por color y talla, con la ficha copiada de un modelo de la misma categoría."
      />
      {error ? <Aviso tono="critico">{error}</Aviso> : null}
      <PublicarMeli categorias={categorias} publicacionesIniciales={publicaciones} />
    </Pagina>
  );
}
