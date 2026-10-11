import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { clienteAdmin } from "@/lib/supabase/admin";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import {
  agregarPago,
  aplicarCostosReales,
  borrarPago,
  guardarContenedor,
  guardarExcelCosteo,
  recalcularCosteo,
} from "@/lib/servicios/costeo";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Costeo real por contenedor:
 *   - multipart con `archivo`: sube el Excel de costeo de la fábrica;
 *   - `{ accion: "refrescar" }`: recalcula;
 *   - `{ accion: "contenedor", ...CambioContenedor }`: factura, flete,
 *     aduana, entregado;
 *   - `{ accion: "pago", contenedor, concepto, fecha, usd, tipoCambio }` y
 *     `{ accion: "borrar-pago", id }`;
 *   - `{ accion: "aplicar", modelos?: string[] }`: pasa el costo real a
 *     Catálogo y costos (sin `modelos`, todos los que tengan costo real).
 * Toda escritura recalcula en el acto para que la pantalla vea su efecto.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  // Lo capturado se escribe como el dueño (RLS); el cálculo junta
  // inventario de Full, TikTok y FBA y va con service_role.
  const yo = supabase as DB;
  const admin = clienteAdmin() as DB;
  const recalcular = async () => {
    const r = await recalcularCosteo(admin, cuenta.id);
    return { costeados: r.contenedores.filter((c) => c.cuenta).length };
  };
  try {
    const tipo = req.headers.get("content-type") ?? "";
    if (tipo.includes("multipart/form-data")) {
      const form = await req.formData();
      const archivo = form.get("archivo");
      if (!(archivo instanceof File)) return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });
      const excel = await guardarExcelCosteo(admin, cuenta.id, Buffer.from(await archivo.arrayBuffer()), archivo.name);
      return NextResponse.json({ ok: true, contenedoresExcel: excel.contenedores.length, ...(await recalcular()) });
    }

    const body = await req.json().catch(() => ({}));
    switch (body?.accion) {
      case "refrescar":
        return NextResponse.json({ ok: true, ...(await recalcular()) });
      case "contenedor":
        await guardarContenedor(yo, cuenta.id, body);
        return NextResponse.json({ ok: true, ...(await recalcular()) });
      case "pago":
        await agregarPago(yo, cuenta.id, body);
        return NextResponse.json({ ok: true, ...(await recalcular()) });
      case "borrar-pago":
        await borrarPago(yo, cuenta.id, Number(body.id));
        return NextResponse.json({ ok: true, ...(await recalcular()) });
      case "aplicar": {
        const modelos = Array.isArray(body.modelos) ? body.modelos.filter((m: unknown) => typeof m === "string") : null;
        const r = await aplicarCostosReales(yo, cuenta.id, modelos);
        return NextResponse.json({ ok: true, ...r });
      }
      default:
        return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
