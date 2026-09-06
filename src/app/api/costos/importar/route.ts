import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { leerHoja } from "@/lib/importar/leer-hoja";
import { filasDesdeHoja, importarCostos } from "@/lib/servicios/costos-producto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Carga masiva desde la hoja "Numeros" (CATEGORIA | MODELO | USD | TDC | CBM
 * X PAR | ENVIO | PRECIO RELAMPAGO | PV NORMAL | ENVIO AMAZON; las columnas
 * calculadas se ignoran). Los modelos que ya existían se actualizan, los
 * nuevos se agregan.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const form = await req.formData().catch(() => null);
  const archivo = form?.get("archivo");
  if (!(archivo instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });
  }

  const hoja = await leerHoja(Buffer.from(await archivo.arrayBuffer()), { nombre: archivo.name });
  const { filas, error } = filasDesdeHoja(hoja);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const r = await importarCostos(supabase, cuenta.id, filas);
  return r.ok
    ? NextResponse.json({ ok: true, cargados: r.cargados })
    : NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
}
