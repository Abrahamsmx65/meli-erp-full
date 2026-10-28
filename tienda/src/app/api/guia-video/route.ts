import { NextResponse, type NextRequest } from "next/server";
import { guiasVideo } from "@/lib/catalogo";

export const dynamic = "force-dynamic";

/** La guía de Claude de un modelo (`?modelo=GT145`); `null` si todavía no tiene. */
export async function GET(req: NextRequest) {
  const modelo = (req.nextUrl.searchParams.get("modelo") ?? "").trim().toUpperCase();
  if (!/^[A-Z]{1,5}\d{2,6}$/.test(modelo)) return NextResponse.json({ guia: null });
  const guias = await guiasVideo();
  return NextResponse.json({ guia: guias[modelo] ?? null }, { headers: { "Cache-Control": "public, max-age=60" } });
}
