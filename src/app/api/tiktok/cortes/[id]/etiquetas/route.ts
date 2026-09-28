import { after } from "next/server";
import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { bajarGuiasDelCorte, enlaceDeTomo, pdfEtiquetasDelCorte } from "@/lib/servicios/tiktok-despacho";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  // Un corte grande sale por TOMOS de `PAQUETES_POR_TOMO` (?tomo=1..k): el
  // #36 del 22-sep-2026 (916 guías, ~96 MB) no cabía entero en Vercel.
  const tomoParam = _req.nextUrl.searchParams.get("tomo");
  const tomo = tomoParam ? Number(tomoParam) : null;
  if (tomo != null && (!Number.isInteger(tomo) || tomo < 1)) return NextResponse.json({ error: "Tomo inválido." }, { status: 400 });
  // `formato=enlace`: si el tomo ya está guardado, se contesta un ENLACE
  // firmado al bucket y el navegador lo baja directo (la función de Vercel
  // sirve a ~2 MB/s: un tomo de 21 MB tardaba ~10 s). Si aún no está, se
  // arma aquí (y se guarda si salió completo) y se contesta el enlace o,
  // si quedó incompleto, el PDF mismo.
  const quiereEnlace = _req.nextUrl.searchParams.get("formato") === "enlace";

  try {
    const admin = clienteAdmin();
    if (quiereEnlace) {
      const listo = await enlaceDeTomo(admin, cuenta.id, corteId, tomo);
      if (listo) return NextResponse.json({ url: listo, tomo, guardado: true });
    }
    const pdf = await pdfEtiquetasDelCorte(admin, cuenta.id, corteId, tomo);
    // Las guías que aún no están guardadas (las de los otros tomos) se
    // siguen bajando en el fondo, para que la siguiente impresión salga
    // completa a la primera; si ya están todas, esto no baja nada.
    after(async () => {
      await bajarGuiasDelCorte(admin, cuenta.id, corteId, 200_000).catch(() => undefined);
    });
    if (quiereEnlace) {
      const recien = await enlaceDeTomo(admin, cuenta.id, corteId, tomo);
      if (recien) return NextResponse.json({ url: recien, tomo, guardado: true });
    }
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="corte-${corteId}-etiquetas${tomo ? `-tomo${tomo}` : ""}.pdf"`,
      },
    });
  } catch (err) {
    const m = (err as Error).message;
    return NextResponse.json({ error: m }, { status: m.includes("tomo") ? 400 : 500 });
  }
}
