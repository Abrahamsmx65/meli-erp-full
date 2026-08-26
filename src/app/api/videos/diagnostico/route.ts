import { NextResponse, after, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/server";
import { abrirSesion, listarHerramientas } from "@/lib/higgsfield/mcp";
import { dispararVideos } from "@/lib/servicios/disparar-videos";
import { origenReal } from "@/lib/servicios/origen";

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

  // ?despachar=1 → enciende el vigilante de videos (para destrabar filas
  // sin esperar a que alguien abra la página).
  if (req.nextUrl.searchParams.get("despachar")) {
    const origen = origenReal(req);
    after(() => dispararVideos(origen));
    return NextResponse.json({ ok: true, despachado: true });
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

    // ?job=folio → el estado CRUDO de ese trabajo en el MCP (para destrabar
    // videos que se ven eternos en la app).
    const job = req.nextUrl.searchParams.get("job");
    if (job) {
      const { llamarHerramienta, resultadoEstructurado } = await import("@/lib/higgsfield/mcp");
      const res = await llamarHerramienta(sesion, "job_status", { jobId: job });
      return NextResponse.json(resultadoEstructurado(res) ?? res);
    }

    // ?modelo=x → la ficha del modelo en el catálogo (params, roles, duraciones).
    const modelo = req.nextUrl.searchParams.get("modelo");
    if (modelo) {
      const { llamarHerramienta, resultadoEstructurado } = await import("@/lib/higgsfield/mcp");
      const res = await llamarHerramienta(sesion, "models_explore", {
        action: "get",
        model_id: modelo,
      });
      return NextResponse.json(resultadoEstructurado(res) ?? res);
    }

    // ?herr=nombre → el esquema COMPLETO de esa herramienta.
    const nombre = req.nextUrl.searchParams.get("herr");
    if (nombre) {
      const una = herramientas.find((h: any) => h.name === nombre);
      return NextResponse.json(una ?? { error: "No existe esa herramienta." });
    }
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
