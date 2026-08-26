import { NextResponse } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import {
  abrirSesion,
  llamarHerramienta,
  resultadoEstructurado,
} from "@/lib/higgsfield/mcp";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Catálogo del Marketing Studio para la pantalla: los avatares disponibles
 * (para fijar el personaje de marca — misma cara en todos los videos) y los
 * modos/presets de video (UGC, Unboxing, Product Review…).
 */
export async function GET() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const admin = clienteAdmin();
  try {
    const sesion = await abrirSesion(admin, cuenta.id);
    const res = await llamarHerramienta(sesion, "show_marketing_studio", {
      action: "list",
      type: "avatar",
      size: 60,
    });
    const sc = resultadoEstructurado(res);
    const avatares = (sc?.items ?? [])
      .filter((a: any) => a?.id)
      .map((a: any) => ({
        id: a.id,
        nombre: a.name ?? "",
        foto: a.preview_url ?? null,
        tipo: a.type ?? "preset",
        genero: a.gender ?? null,
      }));
    const modos = (sc?.presets ?? []).map((p: any) => ({
      modo: p.mode,
      descripcion: p.description ?? "",
    }));
    return NextResponse.json({ ok: true, avatares, modos });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
