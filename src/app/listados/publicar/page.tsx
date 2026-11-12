import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { clienteDeCuenta } from "@/lib/servicios/webhooks";
import { listarPublicaciones, opcionesDeFicha, type CategoriaConModelos } from "@/lib/servicios/meli-publicar";
import { PublicarMeli } from "@/components/publicar-meli";
import { PublicarAmazon } from "@/components/publicar-amazon";
import { Pestanas } from "@/components/ui/pestanas";
import { datosDePantallaAmazon } from "@/lib/servicios/amazon-publicar";
import { EnlacePublicar } from "@/components/enlace-publicar";
import { tokenDePublicar } from "@/lib/servicios/acceso-publicar";
import { rolDeSesion } from "@/lib/acceso/roles";
import { Aviso, Encabezado, Pagina, SinCuenta } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/**
 * Publicar productos nuevos de calzado en Mercado Libre: título, modelo,
 * colores, tallas, categoría y precio; lo demás se copia de una publicación
 * reciente de la misma categoría. Pedido del dueño, 12-nov-2026.
 */
export default async function PaginaPublicarMeli() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Publicar productos" />;
  const esDueno = rolDeSesion(user) === "dueño";
  const token = esDueno ? await tokenDePublicar(cuenta.id).catch(() => null) : null;

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
  const amazon = await datosDePantallaAmazon(admin, cuenta.id);

  return (
    <Pagina>
      <Encabezado
        ceja="Mercado Libre"
        titulo="Publicar productos"
        descripcion="Un producto nuevo de calzado en Mercado Libre o en Amazon, con la ficha copiada de un modelo parecido."
      />
      <Pestanas
        parametro="canal"
        pestanas={[
          {
            id: "meli",
            titulo: "Mercado Libre",
            contenido: (
              <div className="flex flex-col gap-4">
                {error ? <Aviso tono="critico">{error}</Aviso> : null}
                <PublicarMeli categorias={categorias} publicacionesIniciales={publicaciones} />
              </div>
            ),
          },
          {
            id: "amazon",
            titulo: "Amazon",
            contenido: (
              <div className="flex flex-col gap-4">
                {amazon.error ? <Aviso tono="critico">{amazon.error}</Aviso> : null}
                <PublicarAmazon modelos={amazon.modelos} publicacionesIniciales={amazon.publicaciones} />
              </div>
            ),
          },
        ]}
      />
      {esDueno ? <EnlacePublicar tokenInicial={token} /> : null}
    </Pagina>
  );
}
