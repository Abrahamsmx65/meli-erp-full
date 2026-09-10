import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { sincronizarPackingListsDrive } from "@/lib/servicios/drive-packing";
import { configDrive, htmlListadoPublico, leerListadoPublico } from "@/lib/servicios/drive";

/**
 * Sonda: qué contesta Google por la carpeta pública (para ajustar el lector
 * sin adivinar). No guarda nada. `/api/contenedores/drive?diagnostico=1`
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  if (req.nextUrl.searchParams.get("diagnostico") !== "1") {
    return NextResponse.json({ error: "Usa ?diagnostico=1 o POST para sincronizar." }, { status: 400 });
  }
  const cfg = configDrive();
  try {
    const { status, html } = await htmlListadoPublico(cfg.carpeta);
    const archivos = leerListadoPublico(html);
    const primera = html.indexOf("entry-");
    return NextResponse.json({
      carpeta: cfg.carpeta,
      status,
      caracteres: html.length,
      marcas: { entry: (html.match(/entry-/g) ?? []).length, flipEntry: (html.match(/flip-entry/g) ?? []).length },
      reconocidos: archivos.map((a) => ({ id: a.id, nombre: a.nombre, mime: a.mime, modificadoEn: a.modificadoEn })),
      inicio: html.slice(0, 1500),
      alrededorDeLaPrimeraEntrada: primera >= 0 ? html.slice(Math.max(0, primera - 300), primera + 1200) : null,
    });
  } catch (err) {
    return NextResponse.json({ carpeta: cfg.carpeta, error: (err as Error).message }, { status: 500 });
  }
}

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
