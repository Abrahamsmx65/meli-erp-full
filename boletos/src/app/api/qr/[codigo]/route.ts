import { NextResponse } from "next/server";
import { esCodigoBoleto } from "@/lib/codigos";
import { qrPng } from "@/lib/qr";

/**
 * Imagen PNG del QR. Es pública: quien tiene el código ya tiene el boleto,
 * y el correo la carga desde aquí. Solo se dibuja si el código tiene la
 * forma correcta; no consulta la base.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await ctx.params;
  const c = codigo.toUpperCase();
  if (!esCodigoBoleto(c)) return new NextResponse("No", { status: 404 });
  const png = await qrPng(c);
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
