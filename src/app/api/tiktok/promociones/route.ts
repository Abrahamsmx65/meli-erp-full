import { NextResponse, type NextRequest } from "next/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { crearOferta, desactivarOferta, guardarCiclica, listarOfertas, programarCiclicas, quitarCiclica, repetirOferta } from "@/lib/servicios/tiktok-promociones";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 200;

async function sesion() {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 }) };
  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return { error: NextResponse.json({ error: "No hay cuenta conectada." }, { status: 400 }) };
  return { supabase, user, cuenta };
}

/**
 * Ofertas relámpago de TikTok desde el panel. Cuerpo:
 *   { accion: "crear", titulo?, inicio?, horas?, nivel?, topePorTalla?, topePorComprador?, modelos: [{ modelo, precio }] }
 *   { accion: "repetir", id, inicio?, horas? }   — la misma oferta otra vez
 *   { accion: "desactivar", activityId }
 *   { accion: "refrescar" }                       — vuelve a leer las ofertas de TikTok
 *   { accion: "ciclica-guardar", modelo, precio, horas?, topePorTalla?, topePorComprador? } — alta o corrección y programa lo que falte
 *   { accion: "ciclica-quitar", id }              — deja de reponer y desactiva las ventanas que no han empezado
 *   { accion: "ciclica-programar" }               — repone ahora las ventanas que falten a todas
 */
export async function POST(req: NextRequest) {
  const s = await sesion();
  if ("error" in s) return s.error;
  const body = await req.json().catch(() => ({}));
  const admin = clienteAdmin();
  try {
    if (body?.accion === "crear") {
      return NextResponse.json({ ok: true, ...(await crearOferta(admin, s.cuenta.id, body, s.user.id)) });
    }
    if (body?.accion === "repetir") {
      return NextResponse.json({ ok: true, ...(await repetirOferta(admin, s.cuenta.id, Number(body.id), s.user.id, { inicio: body.inicio ?? null, horas: body.horas ?? null })) });
    }
    if (body?.accion === "desactivar") {
      await desactivarOferta(admin, s.cuenta.id, String(body.activityId ?? ""));
      return NextResponse.json({ ok: true });
    }
    if (body?.accion === "ciclica-guardar") {
      return NextResponse.json({ ok: true, ciclica: await guardarCiclica(admin, s.cuenta.id, body, s.user.id) });
    }
    if (body?.accion === "ciclica-quitar") {
      return NextResponse.json({ ok: true, ...(await quitarCiclica(admin, s.cuenta.id, Number(body.id))) });
    }
    if (body?.accion === "ciclica-programar") {
      return NextResponse.json({ ok: true, ...(await programarCiclicas(admin, s.cuenta.id, { presupuestoMs: 170_000 })) });
    }
    if (body?.accion === "refrescar") {
      return NextResponse.json(await listarOfertas(admin, s.cuenta.id, { forzar: true }));
    }
    return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
