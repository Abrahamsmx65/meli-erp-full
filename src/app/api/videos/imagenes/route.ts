import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin, clienteServidor } from "@/lib/supabase/server";
import { cuentaActiva } from "@/lib/datos/repos";
import { MeliClient } from "@/lib/meli/client";

export const dynamic = "force-dynamic";

/**
 * Fotos de una publicación de MELI, para escoger cuál se convierte en video.
 *
 * Las imágenes no se guardan en la base (a propósito): el CDN de MELI ya las
 * sirve públicas y Higgsfield las lee directo de ahí. Esto solo las lista.
 */
export async function GET(req: NextRequest) {
  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });

  const cuenta = await cuentaActiva(supabase);
  if (!cuenta) return NextResponse.json({ error: "Sin cuenta conectada." }, { status: 400 });

  // Proxy de una foto del CDN de MELI: el navegador necesita leer los
  // pixeles para armar el lienzo 9:16 y el CDN no manda CORS. Solo se
  // aceptan dominios de mlstatic para no ser proxy de cualquier cosa.
  const proxy = req.nextUrl.searchParams.get("proxy")?.trim();
  if (proxy) {
    let host: string;
    try {
      host = new URL(proxy).hostname;
    } catch {
      return NextResponse.json({ error: "URL inválida." }, { status: 400 });
    }
    if (!/(^|\.)mlstatic\.com$/.test(host)) {
      return NextResponse.json({ error: "Solo fotos de Mercado Libre." }, { status: 400 });
    }
    const res = await fetch(proxy, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      return NextResponse.json({ error: `El CDN contestó ${res.status}.` }, { status: 502 });
    }
    return new NextResponse(res.body, {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const itemId = req.nextUrl.searchParams.get("item")?.trim();
  if (!itemId) return NextResponse.json({ error: "Falta el item." }, { status: 400 });

  const admin = clienteAdmin();
  const { data: tok } = await admin
    .from("meli_tokens")
    .select("access_token, refresh_token, expira_en")
    .eq("account_id", cuenta.id)
    .single();
  if (!tok) return NextResponse.json({ error: "Cuenta sin tokens." }, { status: 400 });

  const cliente = new MeliClient({
    clientId: process.env.MELI_CLIENT_ID!,
    clientSecret: process.env.MELI_CLIENT_SECRET!,
    credenciales: {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiraEn: new Date(tok.expira_en).getTime(),
    },
    alRenovar: async (c) => {
      await admin
        .from("meli_tokens")
        .update({
          access_token: c.accessToken,
          refresh_token: c.refreshToken,
          expira_en: new Date(c.expiraEn).toISOString(),
          actualizado_en: new Date().toISOString(),
        })
        .eq("account_id", cuenta.id);
    },
  });

  try {
    const item = await cliente.get<{
      title?: string;
      pictures?: { secure_url?: string; url?: string }[];
    }>(`/items/${itemId}`);

    const imagenes = (item.pictures ?? [])
      .map((p) => p.secure_url ?? p.url ?? "")
      .filter(Boolean);

    return NextResponse.json({ ok: true, titulo: item.title ?? "", imagenes });
  } catch (err) {
    return NextResponse.json(
      { error: `No se pudo leer la publicación: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}
