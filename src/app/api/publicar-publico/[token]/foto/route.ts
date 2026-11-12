import { NextResponse, type NextRequest } from "next/server";
import { cuentaDePublicarPorToken } from "@/lib/servicios/acceso-publicar";
import { atenderFoto, contextoDeCuenta } from "@/lib/servicios/meli-publicar-rutas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ token: string }> };

/** Un token que no vale contesta 404 seco, sin pistas. */
async function contexto(token: string) {
  const cuentaId = await cuentaDePublicarPorToken(token);
  if (!cuentaId) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  return contextoDeCuenta(cuentaId);
}

export async function POST(req: NextRequest, { params }: Params) {
  const c = await contexto((await params).token);
  return c instanceof NextResponse ? c : atenderFoto(c, req);
}
