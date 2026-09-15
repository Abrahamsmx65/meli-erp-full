import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { pinSupervisorValido } from "@/lib/servicios/acceso-preparar";
import { prepararCorteCompleto } from "@/lib/servicios/tiktok-despacho";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Da por preparado TODO el corte sin escanear. Doble puerta a propósito:
 * sesión del ERP (panel de admin) Y la clave de supervisor — saltarse la
 * verificación de un corte entero no debe ser un clic accidental.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const { id } = await ctx.params;
  const corteId = Number(id);
  if (!Number.isFinite(corteId)) return NextResponse.json({ error: "Corte inválido." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  if (!(await pinSupervisorValido(cuenta.id, String(body?.pin ?? "")))) {
    return NextResponse.json({ error: "Clave incorrecta." }, { status: 403 });
  }

  try {
    const r = await prepararCorteCompleto(clienteAdmin(), cuenta.id, corteId, user.id);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
