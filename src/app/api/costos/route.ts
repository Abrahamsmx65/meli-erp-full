import { NextResponse, type NextRequest } from "next/server";
import { clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { borrarCosto, guardarCosto } from "@/lib/servicios/costos-producto";

export const dynamic = "force-dynamic";

async function sesion() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 }) };
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return { error: NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 }) };
  return { supabase, cuenta };
}

/**
 * Guarda la captura de costos de un modelo (solo las columnas que vengan) y
 * copia el costo aterrizado y la categoría a productos_config.
 */
export async function POST(req: NextRequest) {
  const s = await sesion();
  if ("error" in s) return s.error;
  const r = await guardarCosto(s.supabase, s.cuenta.id, await req.json().catch(() => ({})));
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
}

/** Quita la captura de un modelo. */
export async function DELETE(req: NextRequest) {
  const s = await sesion();
  if ("error" in s) return s.error;
  const body = await req.json().catch(() => ({}));
  const r = await borrarCosto(s.supabase, s.cuenta.id, typeof body?.modelo === "string" ? body.modelo : "");
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
}
