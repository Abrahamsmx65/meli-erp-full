import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { cuentaPorToken } from "@/lib/servicios/acceso-contenido";
import { guardarCategoria, guardarModelo } from "@/lib/servicios/contenido-escribir";

export const dynamic = "force-dynamic";

/**
 * El guardado de la sección de contenido para quien entra con el link sin
 * contraseña. Mismo cuerpo que la ruta con sesión; lo único distinto es la
 * puerta —el token— y que del otro lado no hay RLS, así que solo se tocan las
 * tablas de esta sección y nada más.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const cuenta = await cuentaPorToken(token ?? "");
  if (!cuenta) return NextResponse.json({ error: "Este link ya no sirve." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const tipo = body?.tipo === "categoria" ? "categoria" : "modelo";

  const admin = clienteAdmin();
  const r =
    tipo === "categoria"
      ? await guardarCategoria(admin, cuenta.id, body)
      : await guardarModelo(admin, cuenta.id, body);

  return r.ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
}
