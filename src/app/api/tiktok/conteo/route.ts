import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { guardarConteo, renglonesDelCuerpo } from "@/lib/servicios/tiktok-conteo";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Guarda un conteo cíclico del almacén de TikTok (con sesión): ajustes al
 * kardex y publicación del disponible nuevo.
 *
 * Cuerpo: { renglones: [{ sku, contado, saldo, supuestoCero }], escaneos?: string[] }
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const renglones = renglonesDelCuerpo(body);
  if (!renglones.length) return NextResponse.json({ error: "No se contó nada." }, { status: 400 });

  try {
    const r = await guardarConteo(clienteAdmin(), cuenta.id, renglones, {
      usuario: user.id,
      escaneos: Array.isArray(body?.escaneos) ? body.escaneos.map(String) : [],
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
