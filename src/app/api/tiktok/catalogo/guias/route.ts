import { after, NextResponse, type NextRequest } from "next/server";
import { cuentaActiva, RecursoOcupadoError } from "@/lib/datos/repos";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { borrarGuia, generarGuias, guardarGuiaEditada, hayLlaveGuias, leerGuias } from "@/lib/servicios/guias-ia";
import { limpiarGuia } from "@/lib/tienda/guia-ia";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Las ideas para el video hechas por Claude, desde el back del catálogo:
 * · GET: lo guardado (guías, gasto del mes, última corrida).
 * · `{ accion: "generar" }` hace por atrás las que faltan.
 * · `{ accion: "rehacer", modelo }` vuelve a pedir la de un modelo.
 * · `{ accion: "editar", modelo, guia }` guarda la corregida a mano.
 * · `{ accion: "quitar", modelo }` la borra (la tienda vuelve a las reglas).
 */
async function cuentaDeSesion() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return cuentaActiva(supabase);
}

export async function GET() {
  const cuenta = await cuentaDeSesion();
  if (!cuenta) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const datos = await leerGuias(clienteAdmin(), cuenta.id);
  return NextResponse.json({ ...datos, hayLlave: hayLlaveGuias() });
}

export async function POST(req: NextRequest) {
  const cuenta = await cuentaDeSesion();
  if (!cuenta) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const accion = String(body?.accion ?? "");
  const modelo = String(body?.modelo ?? "").trim().toUpperCase();
  const admin = clienteAdmin();

  if (accion === "generar" || accion === "rehacer") {
    if (!hayLlaveGuias()) return NextResponse.json({ error: "Falta la llave ANTHROPIC_API_KEY_GUIAS en Vercel." }, { status: 400 });
    if (accion === "rehacer" && !modelo) return NextResponse.json({ error: "Falta el modelo." }, { status: 400 });
    after(async () => {
      try {
        await generarGuias(admin, cuenta.id, accion === "rehacer" ? { soloModelos: [modelo], forzar: true } : { msMax: 270_000 });
      } catch (err) {
        if (!(err instanceof RecursoOcupadoError)) console.error("guias-video:", (err as Error).message);
      }
    });
    return NextResponse.json({ ok: true, enCurso: true });
  }

  if (!modelo) return NextResponse.json({ error: "Falta el modelo." }, { status: 400 });
  try {
    if (accion === "editar") {
      const guia = limpiarGuia(body?.guia);
      if (!guia) return NextResponse.json({ error: "La guía necesita al menos un punto fuerte, una idea y un gancho." }, { status: 400 });
      await guardarGuiaEditada(admin, cuenta.id, modelo, guia);
      return NextResponse.json({ ok: true });
    }
    if (accion === "quitar") {
      await borrarGuia(admin, cuenta.id, modelo);
      return NextResponse.json({ ok: true });
    }
  } catch (err) {
    const status = err instanceof RecursoOcupadoError ? 409 : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
  return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
}
