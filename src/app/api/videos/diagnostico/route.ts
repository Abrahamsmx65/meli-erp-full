import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { abrirSesion, listarHerramientas } from "@/lib/higgsfield/mcp";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Ruta TEMPORAL (ronda 7): con la cuenta de Higgsfield ya conectada por
// OAuth, lista las herramientas reales que expone su MCP para cablear el
// Marketing Studio con los nombres y parámetros exactos. Se borra al
// terminar la integración.
const LLAVE = "dx-mgx7q4wkzt";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("llave") !== LLAVE) {
    return NextResponse.json({ error: "No." }, { status: 404 });
  }

  const admin = clienteAdmin();
  const { data: conexiones } = await admin
    .from("higgsfield_mcp")
    .select("account_id, expira_en, actualizado_en")
    .limit(1);
  if (!conexiones?.length) {
    return NextResponse.json({ conectado: false, nota: "Nadie ha conectado su cuenta todavía." });
  }

  try {
    const sesion = await abrirSesion(admin, conexiones[0].account_id as string);
    const herramientas = await listarHerramientas(sesion);
    // Nombres + descripción corta + campos del esquema (sin inundar).
    const resumen = herramientas.map((h: any) => ({
      nombre: h.name,
      descripcion: String(h.description ?? "").slice(0, 200),
      campos: Object.keys(h.inputSchema?.properties ?? {}),
      requeridos: h.inputSchema?.required ?? [],
    }));
    return NextResponse.json({ conectado: true, total: resumen.length, herramientas: resumen });
  } catch (err) {
    return NextResponse.json({ conectado: true, error: (err as Error).message.slice(0, 300) });
  }
}
