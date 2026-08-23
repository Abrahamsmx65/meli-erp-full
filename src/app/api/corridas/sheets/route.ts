import { NextResponse } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import {
  configuracionCorridasSheets,
  descargarSheetCorridas,
  importarCorridasDeLibro,
  sincronizarCorridasDesdeSheets,
} from "@/lib/servicios/corridas-sheets";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET  -> prueba la conexión con el Google Sheets de corridas y regresa qué
 *         pestaña y cuántas corridas leyó, SIN escribir nada.
 * POST -> sincroniza: lee el sheet y acumula las corridas.
 */
export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  try {
    if (!configuracionCorridasSheets()) {
      return NextResponse.json(
        {
          error:
            "Falta CORRIDAS_SHEET_URL en las variables de entorno de Vercel (la URL de tu sheet de corridas).",
        },
        { status: 400 },
      );
    }

    const buf = await descargarSheetCorridas();
    const r = await importarCorridasDeLibro(buf);

    return NextResponse.json({
      ok: true,
      hoja: r.hoja,
      corridas: r.corridas.length,
      tallas: r.tallas,
      avisos: r.avisos.slice(0, 20).map((a) => `Fila ${a.fila}: ${a.mensaje}`),
      muestra: r.corridas.slice(0, 3),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

export async function POST() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) {
    return NextResponse.json(
      { error: "Conecta primero tu cuenta de Mercado Libre." },
      { status: 400 },
    );
  }

  try {
    const resumen = await sincronizarCorridasDesdeSheets(supabase, cuenta.id);
    return NextResponse.json({ ok: true, resumen });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
