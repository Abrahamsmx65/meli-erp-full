import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { pedirTokens } from "@/lib/higgsfield/mcp";
import { codigoPegado } from "@/lib/higgsfield/cliente-oauth";

export const dynamic = "force-dynamic";

/**
 * Termina la conexión con Higgsfield con la dirección PEGADA: desde el
 * 2-nov-2026 el único redirect que Higgsfield confía es localhost, así que
 * en producción el login termina en una página que no carga y el dueño pega
 * aquí esa dirección (trae ?code= y &state=). Se valida el state contra la
 * cookie del arranque (`/api/higgsfield/conectar`), se cambia el código por
 * tokens con el verificador PKCE y se guardan, igual que hacía el callback.
 */
export async function POST(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  const body = await req.json().catch(() => null);
  const pegado = codigoPegado(String(body?.url ?? ""));
  if (!pegado) {
    return NextResponse.json(
      { error: "Esa dirección no trae el código; pega la dirección COMPLETA de la página que no cargó (empieza con http://localhost:3000/… y trae ?code=…)." },
      { status: 400 },
    );
  }

  const crudo = req.cookies.get("hf_oauth")?.value;
  if (!crudo) {
    return NextResponse.json(
      { error: "La conexión caducó (son 15 minutos); dale otra vez a «Conectar Higgsfield» y pega la dirección nueva." },
      { status: 400 },
    );
  }
  let guardado: { v: string; s: string; c: string; r: string };
  try {
    guardado = JSON.parse(crudo);
  } catch {
    return NextResponse.json({ error: "Cookie de conexión ilegible; dale otra vez a «Conectar Higgsfield»." }, { status: 400 });
  }
  if (pegado.state !== guardado.s) {
    return NextResponse.json(
      { error: "Esa dirección es de un intento anterior; dale otra vez a «Conectar Higgsfield» y pega la dirección del intento nuevo." },
      { status: 400 },
    );
  }

  try {
    const tokens = await pedirTokens({
      clientId: guardado.c,
      codigo: pegado.code,
      codeVerifier: guardado.v,
      redirectUri: guardado.r,
    });
    const admin = clienteAdmin();
    const { error } = await admin.from("higgsfield_mcp").upsert({
      account_id: cuenta.id,
      client_id: guardado.c,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      expira_en: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
      actualizado_en: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message.slice(0, 250) }, { status: 502 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.delete("hf_oauth");
  return res;
}
