import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { clienteAdmin } from "@/lib/supabase/admin";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { aplicarCostosReales, guardarExcelCosteo, recalcularCosteo } from "@/lib/servicios/costeo";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Costeo real por contenedor:
 *   - multipart con `archivo`: sube el Excel de costeo de la fábrica y recalcula;
 *   - `{ accion: "refrescar" }`: vuelve a leer los sheets y recalcula;
 *   - `{ accion: "aplicar", modelos?: string[] }`: pasa el costo real a
 *     Catálogo y costos (sin `modelos`, todos los que tengan costo real).
 * El sheet de cuentas solo se LEE (exportación pública); nada aquí lo escribe.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  // El cálculo junta inventario de Full, TikTok y FBA: va con service_role.
  const admin = clienteAdmin() as DB;
  try {
    const tipo = req.headers.get("content-type") ?? "";
    if (tipo.includes("multipart/form-data")) {
      const form = await req.formData();
      const archivo = form.get("archivo");
      if (!(archivo instanceof File)) return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });
      const excel = await guardarExcelCosteo(admin, cuenta.id, Buffer.from(await archivo.arrayBuffer()), archivo.name);
      const r = await recalcularCosteo(admin, cuenta.id);
      return NextResponse.json({ ok: true, contenedoresExcel: excel.contenedores.length, costeados: r.contenedores.filter((c) => c.cuenta).length });
    }

    const body = await req.json().catch(() => ({}));
    if (body?.accion === "aplicar") {
      const modelos = Array.isArray(body.modelos) ? body.modelos.filter((m: unknown) => typeof m === "string") : null;
      // productos_config se escribe como el dueño (RLS), no con service_role.
      const r = await aplicarCostosReales(supabase as DB, cuenta.id, modelos);
      return NextResponse.json({ ok: true, ...r });
    }
    if (body?.accion === "refrescar") {
      const r = await recalcularCosteo(admin, cuenta.id);
      return NextResponse.json({ ok: true, costeados: r.contenedores.filter((c) => c.cuenta).length, fuentes: r.fuentes });
    }
    return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
