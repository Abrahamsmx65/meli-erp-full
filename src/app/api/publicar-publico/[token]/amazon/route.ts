import { NextResponse, type NextRequest } from "next/server";
import { cuentaDePublicarPorToken } from "@/lib/servicios/acceso-publicar";
import { atenderGetAmazon, atenderPostAmazon } from "@/lib/servicios/amazon-publicar-rutas";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

type Params = { params: Promise<{ token: string }> };

/** Un token que no vale contesta 404 seco, sin pistas. */
async function cuenta(token: string): Promise<string | NextResponse> {
  return (await cuentaDePublicarPorToken(token)) ?? NextResponse.json({ error: "No encontrado." }, { status: 404 });
}

export async function GET(req: NextRequest, { params }: Params) {
  const c = await cuenta((await params).token);
  return c instanceof NextResponse ? c : atenderGetAmazon(c, req);
}

export async function POST(req: NextRequest, { params }: Params) {
  const c = await cuenta((await params).token);
  return c instanceof NextResponse ? c : atenderPostAmazon(c, req);
}
