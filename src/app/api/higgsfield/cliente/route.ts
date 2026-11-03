import { NextResponse } from "next/server";
import { documentoCliente } from "@/lib/higgsfield/cliente-oauth";

export const dynamic = "force-dynamic";

/**
 * El Client ID Metadata Document del ERP: el servidor OAuth de Higgsfield
 * LEE esta URL (que es el client_id) para validar los redirect_uris, así que
 * la ruta es pública (está en la lista del middleware) y no toca la base.
 */
export async function GET() {
  return NextResponse.json(documentoCliente(), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
