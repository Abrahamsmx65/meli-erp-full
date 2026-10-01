import { NextResponse, type NextRequest } from "next/server";
import { correoValido, entrarConCodigo } from "@/lib/sesion";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  const codigo = String(body?.codigo ?? "").trim();
  if (!correoValido(email) || !/^\d{6}$/.test(codigo.replace(/\D/g, ""))) {
    return NextResponse.json({ error: "Escribe el código de 6 dígitos." }, { status: 400 });
  }
  const r = await entrarConCodigo(email, codigo);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
