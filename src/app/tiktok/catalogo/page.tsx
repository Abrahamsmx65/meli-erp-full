import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, traerTodo } from "@/lib/datos/repos";
import { CLAVE_CATALOGO_AMAZON } from "@/lib/servicios/catalogo-amazon";
import type { ProductoCatalogo } from "@/lib/tienda/catalogo-amazon";
import { BackCatalogo } from "@/components/back-catalogo";

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
  if (!cuenta) {
    return (
      <div className="tarjeta mx-auto max-w-lg p-8 text-center">
        <h1 className="titulo-seccion">Conecta Mercado Libre primero</h1>
      </div>
    );
  }
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
    <div className="space-y-4">
      <div>
        <h1 className="titulo-seccion">Catálogo para creadores</h1>
        <p className="text-sm" style={{ color: "var(--ink-2)" }}>
          Todo el calzado de Amazon con fotos (desde el GT101). Aquí decides qué se ve en{" "}
          <a href={`${urlTienda}/catalogo`} target="_blank" rel="noopener noreferrer" className="underline">
            la página del catálogo
          </a>{" "}
          y en qué categoría sale. La categoría se guarda en Productos y costos. Bodega y mar salen de la vista de inventario (Bodega y
          Planificación China). Datos de {(data as any)?.generado_en ? new Date((data as any).generado_en).toLocaleString("es-MX", { timeZone: "America/Mexico_City" }) : "—"};
          se actualizan cada hora y al guardar un cambio.
        </p>
      </div>
      {productos.length ? (
        <BackCatalogo productos={productos} categorias={categorias} />
      ) : (
        <div className="tarjeta p-6 text-sm">El catálogo todavía no se arma: corre solo cada hora en la actualización de la tienda.</div>
      )}
    </div>
  );
}
