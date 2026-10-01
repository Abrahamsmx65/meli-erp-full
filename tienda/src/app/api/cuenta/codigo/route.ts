import { NextResponse, type NextRequest } from "next/server";
import { enviarCorreo } from "@/lib/correo";
import { correoValido, nuevoCodigo } from "@/lib/sesion";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!correoValido(email)) return NextResponse.json({ error: "Escribe un correo válido." }, { status: 400 });
  try {
    const codigo = await nuevoCodigo(email);
    const r = await enviarCorreo(
      email,
      `Tu código para entrar a GETAC: ${codigo}`,
      `<p>Tu código es:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${codigo}</p><p>Vence en 10 minutos. Si no lo pediste, ignora este correo.</p>`,
    );
    if (!r.ok) return NextResponse.json({ error: "No pudimos mandarte el correo. Intenta más tarde." }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 429 });
  }
}
