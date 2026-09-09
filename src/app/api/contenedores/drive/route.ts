import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { sincronizarPackingListsDrive } from "@/lib/servicios/drive-packing";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Botón "Traer de Drive ahora": la misma sincronización del cron, a mano.
 * `?forzar=1` vuelve a leer también los archivos que no cambiaron.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Conecta Mercado Libre." }, { status: 400 });

  const forzar = req.nextUrl.searchParams.get("forzar") === "1";
  try {
    const r = await sincronizarPackingListsDrive(clienteAdmin(), cuenta.id, { finMs: Date.now() + 100_000, forzar });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
