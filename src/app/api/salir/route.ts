import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Cerrar sesión. Sirve para cambiar de cuenta de Mercado Libre: se sale del
 * usuario actual y el login queda listo para entrar con otro correo (cada
 * correo tiene su propia cuenta de MELI conectada).
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", req.url));
}
