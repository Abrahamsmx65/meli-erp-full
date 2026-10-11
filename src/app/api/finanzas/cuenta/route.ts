import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva, type DB } from "@/lib/datos/repos";
import { agregarMovimiento, agregarRetiro, borrarMovimiento, borrarRetiro } from "@/lib/servicios/cuenta";

export const dynamic = "force-dynamic";

/**
 * Cuenta con Rafa y retiros de socios:
 *   { accion: "movimiento", fecha, tipo, monto, beneficiario, referencia, notas }
 *   { accion: "borrar-movimiento", id }
 *   { accion: "retiro", socioId, fecha, concepto, monto }
 *   { accion: "borrar-retiro", id }
 * Se escribe como el dueño (RLS).
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });
  const db = supabase as DB;
  try {
    const body = await req.json().catch(() => ({}));
    switch (body?.accion) {
      case "movimiento":
        await agregarMovimiento(db, cuenta.id, body);
        break;
      case "borrar-movimiento":
        await borrarMovimiento(db, cuenta.id, Number(body.id));
        break;
      case "retiro":
        await agregarRetiro(db, cuenta.id, body);
        break;
      case "borrar-retiro":
        await borrarRetiro(db, cuenta.id, Number(body.id));
        break;
      default:
        return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
