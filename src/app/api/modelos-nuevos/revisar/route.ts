import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { cuentaAmazon } from "@/lib/servicios/amazon";
import { revisarModelos } from "@/lib/servicios/modelos-nuevos-revisar";

export const dynamic = "force-dynamic";
// El plan Hobby topa las funciones en 60 s.
export const maxDuration = 60;
const PLAZO_MS = 50_000;

/**
 * Revisa en vivo, en MELI y Amazon, las fotos, el video y el A+ de los
 * modelos indicados (o de todos los pendientes si no viene ninguno). Lo que no
 * alcance plazo se devuelve como pendiente para el siguiente clic.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { modelos?: unknown };
  let modelos = Array.isArray(body.modelos)
    ? body.modelos.filter((m): m is string => typeof m === "string").map((m) => m.trim().toUpperCase())
    : [];

  if (!modelos.length) {
    const { data } = await supabase
      .from("modelos_nuevos")
      .select("modelo, revisado_en")
      .eq("account_id", cuenta.id)
      .eq("listo", false)
      .order("revisado_en", { ascending: true, nullsFirst: true });
    modelos = (data ?? []).map((m: any) => String(m.modelo));
  } else {
    // Solo los que están en la lista: el modelo llega del navegador.
    const { data } = await supabase
      .from("modelos_nuevos")
      .select("modelo")
      .eq("account_id", cuenta.id)
      .in("modelo", modelos);
    const conocidos = new Set((data ?? []).map((m: any) => String(m.modelo)));
    modelos = modelos.filter((m) => conocidos.has(m));
  }
  if (!modelos.length) return NextResponse.json({ ok: true, revisados: [], pendientes: [], avisos: [] });

  const amazon = await cuentaAmazon(supabase);
  try {
    const r = await revisarModelos({
      db: supabase,
      admin: clienteAdmin(),
      meliAccountId: cuenta.id,
      amazon: amazon ? { id: amazon.id, pais: amazon.pais ?? null } : null,
      modelos,
      limite: Date.now() + PLAZO_MS,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
