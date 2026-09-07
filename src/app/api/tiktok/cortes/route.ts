import { after } from "next/server";
import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { hacerCorte, pdfEtiquetasDelCorte } from "@/lib/servicios/tiktok-despacho";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Hace un corte: confirma todos los envíos pendientes en TikTok y los agrupa. */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  try {
    const admin = clienteAdmin();
    const r = await hacerCorte(admin, cuenta.id, {
      handover: body?.handover === "DROP_OFF" ? "DROP_OFF" : "PICKUP",
      creadoPor: user.id,
    });
    // Las guías se bajan y se guardan en cuanto se contesta: cuando el
    // usuario pida el PDF ya está armado.
    after(async () => {
      await pdfEtiquetasDelCorte(admin, cuenta.id, r.corteId).catch(() => undefined);
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
