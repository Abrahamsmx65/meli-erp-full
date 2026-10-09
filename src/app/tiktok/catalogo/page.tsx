import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import { CLAVE_CATALOGO_AMAZON } from "@/lib/servicios/catalogo-amazon";
import type { ProductoCatalogo } from "@/lib/tienda/catalogo-amazon";
import { BackCatalogo } from "@/components/back-catalogo";
import { Encabezado, Pagina, SinCuenta, Vacio } from "@/components/ui/pagina";

export const dynamic = "force-dynamic";

/**
 * El back del catálogo completo para creadores (`tienda/` → `/catalogo`;
 * dueño, 5-oct-2026): qué modelos se ven, su categoría y cuántos pares hay
 * entre la bodega y el mar. Lee el renglón que dejó masticado el cron de la
 * tienda (`servicios/catalogo-amazon.ts`); no le pregunta nada a Amazon.
 */
export default async function CatalogoCreadores() {
  const supabase = await clienteServidor();
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return <SinCuenta titulo="Catálogo para creadores" />;
  const admin = clienteAdmin();
  const [{ data }, config] = await Promise.all([
    admin.from("app_cache").select("datos, generado_en").eq("account_id", cuenta.id).eq("clave", CLAVE_CATALOGO_AMAZON).maybeSingle(),
    traerTodo<any>(admin, "productos_config", "categoria", (q) => q.eq("account_id", cuenta.id).not("categoria", "is", null)),
  ]);
  const datos = (data as any)?.datos ?? {};
  const productos: ProductoCatalogo[] = Array.isArray(datos.productos) ? datos.productos : [];
  const categorias = [
    ...new Set([...(config ?? []).map((c: any) => String(c.categoria).trim()), ...productos.map((p) => p.categoria)].filter((c) => c && c !== "Fundas")),
  ].sort((a, b) => a.localeCompare(b, "es"));
  const urlTienda = (process.env.TIENDA_URL ?? "https://getac-tienda-getac.vercel.app").replace(/\/+$/, "");

  return (
    <Pagina>
      <Encabezado
        ceja="TikTok Shop"
        titulo="Catálogo para creadores"
        descripcion="Qué modelos se ven en la página del catálogo, su categoría y cuántos pares hay."
        frescura={(data as any)?.generado_en ?? null}
        acciones={
          <a href={`${urlTienda}/catalogo`} target="_blank" rel="noopener noreferrer" className="boton boton-borde">
            Abrir el catálogo ↗
          </a>
        }
        ayuda={
          <>
            <p>
              Todo el calzado de Amazon con fotos (desde el GT101). Aquí decides qué se ve en{" "}
              <a href={`${urlTienda}/catalogo`} target="_blank" rel="noopener noreferrer" className="enlace">
                la página del catálogo
              </a>{" "}
              y en qué categoría sale. La categoría se guarda en Productos y costos.
            </p>
            <p>
              El precio es el de{" "}
              <a href="/tiktok/precios" className="enlace">
                Precios para TikTok
              </a>{" "}
              (relámpago normal en la página; «Mi precio» manda).
            </p>
            <p>
              El total suma la bodega y lo que viene de China (en el mar y los pedidos, de la vista de inventario) más la
              bodega de TikTok; la página solo enseña ese total. Los datos se actualizan cada hora y al guardar un cambio.
            </p>
          </>
        }
      />
      {productos.length ? (
        <BackCatalogo productos={productos} categorias={categorias} />
      ) : (
        <Vacio>El catálogo todavía no se arma.</Vacio>
      )}
    </Pagina>
  );
}
